import { describe, expect, it } from "vitest";
import { commandResultResponse } from "./http";

describe("commandResultResponse", () => {
  it.each([
    ["VALIDATION_ERROR", 400],
    ["INVALID_TRANSITION", 409],
    ["SCOPE_REQUIRED", 403],
    ["ACTOR_NOT_ALLOWED", 403],
    ["OWNERSHIP_REQUIRED", 403],
    ["NOT_FOUND", 404],
    ["VERSION_CONFLICT", 409],
    ["PREREQUISITE_UNRESOLVED", 409],
    ["STORAGE_ERROR", 500],
  ] as const)("maps %s to HTTP %s", async (code, status) => {
    const response = commandResultResponse({ ok: false, code, message: "실패" });

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ ok: false, code, message: "실패" });
  });

  it("returns a successful command payload without losing data", async () => {
    const response = commandResultResponse({ ok: true, data: { taskId: "task-1" } }, 201);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true, data: { taskId: "task-1" } });
  });

  it("preserves completion validation feedback in a 400 response", async () => {
    const response = commandResultResponse({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "입력 내용을 확인해 주세요.",
      fieldErrors: { completionSummary: ["완료 결과를 입력해 주세요."] },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "입력 내용을 확인해 주세요.",
      fieldErrors: { completionSummary: ["완료 결과를 입력해 주세요."] },
    });
  });
});
