import { z } from "zod";
import type { TaskAuditAction } from "@/features/audit/domain/audit-entry";
import {
  isValidExpectedVersion,
  safeTaskMutationFieldNames,
} from "./task-mutation-validation";

export const publishTaskBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string(),
  goal: z.string(),
  workTypeId: z.string(),
  estimatedBlocks: z.number().int(),
  deadline: z.string().nullable().optional(),
});

export const versionedTaskBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export const completeTaskBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
  completionSummary: z.string(),
});

type InvalidTaskMutationJson = {
  ok: false;
  fieldNames: string[];
  expectedVersion?: number;
};

export async function parseTaskMutationJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  action: TaskAuditAction,
): Promise<{ ok: true; data: T } | InvalidTaskMutationJson> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, fieldNames: [] };
  }

  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };

  const fieldNames = safeTaskMutationFieldNames(
    action,
    parsed.error.issues.map((issue) => issue.path[0]),
  );
  const expectedVersion = typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).expectedVersion
    : undefined;

  return isValidExpectedVersion(expectedVersion)
    ? { ok: false, fieldNames, expectedVersion }
    : { ok: false, fieldNames };
}
