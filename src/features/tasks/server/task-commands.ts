import type { ActorContext } from "@/features/actors/domain/actor";
import type { AuditRepository } from "@/features/audit/data/audit-repository";
import type { SafeAuditMetadata, TaskAuditAction } from "@/features/audit/domain/audit-entry";
import type { SuccessAuditInput, TaskRepository } from "../data/task-repository";
import { isTaskRepositoryError } from "../data/task-repository";
import type { TaskRecord } from "../domain/task";
import type { TaskDomainReason } from "../domain/task-errors";
import { complete, publish, returnToPool, start, take } from "../domain/task-transitions";
import type { CommandErrorCode, CommandResult } from "./command-result";
import { TaskFailureAuditor } from "./task-failure-auditor";
import { isValidExpectedVersion } from "./task-mutation-validation";

export { isValidExpectedVersion } from "./task-mutation-validation";

type VersionedTaskInput = { taskId: string; expectedVersion: number };
export type PublishTaskInput = VersionedTaskInput & {
  title: string;
  goal: string;
  workTypeId: string;
  estimatedBlocks: number;
  deadline: string | null;
};
export type CompleteTaskInput = VersionedTaskInput & { completionSummary: string };

export type TaskCommandContext = {
  requestId: string;
  clock: () => string;
};

type ClassifiedFailure = {
  result: CommandResult<{ taskId: string }>;
  audit: { errorCode: string; fieldNames: string[] };
};

type TaskDomainErrorShape = {
  code: "VALIDATION_ERROR" | "INVALID_TRANSITION";
  reason: TaskDomainReason;
  message: string;
  field?: string;
};

const domainErrorCodes = new Set(["VALIDATION_ERROR", "INVALID_TRANSITION"]);
const domainErrorReasons = new Set<TaskDomainReason>([
  "INVALID_FIELD",
  "ACTOR_TYPE_REQUIRED",
  "ASSIGNEE_REQUIRED",
  "STATE_REQUIRED",
]);

function isTaskDomainError(error: unknown): error is TaskDomainErrorShape {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; reason?: unknown; message?: unknown; field?: unknown };
  return typeof candidate.code === "string"
    && domainErrorCodes.has(candidate.code)
    && typeof candidate.reason === "string"
    && domainErrorReasons.has(candidate.reason as TaskDomainReason)
    && typeof candidate.message === "string"
    && (candidate.field === undefined || typeof candidate.field === "string");
}

function classifiedDomainCode(error: TaskDomainErrorShape): {
  resultCode: CommandErrorCode;
  auditCode: string;
} {
  if (error.reason === "ACTOR_TYPE_REQUIRED") {
    return { resultCode: "ACTOR_NOT_ALLOWED", auditCode: "ACTOR_REJECTED" };
  }
  if (error.reason === "ASSIGNEE_REQUIRED") {
    return { resultCode: "OWNERSHIP_REQUIRED", auditCode: "OWNERSHIP_REQUIRED" };
  }
  return { resultCode: "INVALID_TRANSITION", auditCode: "INVALID_TRANSITION" };
}

function classifyFailure(error: unknown): ClassifiedFailure {
  if (isTaskDomainError(error)) {
    if (error.code === "VALIDATION_ERROR") {
      const fieldNames = error.field ? [error.field] : [];
      return {
        result: {
          ok: false,
          code: "VALIDATION_ERROR",
          message: "입력 내용을 확인해 주세요.",
          fieldErrors: error.field ? { [error.field]: [error.message] } : undefined,
        },
        audit: { errorCode: "VALIDATION_ERROR", fieldNames },
      };
    }
    const code = classifiedDomainCode(error);
    return {
      result: { ok: false, code: code.resultCode, message: error.message },
      audit: { errorCode: code.auditCode, fieldNames: [] },
    };
  }

  if (isTaskRepositoryError(error)) {
    if (error.code === "VERSION_CONFLICT" || error.code === "NOT_FOUND" ||
      error.code === "SCOPE_REQUIRED" || error.code === "PREREQUISITE_UNRESOLVED") {
      return {
        result: { ok: false, code: error.code, message: error.message },
        audit: { errorCode: error.code, fieldNames: [] },
      };
    }
  }

  console.error("Task command failed", error);
  return {
    result: {
      ok: false,
      code: "STORAGE_ERROR",
      message: "작업을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    },
    audit: { errorCode: "STORAGE_ERROR", fieldNames: [] },
  };
}

export function createTaskCommands(
  repository: TaskRepository,
  auditRepository: AuditRepository,
  actor: ActorContext,
  context: TaskCommandContext,
) {
  const failureAuditor = new TaskFailureAuditor(repository, auditRepository, context.requestId);
  const successAudit = (
    action: TaskAuditAction,
    taskId: string | null,
    createdAt: string,
    metadata: SafeAuditMetadata,
  ): SuccessAuditInput => ({
    projectId: actor.projectId,
    taskId,
    actorId: actor.userId,
    action,
    errorCode: null,
    requestId: context.requestId,
    metadata,
    createdAt,
  });

  const execute = async (
    action: TaskAuditAction,
    taskId: string | null,
    expectedVersion: number | undefined,
    operation: (createdAt: string) => Promise<TaskRecord>,
  ): Promise<CommandResult<{ taskId: string }>> => {
    const createdAt = context.clock();
    if (expectedVersion !== undefined && !isValidExpectedVersion(expectedVersion)) {
      const classified: ClassifiedFailure = {
        result: {
          ok: false,
          code: "VALIDATION_ERROR",
          message: "입력 내용을 확인해 주세요.",
          fieldErrors: { expectedVersion: ["작업 버전을 확인해 주세요."] },
        },
        audit: { errorCode: "VALIDATION_ERROR", fieldNames: ["expectedVersion"] },
      };
      await failureAuditor.append({
        action,
        taskId,
        actor,
        errorCode: classified.audit.errorCode,
        fieldNames: classified.audit.fieldNames,
        createdAt,
      });
      return classified.result;
    }
    try {
      const task = await operation(createdAt);
      return { ok: true, data: { taskId: task.id } };
    } catch (error) {
      const classified = classifyFailure(error);
      await failureAuditor.append({
        action,
        taskId,
        actor,
        errorCode: classified.audit.errorCode,
        expectedVersion,
        fieldNames: classified.audit.fieldNames,
        createdAt,
      });
      return classified.result;
    }
  };

  return {
    async createDraft(): Promise<CommandResult<{ taskId: string }>> {
      return execute("task.create", null, undefined, (createdAt) => repository.createDraft(
        actor.userId,
        actor.projectId,
        successAudit("task.create", null, createdAt, { actorType: actor.actorType }),
      ));
    },

    async publishTask(input: PublishTaskInput): Promise<CommandResult<{ taskId: string }>> {
      return execute("task.publish", input.taskId, input.expectedVersion, (createdAt) =>
        repository.runCommand(
          input.taskId,
          input.expectedVersion,
          successAudit("task.publish", input.taskId, createdAt, {
            expectedVersion: input.expectedVersion,
            fieldNames: ["title", "goal", "workTypeId", "estimatedBlocks", "deadline"],
            actorType: actor.actorType,
          }),
          ({ task, appendEvent }) => {
            const next = publish(task, input);
            appendEvent({
              eventType: "published",
              actorId: actor.userId,
              fromState: "draft",
              toState: "published",
              createdAt,
            });
            return next;
          },
        ));
    },

    async takeTask(input: VersionedTaskInput): Promise<CommandResult<{ taskId: string }>> {
      return execute("task.take", input.taskId, input.expectedVersion, (createdAt) =>
        repository.runCommand(
          input.taskId,
          input.expectedVersion,
          successAudit("task.take", input.taskId, createdAt, {
            expectedVersion: input.expectedVersion,
            actorType: actor.actorType,
          }),
          ({ task, appendEvent, requireTakeEligibility }) => {
            requireTakeEligibility(actor);
            const next = take(task, actor.userId);
            appendEvent({
              eventType: "taken",
              actorId: actor.userId,
              fromState: task.workStatus,
              toState: next.workStatus,
              createdAt,
            });
            return next;
          },
        ));
    },

    async startTask(input: VersionedTaskInput): Promise<CommandResult<{ taskId: string }>> {
      return execute("task.start", input.taskId, input.expectedVersion, (createdAt) =>
        repository.runCommand(
          input.taskId,
          input.expectedVersion,
          successAudit("task.start", input.taskId, createdAt, {
            expectedVersion: input.expectedVersion,
            actorType: actor.actorType,
          }),
          ({ task, appendEvent }) => {
            const next = start(task, actor.userId, createdAt);
            appendEvent({
              eventType: "started",
              actorId: actor.userId,
              fromState: task.workStatus,
              toState: next.workStatus,
              createdAt,
            });
            return next;
          },
        ));
    },

    async returnTask(input: VersionedTaskInput): Promise<CommandResult<{ taskId: string }>> {
      return execute("task.return", input.taskId, input.expectedVersion, (createdAt) =>
        repository.runCommand(
          input.taskId,
          input.expectedVersion,
          successAudit("task.return", input.taskId, createdAt, {
            expectedVersion: input.expectedVersion,
            actorType: actor.actorType,
          }),
          ({ task, appendEvent }) => {
            const next = returnToPool(task, actor.userId);
            appendEvent({
              eventType: "returned",
              actorId: actor.userId,
              fromState: task.workStatus,
              toState: next.workStatus,
              createdAt,
            });
            return next;
          },
        ));
    },

    async completeTask(input: CompleteTaskInput): Promise<CommandResult<{ taskId: string }>> {
      return execute("task.complete", input.taskId, input.expectedVersion, (createdAt) =>
        repository.runCommand(
          input.taskId,
          input.expectedVersion,
          successAudit("task.complete", input.taskId, createdAt, {
            expectedVersion: input.expectedVersion,
            fieldNames: ["completionSummary"],
            actorType: actor.actorType,
          }),
          ({ task, appendEvent }) => {
            const next = complete(task, actor, input.completionSummary, createdAt);
            appendEvent({
              eventType: "completed",
              actorId: actor.userId,
              fromState: task.workStatus,
              toState: next.workStatus,
              createdAt,
            });
            return next;
          },
        ));
    },
  };
}
