import type { TaskRecord } from "../domain/task";
import type { ActorContext } from "@/features/actors/domain/actor";

export interface TaskListItem extends TaskRecord {
  workTypeName: string | null;
}

export interface TaskEventInput {
  eventType: string;
  actorId: string;
  fromState: string | null;
  toState: string;
  createdAt: string;
}

export interface CommandContext {
  task: TaskRecord;
  appendEvent(event: TaskEventInput): void;
  requireTakeEligibility(actor: ActorContext): void;
}

export class TaskRepositoryError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "VERSION_CONFLICT" | "INVALID_EVENT_COUNT" | "SCOPE_REQUIRED" | "PREREQUISITE_UNRESOLVED",
    message: string,
  ) {
    super(message);
    this.name = "TaskRepositoryError";
  }
}

const repositoryErrorCodes = new Set([
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "INVALID_EVENT_COUNT",
  "SCOPE_REQUIRED",
  "PREREQUISITE_UNRESOLVED",
]);

export function isTaskRepositoryError(error: unknown): error is TaskRepositoryError {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return typeof candidate.code === "string"
    && repositoryErrorCodes.has(candidate.code)
    && typeof candidate.message === "string";
}

export interface TaskRepository {
  createDraft(actorId: string, projectId: string): Promise<TaskRecord>;
  findById(id: string): Promise<TaskRecord | null>;
  listPool(actor: ActorContext): Promise<TaskListItem[]>;
  listForAssignee(actor: ActorContext): Promise<TaskListItem[]>;
  countEvents(taskId: string): Promise<number>;
  runCommand(
    taskId: string,
    expectedVersion: number,
    command: (context: CommandContext) => TaskRecord,
  ): Promise<TaskRecord>;
}
