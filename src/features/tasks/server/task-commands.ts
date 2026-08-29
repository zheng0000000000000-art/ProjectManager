import type { TaskRepository } from "../data/task-repository";
import { TaskRepositoryError } from "../data/task-repository";
import { TaskDomainError } from "../domain/task-errors";
import { publish, returnToPool, start, take } from "../domain/task-transitions";
import type { CommandResult } from "./command-result";
import type { ActorContext } from "@/features/actors/domain/actor";

type VersionedTaskInput = { taskId: string; expectedVersion: number };
export type PublishTaskInput = VersionedTaskInput & {
  title: string; goal: string; workTypeId: string;
  estimatedBlocks: number; deadline: string | null;
};

function failure(error: unknown): CommandResult<{ taskId: string }> {
  if (error instanceof TaskDomainError) {
    if (error.code === "VALIDATION_ERROR") {
      return {
        ok: false, code: "VALIDATION_ERROR", message: "입력 내용을 확인해 주세요.",
        fieldErrors: error.field ? { [error.field]: [error.message] } : undefined,
      };
    }
    return { ok: false, code: "INVALID_TRANSITION", message: error.message };
  }
  if (error instanceof TaskRepositoryError) {
    if (error.code === "VERSION_CONFLICT" || error.code === "NOT_FOUND" || error.code === "SCOPE_REQUIRED" || error.code === "PREREQUISITE_UNRESOLVED") {
      return { ok: false, code: error.code, message: error.message };
    }
  }
  console.error("Task command failed", error);
  return { ok: false, code: "STORAGE_ERROR", message: "작업을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
}

export function createTaskCommands(
  repository: TaskRepository,
  actor: ActorContext,
  clock: () => string = () => new Date().toISOString(),
) {
  return {
    async createDraft(): Promise<CommandResult<{ taskId: string }>> {
      try {
        const task = await repository.createDraft(actor.userId, actor.projectId);
        return { ok: true, data: { taskId: task.id } };
      } catch (error) { return failure(error); }
    },
    async publishTask(input: PublishTaskInput): Promise<CommandResult<{ taskId: string }>> {
      try {
        const task = await repository.runCommand(input.taskId, input.expectedVersion, ({ task, appendEvent }) => {
          const next = publish(task, input);
          appendEvent({ eventType: "published", actorId: actor.userId, fromState: "draft", toState: "published", createdAt: clock() });
          return next;
        });
        return { ok: true, data: { taskId: task.id } };
      } catch (error) { return failure(error); }
    },
    async takeTask(input: VersionedTaskInput): Promise<CommandResult<{ taskId: string }>> {
      try {
        const task = await repository.runCommand(input.taskId, input.expectedVersion, ({ task, appendEvent, requireTakeEligibility }) => {
          requireTakeEligibility(actor);
          const next = take(task, actor.userId);
          appendEvent({ eventType: "taken", actorId: actor.userId, fromState: task.workStatus, toState: next.workStatus, createdAt: clock() });
          return next;
        });
        return { ok: true, data: { taskId: task.id } };
      } catch (error) { return failure(error); }
    },
    async startTask(input: VersionedTaskInput): Promise<CommandResult<{ taskId: string }>> {
      try {
        const task = await repository.runCommand(input.taskId, input.expectedVersion, ({ task, appendEvent }) => {
          const startedAt = clock();
          const next = start(task, actor.userId, startedAt);
          appendEvent({ eventType: "started", actorId: actor.userId, fromState: task.workStatus, toState: next.workStatus, createdAt: startedAt });
          return next;
        });
        return { ok: true, data: { taskId: task.id } };
      } catch (error) { return failure(error); }
    },
    async returnTask(input: VersionedTaskInput): Promise<CommandResult<{ taskId: string }>> {
      try {
        const task = await repository.runCommand(input.taskId, input.expectedVersion, ({ task, appendEvent }) => {
          const next = returnToPool(task, actor.userId);
          appendEvent({ eventType: "returned", actorId: actor.userId, fromState: task.workStatus, toState: next.workStatus, createdAt: clock() });
          return next;
        });
        return { ok: true, data: { taskId: task.id } };
      } catch (error) { return failure(error); }
    },
  };
}
