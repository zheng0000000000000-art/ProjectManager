import { TaskDomainError } from "./task-errors";
import type { PublishTaskValues, TaskRecord } from "./task";
import type { ActorContext } from "@/features/actors/domain/actor";

function requireText(value: string, field: string, message: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new TaskDomainError("VALIDATION_ERROR", message, field);
  }

  return normalized;
}

export function publish(task: TaskRecord, values: PublishTaskValues): TaskRecord {
  if (task.publicationState !== "draft") {
    throw new TaskDomainError(
      "INVALID_TRANSITION",
      "초안 상태의 작업만 공개할 수 있습니다.",
    );
  }

  const title = requireText(values.title, "title", "제목을 입력해 주세요.");
  const goal = requireText(values.goal, "goal", "목표를 입력해 주세요.");
  const workTypeId = requireText(
    values.workTypeId,
    "workTypeId",
    "작업 종류를 선택해 주세요.",
  );

  if (!Number.isInteger(values.estimatedBlocks) || values.estimatedBlocks < 1) {
    throw new TaskDomainError(
      "VALIDATION_ERROR",
      "예상 작업량은 1 이상의 정수로 입력해 주세요.",
      "estimatedBlocks",
    );
  }

  return {
    ...task,
    title,
    goal,
    workTypeId,
    estimatedBlocks: values.estimatedBlocks,
    deadline: values.deadline,
    publicationState: "published",
    workStatus: "open",
    version: task.version + 1,
  };
}

export function take(task: TaskRecord, actorId: string): TaskRecord {
  if (task.assigneeId) {
    throw new TaskDomainError(
      "INVALID_TRANSITION",
      "이미 다른 사용자가 가져간 작업입니다.",
    );
  }

  if (task.publicationState !== "published") {
    throw new TaskDomainError(
      "INVALID_TRANSITION",
      "공개된 작업만 가져갈 수 있습니다.",
    );
  }

  if (task.workStatus !== "open") {
    throw new TaskDomainError(
      "INVALID_TRANSITION",
      "열린 작업만 가져갈 수 있습니다.",
    );
  }

  return {
    ...task,
    assigneeId: actorId,
    workStatus: "taken",
    version: task.version + 1,
  };
}

export function start(task: TaskRecord, actorId: string, startedAt: string): TaskRecord {
  if (task.assigneeId !== actorId) {
    throw new TaskDomainError(
      "INVALID_TRANSITION",
      "담당자만 작업을 시작할 수 있습니다.",
    );
  }

  if (task.workStatus !== "taken") {
    throw new TaskDomainError(
      "INVALID_TRANSITION",
      "가져간 작업만 시작할 수 있습니다.",
    );
  }

  return {
    ...task,
    workStatus: "in_progress",
    startedAt,
    version: task.version + 1,
  };
}

export function complete(
  task: TaskRecord,
  actor: ActorContext,
  completionSummary: string,
  completedAt: string,
): TaskRecord {
  if (actor.actorType !== "human") {
    throw new TaskDomainError(
      "INVALID_TRANSITION",
      "사람 작업자만 작업을 완료할 수 있습니다.",
    );
  }

  if (task.assigneeId !== actor.userId) {
    throw new TaskDomainError(
      "INVALID_TRANSITION",
      "담당자만 작업을 완료할 수 있습니다.",
    );
  }

  if (task.workStatus !== "in_progress") {
    throw new TaskDomainError(
      "INVALID_TRANSITION",
      "진행 중인 작업만 완료할 수 있습니다.",
    );
  }

  if (!task.startedAt) {
    throw new TaskDomainError(
      "INVALID_TRANSITION",
      "시작 시간이 기록된 작업만 완료할 수 있습니다.",
    );
  }

  if (task.completedAt !== null || task.completionSummary !== null) {
    throw new TaskDomainError(
      "INVALID_TRANSITION",
      "완료 정보가 이미 기록된 작업입니다.",
    );
  }

  const normalizedSummary = requireText(
    completionSummary,
    "completionSummary",
    "완료 결과를 입력해 주세요.",
  );

  return {
    ...task,
    workStatus: "completed",
    completedAt,
    completionSummary: normalizedSummary,
    version: task.version + 1,
  };
}

export function returnToPool(task: TaskRecord, actorId: string): TaskRecord {
  if (task.assigneeId !== actorId) {
    throw new TaskDomainError(
      "INVALID_TRANSITION",
      "담당자만 작업을 돌려놓을 수 있습니다.",
    );
  }

  if (task.workStatus !== "taken") {
    throw new TaskDomainError(
      "INVALID_TRANSITION",
      "시작 전인 작업만 돌려놓을 수 있습니다.",
    );
  }

  return {
    ...task,
    assigneeId: null,
    workStatus: "open",
    version: task.version + 1,
  };
}
