export type TaskErrorCode = "VALIDATION_ERROR" | "INVALID_TRANSITION";
export type TaskDomainReason =
  | "INVALID_FIELD"
  | "ACTOR_TYPE_REQUIRED"
  | "ASSIGNEE_REQUIRED"
  | "STATE_REQUIRED";

export class TaskDomainError extends Error {
  constructor(
    public readonly code: TaskErrorCode,
    message: string,
    public readonly field?: string,
    public readonly reason: TaskDomainReason = code === "VALIDATION_ERROR"
      ? "INVALID_FIELD"
      : "STATE_REQUIRED",
  ) {
    super(message);
    this.name = "TaskDomainError";
  }
}
