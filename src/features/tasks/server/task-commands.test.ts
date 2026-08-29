import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSchema } from "@/db/schema";
import { seedDefaultProject } from "@/db/seed";
import { SqliteTaskRepository } from "../data/sqlite-task-repository";
import { createTaskCommands } from "./task-commands";
import type { ActorContext } from "@/features/actors/domain/actor";
import { DEFAULT_PROJECT_ID } from "@/features/scope/domain/scope";

const databases: Database.Database[] = [];

const humanActor: ActorContext = {
  userId: "user-fixed", projectId: DEFAULT_PROJECT_ID, actorType: "human",
};

const codexActor: ActorContext = {
  userId: "user-codex", projectId: DEFAULT_PROJECT_ID, actorType: "ai",
};

function setup(actor: ActorContext = humanActor, clock = () => "2026-08-29T12:00:00.000Z") {
  const database = new Database(":memory:");
  databases.push(database);
  createSchema(database);
  seedDefaultProject(database);
  return {
    database,
    repository: new SqliteTaskRepository(database),
    commands: createTaskCommands(new SqliteTaskRepository(database), actor, clock),
  };
}

afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe("task commands", () => {
  it("records the Codex actor and actual start time through the shared commands", async () => {
    const { database, repository, commands } = setup(codexActor);
    const created = await commands.createDraft();
    if (!created.ok) throw new Error("draft failed");
    await commands.publishTask({
      taskId: created.data.taskId, expectedVersion: 1, title: "AI 작업",
      goal: "동일한 명령 경계를 검증한다", workTypeId: "work-development",
      estimatedBlocks: 1, deadline: null,
    });
    await commands.takeTask({ taskId: created.data.taskId, expectedVersion: 2 });
    await commands.startTask({ taskId: created.data.taskId, expectedVersion: 3 });

    expect(await repository.findById(created.data.taskId)).toMatchObject({
      assigneeId: "user-codex",
      workStatus: "in_progress",
      startedAt: "2026-08-29T12:00:00.000Z",
    });
    expect(database.prepare(`SELECT creator_id FROM tasks WHERE id = ?`).get(created.data.taskId))
      .toEqual({ creator_id: "user-codex" });
    expect(database.prepare(`SELECT DISTINCT actor_id FROM task_events WHERE task_id = ?`).all(created.data.taskId))
      .toEqual([{ actor_id: "user-codex" }]);
    expect(database.prepare(`SELECT created_at FROM task_events
      WHERE task_id = ? AND event_type = 'started'`).get(created.data.taskId))
      .toEqual({ created_at: "2026-08-29T12:00:00.000Z" });
  });

  it("does not let a human start the Codex worker's task", async () => {
    const { database, commands } = setup(codexActor);
    const created = await commands.createDraft();
    if (!created.ok) throw new Error("draft failed");
    await commands.publishTask({
      taskId: created.data.taskId, expectedVersion: 1, title: "AI 소유 작업",
      goal: "소유권을 검증한다", workTypeId: "work-development",
      estimatedBlocks: 1, deadline: null,
    });
    await commands.takeTask({ taskId: created.data.taskId, expectedVersion: 2 });
    const humanCommands = createTaskCommands(new SqliteTaskRepository(database), humanActor);

    await expect(humanCommands.startTask({ taskId: created.data.taskId, expectedVersion: 3 }))
      .resolves.toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
  });

  it("runs the complete workflow through version four", async () => {
    const { repository, commands } = setup();
    const created = await commands.createDraft();
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;

    const published = await commands.publishTask({
      taskId: created.data.taskId, expectedVersion: 1, title: "흐름 검증",
      goal: "전체 명령을 검증한다", workTypeId: "work-development",
      estimatedBlocks: 3, deadline: null,
    });
    expect(published).toMatchObject({ ok: true });
    const taken = await commands.takeTask({ taskId: created.data.taskId, expectedVersion: 2 });
    expect(taken).toMatchObject({ ok: true });
    const started = await commands.startTask({ taskId: created.data.taskId, expectedVersion: 3 });
    expect(started).toMatchObject({ ok: true });
    expect(await repository.findById(created.data.taskId)).toMatchObject({ version: 4, workStatus: "in_progress" });
  });

  it("maps field validation and stale versions to safe Korean errors", async () => {
    const { commands } = setup();
    const created = await commands.createDraft();
    if (!created.ok) throw new Error("draft failed");
    expect(await commands.publishTask({
      taskId: created.data.taskId, expectedVersion: 1, title: "", goal: "",
      workTypeId: "", estimatedBlocks: 0, deadline: null,
    })).toEqual({
      ok: false, code: "VALIDATION_ERROR", message: "입력 내용을 확인해 주세요.",
      fieldErrors: { title: ["제목을 입력해 주세요."] },
    });
    expect(await commands.takeTask({ taskId: created.data.taskId, expectedVersion: 0 })).toMatchObject({
      ok: false, code: "VERSION_CONFLICT",
      message: "다른 변경 사항이 반영되었습니다. 최신 내용을 불러와 다시 시도해 주세요.",
    });
  });

  it("returns a taken task to the pool and records one event", async () => {
    const { repository, commands } = setup();
    const created = await commands.createDraft();
    if (!created.ok) throw new Error("draft failed");
    await commands.publishTask({
      taskId: created.data.taskId, expectedVersion: 1, title: "반환할 작업",
      goal: "작업 풀로 돌려보낸다", workTypeId: "work-development",
      estimatedBlocks: 2, deadline: null,
    });
    await commands.takeTask({ taskId: created.data.taskId, expectedVersion: 2 });

    expect(await commands.returnTask({
      taskId: created.data.taskId,
      expectedVersion: 3,
    })).toMatchObject({ ok: true });
    expect(await repository.findById(created.data.taskId)).toMatchObject({
      assigneeId: null,
      workStatus: "open",
      version: 4,
    });
    expect(await repository.countEvents(created.data.taskId)).toBe(4);
  });

  it("rejects take when the admin member's work scope was revoked", async () => {
    const { database, commands } = setup();
    const created = await commands.createDraft();
    if (!created.ok) throw new Error("draft failed");
    await commands.publishTask({
      taskId: created.data.taskId, expectedVersion: 1, title: "권한 검증",
      goal: "관리자도 범위가 필요하다", workTypeId: "work-development",
      estimatedBlocks: 1, deadline: null,
    });
    database.prepare("UPDATE member_work_scopes SET active = 0 WHERE work_type_id = 'work-development'").run();

    expect(await commands.takeTask({ taskId: created.data.taskId, expectedVersion: 2 })).toEqual({
      ok: false,
      code: "SCOPE_REQUIRED",
      message: "이 작업 종류를 가져갈 수 있는 활성 작업 범위가 없습니다.",
    });
  });

  it("returns a classified error when a prerequisite is unresolved", async () => {
    const { database, commands } = setup();
    const prerequisite = await commands.createDraft();
    const created = await commands.createDraft();
    if (!prerequisite.ok || !created.ok) throw new Error("draft failed");
    await commands.publishTask({
      taskId: created.data.taskId, expectedVersion: 1, title: "차단된 작업",
      goal: "선행 작업 뒤에 가져간다", workTypeId: "work-development",
      estimatedBlocks: 1, deadline: null,
    });
    database.prepare(`INSERT INTO task_prerequisites
      (task_id, prerequisite_task_id, resolved_at) VALUES (?, ?, NULL)`)
      .run(created.data.taskId, prerequisite.data.taskId);

    expect(await commands.takeTask({ taskId: created.data.taskId, expectedVersion: 2 })).toEqual({
      ok: false,
      code: "PREREQUISITE_UNRESOLVED",
      message: "완료되지 않은 선행 작업이 있어 가져갈 수 없습니다.",
    });
  });
});
