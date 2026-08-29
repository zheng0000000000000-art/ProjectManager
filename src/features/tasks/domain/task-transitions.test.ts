import { describe, expect, it } from "vitest";

import type { TaskRecord } from "./task";
import { publish, returnToPool, start, take } from "./task-transitions";

const draft: TaskRecord = {
  id: "task-1",
  projectId: "project-default",
  title: "",
  goal: "",
  workTypeId: null,
  estimatedBlocks: null,
  deadline: null,
  publicationState: "draft",
  workStatus: "open",
  assigneeId: null,
  startedAt: null,
  version: 1,
};

const validInput = {
  title: "첫 번째 작업",
  goal: "핵심 흐름을 검증한다",
  workTypeId: "work-development",
  estimatedBlocks: 3,
  deadline: "2026-09-02",
};

describe("task transitions", () => {
  it("rejects a publish request without a title", () => {
    expect(() => publish(draft, { ...validInput, title: "" })).toThrowError(
      "제목을 입력해 주세요.",
    );
  });

  it("publishes a complete draft and increments its version", () => {
    expect(publish(draft, validInput)).toMatchObject({
      ...validInput,
      publicationState: "published",
      workStatus: "open",
      version: 2,
    });
    expect(draft.publicationState).toBe("draft");
  });

  it("lets a user take an available published task", () => {
    const published = publish(draft, validInput);

    expect(take(published, "user-fixed")).toMatchObject({
      assigneeId: "user-fixed",
      workStatus: "taken",
      version: 3,
    });
  });

  it("rejects taking a task that is already assigned", () => {
    const taken = take(publish(draft, validInput), "user-fixed");

    expect(() => take(taken, "another-user")).toThrowError(
      "이미 다른 사용자가 가져간 작업입니다.",
    );
  });

  it("lets the assignee start a taken task", () => {
    const taken = take(publish(draft, validInput), "user-fixed");

    expect(start(taken, "user-fixed", "2026-08-29T12:00:00.000Z")).toMatchObject({
      workStatus: "in_progress",
      startedAt: "2026-08-29T12:00:00.000Z",
      version: 4,
    });
  });

  it("returns a taken task to the open pool", () => {
    const taken = take(publish(draft, validInput), "user-fixed");

    expect(returnToPool(taken, "user-fixed")).toMatchObject({
      assigneeId: null,
      workStatus: "open",
      version: 4,
    });
  });

  it("does not return an in-progress task", () => {
    const taken = take(publish(draft, validInput), "user-fixed");
    const inProgress = start(taken, "user-fixed", "2026-08-29T12:00:00.000Z");

    expect(() => returnToPool(inProgress, "user-fixed")).toThrowError(
      "시작 전인 작업만 돌려놓을 수 있습니다.",
    );
  });

  it("rejects starting a task by a non-assignee", () => {
    const taken = take(publish(draft, validInput), "user-fixed");

    expect(() => start(taken, "another-user", "2026-08-29T12:00:00.000Z")).toThrowError(
      "담당자만 작업을 시작할 수 있습니다.",
    );
  });

  it("does not replace the first actual start time", () => {
    const taken = take(publish(draft, validInput), "user-fixed");
    const started = start(taken, "user-fixed", "2026-08-29T12:00:00.000Z");

    expect(() => start(started, "user-fixed", "2026-08-29T13:00:00.000Z")).toThrowError(
      "가져간 작업만 시작할 수 있습니다.",
    );
    expect(started.startedAt).toBe("2026-08-29T12:00:00.000Z");
  });
});
