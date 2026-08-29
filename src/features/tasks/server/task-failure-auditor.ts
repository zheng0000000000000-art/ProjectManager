import type { ActorContext } from "@/features/actors/domain/actor";
import type { AuditRepository } from "@/features/audit/data/audit-repository";
import type { SafeAuditMetadata, TaskAuditAction } from "@/features/audit/domain/audit-entry";
import { DEFAULT_PROJECT_ID } from "@/features/scope/domain/scope";
import type { TaskRepository } from "../data/task-repository";
import type { TaskRecord } from "../domain/task";
import {
  isValidExpectedVersion,
  safeTaskMutationFieldNames,
} from "./task-mutation-validation";

export type TaskFailureAuditInput = {
  action: TaskAuditAction;
  taskId: string | null;
  actor?: ActorContext;
  errorCode: string;
  expectedVersion?: unknown;
  fieldNames: readonly unknown[];
  createdAt: string;
};

export class TaskFailureAuditor {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly auditRepository: AuditRepository,
    private readonly requestId: string,
  ) {}

  async append(input: TaskFailureAuditInput): Promise<void> {
    let task: TaskRecord | null = null;
    if (input.taskId) {
      try {
        task = await this.taskRepository.findById(input.taskId);
      } catch {
        task = null;
      }
    }

    const metadata: SafeAuditMetadata = {
      fieldNames: safeTaskMutationFieldNames(input.action, input.fieldNames),
    };
    if (isValidExpectedVersion(input.expectedVersion)) {
      metadata.expectedVersion = input.expectedVersion;
    }
    if (input.actor) metadata.actorType = input.actor.actorType;

    try {
      await this.auditRepository.appendFailure({
        projectId: input.actor?.projectId ?? task?.projectId ?? DEFAULT_PROJECT_ID,
        taskId: task?.id ?? null,
        actorId: input.actor?.userId ?? null,
        action: input.action,
        outcome: "failure",
        errorCode: input.errorCode,
        fromState: task?.workStatus ?? null,
        toState: null,
        requestId: this.requestId,
        metadata,
        createdAt: input.createdAt,
      });
    } catch (auditError) {
      console.error("Audit persistence failed", auditError);
    }
  }
}
