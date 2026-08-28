import type { TaskRecord } from "../domain/task";

export interface TaskListItem extends TaskRecord {
  workTypeName: string | null;
}

export interface TaskEventInput {
  eventType: string;
  actorId: string;
  fromState: string | null;
  toState: string;
}

export interface CommandContext {
  task: TaskRecord;
  appendEvent(event: TaskEventInput): void;
  requireTakeScope(actorId: string): void;
}

export class TaskRepositoryError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "VERSION_CONFLICT" | "INVALID_EVENT_COUNT" | "SCOPE_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "TaskRepositoryError";
  }
}

export interface TaskRepository {
  createDraft(actorId: string, projectId: string): Promise<TaskRecord>;
  findById(id: string): Promise<TaskRecord | null>;
  listPool(actorId: string): Promise<TaskListItem[]>;
  listForAssignee(assigneeId: string): Promise<TaskListItem[]>;
  countEvents(taskId: string): Promise<number>;
  runCommand(
    taskId: string,
    expectedVersion: number,
    command: (context: CommandContext) => TaskRecord,
  ): Promise<TaskRecord>;
}
