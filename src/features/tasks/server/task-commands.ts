import type { TaskRepository } from "../data/task-repository";
import { TaskRepositoryError } from "../data/task-repository";
import { TaskDomainError } from "../domain/task-errors";
import { publish, returnToPool, start, take } from "../domain/task-transitions";
import type { CommandResult } from "./command-result";
import { DEFAULT_PROJECT_ID, FIXED_USER_ID } from "@/features/scope/domain/scope";

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
    if (error.code === "VERSION_CONFLICT" || error.code === "NOT_FOUND" || error.code === "SCOPE_REQUIRED") {
      return { ok: false, code: error.code, message: error.message };
    }
  }
  console.error("Task command failed", error);
  return { ok: false, code: "STORAGE_ERROR", message: "작업을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
}

export function createTaskCommands(repository: TaskRepository) {
  return {
    async createDraft(): Promise<CommandResult<{ taskId: string }>> {
      try {
        const task = await repository.createDraft(FIXED_USER_ID, DEFAULT_PROJECT_ID);
        return { ok: true, data: { taskId: task.id } };
      } catch (error) { return failure(error); }
    },
    async publishTask(input: PublishTaskInput): Promise<CommandResult<{ taskId: string }>> {
      try {
        const task = await repository.runCommand(input.taskId, input.expectedVersion, ({ task, appendEvent }) => {
          const next = publish(task, input);
          appendEvent({ eventType: "published", actorId: FIXED_USER_ID, fromState: "draft", toState: "published" });
          return next;
        });
        return { ok: true, data: { taskId: task.id } };
      } catch (error) { return failure(error); }
    },
    async takeTask(input: VersionedTaskInput): Promise<CommandResult<{ taskId: string }>> {
      try {
        const task = await repository.runCommand(input.taskId, input.expectedVersion, ({ task, appendEvent, requireTakeScope }) => {
          requireTakeScope(FIXED_USER_ID);
          const next = take(task, FIXED_USER_ID);
          appendEvent({ eventType: "taken", actorId: FIXED_USER_ID, fromState: task.workStatus, toState: next.workStatus });
          return next;
        });
        return { ok: true, data: { taskId: task.id } };
      } catch (error) { return failure(error); }
    },
    async startTask(input: VersionedTaskInput): Promise<CommandResult<{ taskId: string }>> {
      try {
        const task = await repository.runCommand(input.taskId, input.expectedVersion, ({ task, appendEvent }) => {
          const next = start(task, FIXED_USER_ID);
          appendEvent({ eventType: "started", actorId: FIXED_USER_ID, fromState: task.workStatus, toState: next.workStatus });
          return next;
        });
        return { ok: true, data: { taskId: task.id } };
      } catch (error) { return failure(error); }
    },
    async returnTask(input: VersionedTaskInput): Promise<CommandResult<{ taskId: string }>> {
      try {
        const task = await repository.runCommand(input.taskId, input.expectedVersion, ({ task, appendEvent }) => {
          const next = returnToPool(task, FIXED_USER_ID);
          appendEvent({ eventType: "returned", actorId: FIXED_USER_ID, fromState: task.workStatus, toState: next.workStatus });
          return next;
        });
        return { ok: true, data: { taskId: task.id } };
      } catch (error) { return failure(error); }
    },
  };
}
