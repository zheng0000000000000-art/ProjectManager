export type TaskErrorCode = "VALIDATION_ERROR" | "INVALID_TRANSITION";

export class TaskDomainError extends Error {
  constructor(
    public readonly code: TaskErrorCode,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "TaskDomainError";
  }
}
