import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  completeTaskBodySchema,
  parseTaskMutationJson,
} from "./task-request-validation";

function jsonRequest(body: string) {
  return new Request("http://localhost/api/tasks/task-1/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("task request validation", () => {
  it("returns validated data without retaining the raw request body", async () => {
    const result = await parseTaskMutationJson(
      jsonRequest(JSON.stringify({ expectedVersion: 4, completionSummary: "완료" })),
      completeTaskBodySchema,
      "task.complete",
    );

    expect(result).toEqual({
      ok: true,
      data: { expectedVersion: 4, completionSummary: "완료" },
    });
  });

  it("classifies malformed JSON as validation with no invented field name", async () => {
    const rawSecret = "raw-malformed-secret";

    const result = await parseTaskMutationJson(
      jsonRequest(`{"completionSummary":"${rawSecret}"`),
      completeTaskBodySchema,
      "task.complete",
    );

    expect(result).toEqual({ ok: false, fieldNames: [] });
    expect(JSON.stringify(result)).not.toContain(rawSecret);
  });

  it("keeps only safe Zod field names and a separately validated version", async () => {
    const rawSecret = "raw-summary-secret";

    const result = await parseTaskMutationJson(
      jsonRequest(JSON.stringify({
        expectedVersion: 4,
        completionSummary: { rawSecret },
      })),
      completeTaskBodySchema,
      "task.complete",
    );

    expect(result).toEqual({
      ok: false,
      fieldNames: ["completionSummary"],
      expectedVersion: 4,
    });
    expect(JSON.stringify(result)).not.toContain(rawSecret);
  });

  it.each([undefined, "4", 0, -1, 1.5])(
    "never returns an unsafe expected version from %j",
    async (expectedVersion) => {
      const result = await parseTaskMutationJson(
        jsonRequest(JSON.stringify({ expectedVersion, completionSummary: "완료" })),
        completeTaskBodySchema,
        "task.complete",
      );

      expect(result).toEqual({ ok: false, fieldNames: ["expectedVersion"] });
    },
  );

  it("filters duplicate and unrecognized issue paths through the action allowlist", async () => {
    const adversarialSchema = z.unknown().superRefine((_, context) => {
      context.addIssue({ code: "custom", message: "first", path: ["completionSummary"] });
      context.addIssue({ code: "custom", message: "duplicate", path: ["completionSummary", "nested"] });
      context.addIssue({ code: "custom", message: "unsafe", path: ["rawBody"] });
    });

    const result = await parseTaskMutationJson(
      jsonRequest(JSON.stringify({ rawBody: "must-not-be-routed" })),
      adversarialSchema,
      "task.complete",
    );

    expect(result).toEqual({ ok: false, fieldNames: ["completionSummary"] });
  });
});
