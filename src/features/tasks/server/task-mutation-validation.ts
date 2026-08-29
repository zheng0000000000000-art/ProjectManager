import type { TaskAuditAction } from "@/features/audit/domain/audit-entry";

const fieldNamesByAction = {
  "task.create": [],
  "task.publish": [
    "expectedVersion",
    "title",
    "goal",
    "workTypeId",
    "estimatedBlocks",
    "deadline",
  ],
  "task.take": ["expectedVersion"],
  "task.start": ["expectedVersion"],
  "task.return": ["expectedVersion"],
  "task.complete": ["expectedVersion", "completionSummary"],
} as const satisfies Record<TaskAuditAction, readonly string[]>;

export function isValidExpectedVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function safeTaskMutationFieldNames(
  action: TaskAuditAction,
  candidates: readonly unknown[],
): string[] {
  const allowed = new Set<string>(fieldNamesByAction[action]);
  const safeNames: string[] = [];

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !allowed.has(candidate) || safeNames.includes(candidate)) {
      continue;
    }
    safeNames.push(candidate);
  }

  return safeNames;
}
