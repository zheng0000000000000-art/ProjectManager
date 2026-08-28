export type CommandErrorCode =
  | "VALIDATION_ERROR" | "NOT_FOUND" | "INVALID_TRANSITION"
  | "VERSION_CONFLICT" | "SCOPE_REQUIRED" | "STORAGE_ERROR";

export type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: CommandErrorCode; message: string; fieldErrors?: Record<string, string[]> };
