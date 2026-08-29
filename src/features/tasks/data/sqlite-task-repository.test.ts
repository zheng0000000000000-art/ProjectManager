import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { publish, take } from "../domain/task-transitions";
import { createSchema } from "@/db/schema";
import { seedDefaultProject } from "@/db/seed";
import { DEFAULT_PROJECT_ID } from "@/features/scope/domain/scope";
import { SqliteTaskRepository } from "./sqlite-task-repository";
import type { ActorContext } from "@/features/actors/domain/actor";
import type { SuccessAuditInput } from "./task-repository";

const databases: Database.Database[] = [];
const humanActor: ActorContext = {
  userId: "user-fixed", projectId: DEFAULT_PROJECT_ID, actorType: "human",
};

function setup() {
  const database = new Database(":memory:");
  databases.push(database);
  createSchema(database);
  seedDefaultProject(database);
  return { database, repository: new SqliteTaskRepository(database) };
}

function audit(overrides: Partial<SuccessAuditInput> = {}): SuccessAuditInput {
  return {
    projectId: DEFAULT_PROJECT_ID,
    taskId: null,
    actorId: humanActor.userId,
    action: "task.create",
    errorCode: null,
    requestId: "request-create",
    metadata: { actorType: "human" },
    createdAt: "2026-08-29T12:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
});

describe("SqliteTaskRepository", () => {
  it("creates a draft with one event and one linked success audit", async () => {
    const { database, repository } = setup();
    const draft = await repository.createDraft(
      "user-fixed",
      DEFAULT_PROJECT_ID,
      audit(),
    );

    expect(draft).toMatchObject({
      publicationState: "draft",
      workStatus: "open",
      projectId: DEFAULT_PROJECT_ID,
      completedAt: null,
      completionSummary: null,
      version: 1,
    });
    expect(database.prepare("SELECT COUNT(*) count FROM tasks").get()).toEqual({ count: 1 });
    expect(await repository.countEvents(draft.id)).toBe(1);
    expect(database.prepare(`SELECT task_id, action, outcome, error_code, from_state, to_state,
      request_id, metadata_json, created_at FROM audit_logs`).all()).toEqual([{
      task_id: draft.id,
      action: "task.create",
      outcome: "success",
      error_code: null,
      from_state: null,
      to_state: "draft",
      request_id: "request-create",
      metadata_json: JSON.stringify({ actorType: "human" }),
      created_at: "2026-08-29T12:00:00.000Z",
    }]);
  });

  it("commits a task change, event, and work-status success audit together", async () => {
    const { database, repository } = setup();
    const draft = await repository.createDraft("user-fixed", DEFAULT_PROJECT_ID, audit());

    await repository.runCommand(draft.id, 1, audit({
      taskId: draft.id,
      action: "task.publish",
      requestId: "request-publish",
      metadata: { expectedVersion: 1, fieldNames: ["title", "goal"], actorType: "human" },
    }), ({ task, appendEvent }) => {
      const next = publish(task, {
        title: "저장되는 작업",
        goal: "트랜잭션을 검증한다",
        workTypeId: "work-development",
        estimatedBlocks: 3,
        deadline: null,
      });
      appendEvent({
        eventType: "published",
        actorId: "user-fixed",
        fromState: "draft",
        toState: "published",
        createdAt: "2026-08-29T12:00:00.000Z",
      });
      return next;
    });

    expect((await repository.findById(draft.id))?.version).toBe(2);
    expect(await repository.countEvents(draft.id)).toBe(2);
    expect(database.prepare(`SELECT action, outcome, error_code, from_state, to_state, request_id
      FROM audit_logs WHERE request_id = 'request-publish'`).get()).toEqual({
      action: "task.publish",
      outcome: "success",
      error_code: null,
      from_state: "open",
      to_state: "open",
      request_id: "request-publish",
    });
  });

  it("rolls back both the task and event when a command fails", async () => {
    const { repository } = setup();
    const draft = await repository.createDraft("user-fixed", DEFAULT_PROJECT_ID, audit());

    await expect(
      repository.runCommand(draft.id, 1, audit({
        taskId: draft.id,
        action: "task.publish",
        requestId: "request-failed-command",
      }), ({ appendEvent }) => {
        appendEvent({
          eventType: "published",
          actorId: "user-fixed",
          fromState: "draft",
          toState: "published",
          createdAt: "2026-08-29T12:00:00.000Z",
        });
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");

    expect((await repository.findById(draft.id))?.version).toBe(1);
    expect(await repository.countEvents(draft.id)).toBe(1);
  });

  it("rolls back the task and event when the success audit insert fails", async () => {
    const { database, repository } = setup();
    const draft = await repository.createDraft("user-fixed", DEFAULT_PROJECT_ID, audit());
    database.exec(`CREATE TEMP TRIGGER reject_success_audit
      BEFORE INSERT ON audit_logs
      BEGIN
        SELECT RAISE(ABORT, 'audit rejected');
      END`);

    await expect(repository.runCommand(draft.id, 1, audit({
      taskId: draft.id,
      action: "task.publish",
      requestId: "request-rejected-audit",
    }), ({ task, appendEvent }) => {
      const next = publish(task, {
        title: "되돌릴 작업",
        goal: "감사 로그 실패 시 모두 되돌린다",
        workTypeId: "work-development",
        estimatedBlocks: 2,
        deadline: null,
      });
      appendEvent({
        eventType: "published",
        actorId: "user-fixed",
        fromState: "draft",
        toState: "published",
        createdAt: "2026-08-29T12:00:00.000Z",
      });
      return next;
    })).rejects.toThrow("audit rejected");

    expect(await repository.findById(draft.id)).toMatchObject({
      title: "",
      publicationState: "draft",
      version: 1,
    });
    expect(await repository.countEvents(draft.id)).toBe(1);
    expect(database.prepare("SELECT COUNT(*) count FROM audit_logs").get()).toEqual({ count: 1 });
  });

  it("persists and reads completion fields in a command update", async () => {
    const { repository } = setup();
    const draft = await repository.createDraft("user-fixed", DEFAULT_PROJECT_ID, audit());

    await repository.runCommand(draft.id, 1, audit({
      taskId: draft.id,
      action: "task.complete",
      requestId: "request-complete",
      metadata: { expectedVersion: 1, fieldNames: ["completionSummary"], actorType: "human" },
    }), ({ task, appendEvent }) => {
      const next = {
        ...task,
        workStatus: "completed" as const,
        completedAt: "2026-08-29T12:05:00.000Z",
        completionSummary: "완료 결과",
        version: task.version + 1,
      };
      appendEvent({
        eventType: "completed",
        actorId: "user-fixed",
        fromState: task.workStatus,
        toState: next.workStatus,
        createdAt: next.completedAt,
      });
      return next;
    });

    expect(await repository.findById(draft.id)).toMatchObject({
      workStatus: "completed",
      completedAt: "2026-08-29T12:05:00.000Z",
      completionSummary: "완료 결과",
      version: 2,
    });
  });

  it("rejects a stale version without adding an event", async () => {
    const { repository } = setup();
    const draft = await repository.createDraft("user-fixed", DEFAULT_PROJECT_ID, audit());

    await expect(
      repository.runCommand(draft.id, 0, audit({
        taskId: draft.id,
        action: "task.publish",
        requestId: "request-stale",
      }), () => draft),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(await repository.countEvents(draft.id)).toBe(1);
  });

  it("shows a published task only while the actor has active scope", async () => {
    const { database, repository } = setup();
    const draft = await repository.createDraft("user-fixed", DEFAULT_PROJECT_ID, audit());
    await repository.runCommand(draft.id, 1, audit({ taskId: draft.id, action: "task.publish", requestId: "request-scope-publish" }), ({ task, appendEvent }) => {
      const next = publish(task, {
        title: "범위 작업", goal: "범위가 있는 사람만 본다", workTypeId: "work-development",
        estimatedBlocks: 2, deadline: null,
      });
      appendEvent({ eventType: "published", actorId: "user-fixed", fromState: "draft", toState: "published", createdAt: "2026-08-29T12:00:00.000Z" });
      return next;
    });

    expect((await repository.listPool(humanActor)).map((task) => task.id)).toContain(draft.id);
    database.prepare("UPDATE member_work_scopes SET active = 0 WHERE work_type_id = 'work-development'").run();
    expect((await repository.listPool(humanActor)).map((task) => task.id)).not.toContain(draft.id);
  });

  it("hides and rejects a task until every prerequisite is resolved", async () => {
    const { database, repository } = setup();
    const prerequisite = await repository.createDraft("user-fixed", DEFAULT_PROJECT_ID, audit({ requestId: "request-prerequisite" }));
    const draft = await repository.createDraft("user-fixed", DEFAULT_PROJECT_ID, audit({ requestId: "request-dependent" }));
    await repository.runCommand(draft.id, 1, audit({ taskId: draft.id, action: "task.publish", requestId: "request-prerequisite-publish" }), ({ task, appendEvent }) => {
      const next = publish(task, {
        title: "선행 조건 작업", goal: "선행 작업이 끝난 뒤 가져간다", workTypeId: "work-development",
        estimatedBlocks: 1, deadline: null,
      });
      appendEvent({ eventType: "published", actorId: "user-fixed", fromState: "draft", toState: "published", createdAt: "2026-08-29T12:00:00.000Z" });
      return next;
    });
    database.prepare(`INSERT INTO task_prerequisites
      (task_id, prerequisite_task_id, resolved_at) VALUES (?, ?, NULL)`).run(draft.id, prerequisite.id);

    expect((await repository.listPool(humanActor)).map((task) => task.id)).not.toContain(draft.id);
    await expect(repository.runCommand(draft.id, 2, audit({ taskId: draft.id, action: "task.take", requestId: "request-blocked-take" }), ({ task, appendEvent, requireTakeEligibility }) => {
      requireTakeEligibility(humanActor);
      const next = take(task, humanActor.userId);
      appendEvent({ eventType: "taken", actorId: humanActor.userId, fromState: "open", toState: "taken", createdAt: "2026-08-29T12:00:00.000Z" });
      return next;
    })).rejects.toMatchObject({ code: "PREREQUISITE_UNRESOLVED" });

    database.prepare(`UPDATE task_prerequisites SET resolved_at = '2026-08-29T12:00:00.000Z'
      WHERE task_id = ? AND prerequisite_task_id = ?`).run(draft.id, prerequisite.id);
    expect((await repository.listPool(humanActor)).map((task) => task.id)).toContain(draft.id);
  });

  it("rejects publishing with a work type from another project", async () => {
    const { database, repository } = setup();
    database.prepare("INSERT INTO projects (id, name) VALUES ('other-project', '다른 프로젝트')").run();
    database.prepare("INSERT INTO work_types (id, project_id, name) VALUES ('other-work', 'other-project', '외부')").run();
    const draft = await repository.createDraft("user-fixed", DEFAULT_PROJECT_ID, audit());

    await expect(repository.runCommand(draft.id, 1, audit({ taskId: draft.id, action: "task.publish", requestId: "request-invalid-work-type" }), ({ task, appendEvent }) => {
      const next = publish(task, {
        title: "잘못된 연결", goal: "다른 프로젝트 작업 종류", workTypeId: "other-work",
        estimatedBlocks: 1, deadline: null,
      });
      appendEvent({ eventType: "published", actorId: "user-fixed", fromState: "draft", toState: "published", createdAt: "2026-08-29T12:00:00.000Z" });
      return next;
    })).rejects.toThrow();
  });
});
