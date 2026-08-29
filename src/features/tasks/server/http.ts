import { NextResponse } from "next/server";
import { ActorResolutionError } from "@/features/actors/server/actor-resolver";
import type { CommandResult } from "./command-result";

const statusByCode = {
  VALIDATION_ERROR: 400,
  INVALID_TRANSITION: 400,
  SCOPE_REQUIRED: 403,
  ACTOR_NOT_ALLOWED: 403,
  OWNERSHIP_REQUIRED: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  PREREQUISITE_UNRESOLVED: 409,
  STORAGE_ERROR: 500,
} as const;

export function commandResultResponse<T>(result: CommandResult<T>, successStatus = 200) {
  return NextResponse.json(result, { status: result.ok ? successStatus : statusByCode[result.code] });
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof ActorResolutionError) {
    return commandResultResponse({ ok: false, code: error.code, message: error.message });
  }
  console.error("Task API failed", error);
  return commandResultResponse({
    ok: false,
    code: "STORAGE_ERROR",
    message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  });
}

export function invalidJsonResponse(message = "요청 내용을 확인해 주세요.") {
  return commandResultResponse({ ok: false, code: "VALIDATION_ERROR", message });
}
