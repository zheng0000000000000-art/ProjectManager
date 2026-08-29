import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSchema } from "@/db/schema";
import { seedDefaultProject } from "@/db/seed";
import { SqliteAuditRepository } from "@/features/audit/data/sqlite-audit-repository";
import type { ActorContext } from "@/features/actors/domain/actor";
import { DEFAULT_PROJECT_ID } from "@/features/scope/domain/scope";
import { SqliteTaskRepository } from "../data/sqlite-task-repository";
import type { TaskRecord } from "../domain/task";
import type { CommandResult } from "./command-result";
import { createTaskCommands } from "./task-commands";

const databases: Database.Database[] = [];
const commandTime = "2026-08-29T15:00:00.000Z";

const humanActor: ActorContext = {
  userId: "user-fixed", projectId: DEFAULT_PROJECT_ID, actorType: "human",
};

const codexActor: ActorContext = {
  userId: "user-codex", projectId: DEFAULT_PROJECT_ID, actorType: "ai",
};

function setup() {
  const database = new Database(":memory:");
  databases.push(database);
  createSchema(database);
  seedDefaultProject(database);
  return {
    database,
    tasks: new SqliteTaskRepository(database),
    audits: new SqliteAuditRepository(database),
  };
}

function commandsFor(
  fixture: ReturnType<typeof setup>,
  actor: ActorContext,
  requestId: string,
  clock = () => commandTime,
) {
  return createTaskCommands(fixture.tasks, fixture.audits, actor, { requestId, clock });
}

function taskIdFrom(result: CommandResult<{ taskId: string }>) {
  if (!result.ok) throw new Error(`task setup failed: ${result.code}`);
  return result.data.taskId;
}

async function prepareDraft(
  fixture: ReturnType<typeof setup>,
  actor: ActorContext,
  prefix: string,
) {
  return taskIdFrom(await commandsFor(fixture, actor, `${prefix}-create`).createDraft());
}

async function preparePublished(
  fixture: ReturnType<typeof setup>,
  actor: ActorContext,
  prefix: string,
) {
  const taskId = await prepareDraft(fixture, actor, prefix);
  const result = await commandsFor(fixture, actor, `${prefix}-publish`).publishTask({
    taskId,
    expectedVersion: 1,
    title: `${prefix} 작업`,
    goal: `${prefix} 흐름을 검증한다`,
    workTypeId: "work-development",
    estimatedBlocks: 1,
    deadline: null,
  });
  if (!result.ok) throw new Error(`publish setup failed: ${result.code}`);
  return taskId;
}

async function prepareTaken(
  fixture: ReturnType<typeof setup>,
  actor: ActorContext,
  prefix: string,
) {
  const taskId = await preparePublished(fixture, actor, prefix);
  const result = await commandsFor(fixture, actor, `${prefix}-take`).takeTask({
    taskId,
    expectedVersion: 2,
  });
  if (!result.ok) throw new Error(`take setup failed: ${result.code}`);
  return taskId;
}

async function prepareRunning(
  fixture: ReturnType<typeof setup>,
  actor: ActorContext,
  prefix: string,
) {
  const taskId = await prepareTaken(fixture, actor, prefix);
  const result = await commandsFor(fixture, actor, `${prefix}-start`).startTask({
    taskId,
    expectedVersion: 3,
  });
  if (!result.ok) throw new Error(`start setup failed: ${result.code}`);
  return taskId;
}

afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach((database) => database.close());
});

describe("task commands", () => {
  it("records one atomic success audit for each shared Codex command", async () => {
    const fixture = setup();
    const commands = commandsFor(fixture, codexActor, "request-codex");
    const taskId = taskIdFrom(await commands.createDraft());
    await commands.publishTask({
      taskId, expectedVersion: 1, title: "AI 작업",
      goal: "동일한 명령 경계를 검증한다", workTypeId: "work-development",
      estimatedBlocks: 1, deadline: null,
    });
    await commands.takeTask({ taskId, expectedVersion: 2 });
    await commands.startTask({ taskId, expectedVersion: 3 });

    expect(await fixture.tasks.findById(taskId)).toMatchObject({
      assigneeId: "user-codex",
      workStatus: "in_progress",
      startedAt: commandTime,
    });
    expect(fixture.database.prepare(`SELECT creator_id FROM tasks WHERE id = ?`).get(taskId))
      .toEqual({ creator_id: "user-codex" });
    expect(fixture.database.prepare(`SELECT DISTINCT actor_id FROM task_events WHERE task_id = ?`).all(taskId))
      .toEqual([{ actor_id: "user-codex" }]);
    expect(fixture.database.prepare(`SELECT created_at FROM task_events
      WHERE task_id = ? AND event_type = 'started'`).get(taskId))
      .toEqual({ created_at: commandTime });
    const audits = fixture.audits.listByRequestIdForTest("request-codex");
    expect(audits).toHaveLength(4);
    expect(audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "task.create", outcome: "success", actorId: "user-codex" }),
      expect.objectContaining({ action: "task.publish", outcome: "success", actorId: "user-codex" }),
      expect.objectContaining({ action: "task.take", outcome: "success", actorId: "user-codex" }),
      expect.objectContaining({ action: "task.start", outcome: "success", actorId: "user-codex" }),
    ]));
  });

  it("completes a human task with the same event and audit time", async () => {
    const fixture = setup();
    const taskId = await prepareRunning(fixture, humanActor, "completion");
    const context = { requestId: "request-complete", clock: () => commandTime };
    const commands = createTaskCommands(fixture.tasks, fixture.audits, humanActor, context);

    const result = await commands.completeTask({
      taskId,
      expectedVersion: 4,
      completionSummary: "  완료했다  ",
    });

    expect(result).toEqual({ ok: true, data: { taskId } });
    expect(await fixture.tasks.findById(taskId)).toMatchObject({
      workStatus: "completed",
      completedAt: commandTime,
      completionSummary: "완료했다",
      version: 5,
    });
    expect(fixture.database.prepare(`SELECT event_type, created_at FROM task_events
      WHERE task_id = ? AND event_type = 'completed'`).get(taskId)).toEqual({
      event_type: "completed",
      created_at: commandTime,
    });
    expect(fixture.audits.listByRequestIdForTest("request-complete")).toEqual([
      expect.objectContaining({
        action: "task.complete",
        outcome: "success",
        fromState: "in_progress",
        toState: "completed",
        createdAt: commandTime,
      }),
    ]);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["fractional", 1.5],
    ["negative", -1],
  ])("rejects an unsafe %s expected version before repository mutation", async (label, expectedVersion) => {
    const fixture = setup();
    const taskId = await preparePublished(fixture, humanActor, `unsafe-version-${label}`);
    const beforeTask = await fixture.tasks.findById(taskId);
    const beforeEventCount = await fixture.tasks.countEvents(taskId);
    const requestId = `request-unsafe-version-${label}`;

    const result = await commandsFor(fixture, humanActor, requestId).takeTask({
      taskId,
      expectedVersion,
    });

    expect(result).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "입력 내용을 확인해 주세요.",
      fieldErrors: { expectedVersion: ["작업 버전을 확인해 주세요."] },
    });
    expect(await fixture.tasks.findById(taskId)).toEqual(beforeTask);
    expect(await fixture.tasks.countEvents(taskId)).toBe(beforeEventCount);
    expect(fixture.audits.listByRequestIdForTest(requestId)).toEqual([
      expect.objectContaining({
        taskId,
        action: "task.take",
        outcome: "failure",
        errorCode: "VALIDATION_ERROR",
        fromState: "open",
        toState: null,
        metadata: {
          fieldNames: ["expectedVersion"],
          actorType: "human",
        },
      }),
    ]);
  });

  it("returns a taken task to the pool with one event and one success audit", async () => {
    const fixture = setup();
    const taskId = await prepareTaken(fixture, humanActor, "return");

    expect(await commandsFor(fixture, humanActor, "request-return").returnTask({
      taskId,
      expectedVersion: 3,
    })).toEqual({ ok: true, data: { taskId } });
    expect(await fixture.tasks.findById(taskId)).toMatchObject({
      assigneeId: null,
      workStatus: "open",
      version: 4,
    });
    expect(await fixture.tasks.countEvents(taskId)).toBe(4);
    expect(fixture.audits.listByRequestIdForTest("request-return")).toEqual([
      expect.objectContaining({ action: "task.return", outcome: "success", toState: "open" }),
    ]);
  });

  type FailureAttempt = {
    taskId: string;
    beforeTask: TaskRecord | null;
    beforeEventCount: number;
    result: CommandResult<{ taskId: string }>;
  };

  type FailureCase = {
    name: string;
    requestId: string;
    action: "task.publish" | "task.take" | "task.complete";
    resultCode: "VALIDATION_ERROR" | "ACTOR_NOT_ALLOWED" | "SCOPE_REQUIRED" |
      "PREREQUISITE_UNRESOLVED" | "OWNERSHIP_REQUIRED" | "INVALID_TRANSITION" |
      "NOT_FOUND" | "VERSION_CONFLICT";
    auditCode: string;
    fieldNames: string[];
    actorType?: "human" | "ai";
    expectedVersion: number;
    attempt(fixture: ReturnType<typeof setup>): Promise<FailureAttempt>;
  };

  async function captureFailure(
    fixture: ReturnType<typeof setup>,
    taskId: string,
    run: () => Promise<CommandResult<{ taskId: string }>>,
  ): Promise<FailureAttempt> {
    const beforeTask = await fixture.tasks.findById(taskId);
    const beforeEventCount = await fixture.tasks.countEvents(taskId);
    const result = await run();
    return { taskId, beforeTask, beforeEventCount, result };
  }

  const failureCases: FailureCase[] = [
    {
      name: "validation failure",
      requestId: "request-validation",
      action: "task.complete",
      resultCode: "VALIDATION_ERROR",
      auditCode: "VALIDATION_ERROR",
      fieldNames: ["completionSummary"],
      expectedVersion: 4,
      async attempt(fixture) {
        const taskId = await prepareRunning(fixture, humanActor, "validation");
        return captureFailure(fixture, taskId, () => commandsFor(fixture, humanActor, this.requestId).completeTask({
          taskId, expectedVersion: this.expectedVersion, completionSummary: "   ",
        }));
      },
    },
    {
      name: "scope failure",
      requestId: "request-scope",
      action: "task.take",
      resultCode: "SCOPE_REQUIRED",
      auditCode: "SCOPE_REQUIRED",
      fieldNames: [],
      expectedVersion: 2,
      async attempt(fixture) {
        const taskId = await preparePublished(fixture, humanActor, "scope");
        fixture.database.prepare("UPDATE member_work_scopes SET active = 0 WHERE work_type_id = 'work-development'").run();
        return captureFailure(fixture, taskId, () => commandsFor(fixture, humanActor, this.requestId).takeTask({
          taskId, expectedVersion: this.expectedVersion,
        }));
      },
    },
    {
      name: "prerequisite failure",
      requestId: "request-prerequisite",
      action: "task.take",
      resultCode: "PREREQUISITE_UNRESOLVED",
      auditCode: "PREREQUISITE_UNRESOLVED",
      fieldNames: [],
      expectedVersion: 2,
      async attempt(fixture) {
        const prerequisiteId = await prepareDraft(fixture, humanActor, "prerequisite-blocker");
        const taskId = await preparePublished(fixture, humanActor, "prerequisite-target");
        fixture.database.prepare(`INSERT INTO task_prerequisites
          (task_id, prerequisite_task_id, resolved_at) VALUES (?, ?, NULL)`)
          .run(taskId, prerequisiteId);
        return captureFailure(fixture, taskId, () => commandsFor(fixture, humanActor, this.requestId).takeTask({
          taskId, expectedVersion: this.expectedVersion,
        }));
      },
    },
    {
      name: "actor-type failure",
      requestId: "request-actor-type",
      action: "task.complete",
      resultCode: "ACTOR_NOT_ALLOWED",
      auditCode: "ACTOR_REJECTED",
      fieldNames: [],
      actorType: "ai",
      expectedVersion: 4,
      async attempt(fixture) {
        const taskId = await prepareRunning(fixture, codexActor, "actor-type");
        return captureFailure(fixture, taskId, () => commandsFor(fixture, codexActor, this.requestId).completeTask({
          taskId, expectedVersion: this.expectedVersion, completionSummary: "완료 시도",
        }));
      },
    },
    {
      name: "ownership failure",
      requestId: "request-ownership",
      action: "task.complete",
      resultCode: "OWNERSHIP_REQUIRED",
      auditCode: "OWNERSHIP_REQUIRED",
      fieldNames: [],
      expectedVersion: 4,
      async attempt(fixture) {
        const taskId = await prepareRunning(fixture, codexActor, "ownership");
        return captureFailure(fixture, taskId, () => commandsFor(fixture, humanActor, this.requestId).completeTask({
          taskId, expectedVersion: this.expectedVersion, completionSummary: "완료 시도",
        }));
      },
    },
    {
      name: "state failure",
      requestId: "request-state",
      action: "task.complete",
      resultCode: "INVALID_TRANSITION",
      auditCode: "INVALID_TRANSITION",
      fieldNames: [],
      expectedVersion: 3,
      async attempt(fixture) {
        const taskId = await prepareTaken(fixture, humanActor, "state");
        return captureFailure(fixture, taskId, () => commandsFor(fixture, humanActor, this.requestId).completeTask({
          taskId, expectedVersion: this.expectedVersion, completionSummary: "완료 시도",
        }));
      },
    },
    {
      name: "not-found failure",
      requestId: "request-not-found",
      action: "task.take",
      resultCode: "NOT_FOUND",
      auditCode: "NOT_FOUND",
      fieldNames: [],
      expectedVersion: 1,
      async attempt(fixture) {
        const taskId = "missing-task";
        return captureFailure(fixture, taskId, () => commandsFor(fixture, humanActor, this.requestId).takeTask({
          taskId, expectedVersion: this.expectedVersion,
        }));
      },
    },
    {
      name: "stale-version failure",
      requestId: "request-version",
      action: "task.publish",
      resultCode: "VERSION_CONFLICT",
      auditCode: "VERSION_CONFLICT",
      fieldNames: [],
      expectedVersion: 2,
      async attempt(fixture) {
        const taskId = await prepareDraft(fixture, humanActor, "version");
        return captureFailure(fixture, taskId, () => commandsFor(fixture, humanActor, this.requestId).publishTask({
          taskId,
          expectedVersion: this.expectedVersion,
          title: "오래된 변경",
          goal: "버전 충돌을 검증한다",
          workTypeId: "work-development",
          estimatedBlocks: 1,
          deadline: null,
        }));
      },
    },
  ];

  it.each(failureCases)("audits exactly one $name without task or event changes", async (testCase) => {
    const fixture = setup();
    const attempt = await testCase.attempt(fixture);
    const failureAudit = fixture.audits.listByRequestIdForTest(testCase.requestId);

    expect(attempt.result).toMatchObject({ ok: false, code: testCase.resultCode });
    expect(failureAudit).toEqual([
      expect.objectContaining({
        action: testCase.action,
        outcome: "failure",
        errorCode: testCase.auditCode,
        toState: null,
        metadata: {
          expectedVersion: testCase.expectedVersion,
          fieldNames: testCase.fieldNames,
          actorType: testCase.actorType ?? "human",
        },
      }),
    ]);
    expect(failureAudit.filter((entry) => entry.outcome === "success")).toHaveLength(0);
    expect(await fixture.tasks.findById(attempt.taskId)).toEqual(attempt.beforeTask);
    expect(await fixture.tasks.countEvents(attempt.taskId)).toBe(attempt.beforeEventCount);
  });

  it("classifies a structurally equivalent domain error from another bundle", async () => {
    const fixture = setup();
    const taskId = await prepareRunning(fixture, humanActor, "structural-domain");
    vi.spyOn(fixture.tasks, "runCommand").mockRejectedValue({
      name: "TaskDomainError",
      code: "VALIDATION_ERROR",
      reason: "INVALID_FIELD",
      message: "완료 결과를 입력해 주세요.",
      field: "completionSummary",
    });

    const result = await commandsFor(fixture, humanActor, "request-structural-domain").completeTask({
      taskId,
      expectedVersion: 4,
      completionSummary: "완료",
    });

    expect(result).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "입력 내용을 확인해 주세요.",
      fieldErrors: { completionSummary: ["완료 결과를 입력해 주세요."] },
    });
    expect(fixture.audits.listByRequestIdForTest("request-structural-domain")).toEqual([
      expect.objectContaining({
        errorCode: "VALIDATION_ERROR",
        metadata: {
          expectedVersion: 4,
          fieldNames: ["completionSummary"],
          actorType: "human",
        },
      }),
    ]);
  });

  it.each([
    {
      reason: "ACTOR_TYPE_REQUIRED",
      resultCode: "ACTOR_NOT_ALLOWED",
      auditCode: "ACTOR_REJECTED",
    },
    {
      reason: "ASSIGNEE_REQUIRED",
      resultCode: "OWNERSHIP_REQUIRED",
      auditCode: "OWNERSHIP_REQUIRED",
    },
  ])("classifies a cross-bundle $reason without inspecting translated messages", async ({
    reason,
    resultCode,
    auditCode,
  }) => {
    const fixture = setup();
    const taskId = await prepareRunning(fixture, humanActor, `structured-${reason}`);
    vi.spyOn(fixture.tasks, "runCommand").mockRejectedValue({
      name: "TaskDomainError",
      code: "INVALID_TRANSITION",
      reason,
      message: "translated domain failure",
    });
    const requestId = `request-structured-${reason}`;

    const result = await commandsFor(fixture, humanActor, requestId).completeTask({
      taskId,
      expectedVersion: 4,
      completionSummary: "완료",
    });

    expect(result).toMatchObject({ ok: false, code: resultCode });
    expect(fixture.audits.listByRequestIdForTest(requestId)).toEqual([
      expect.objectContaining({
        action: "task.complete",
        outcome: "failure",
        errorCode: auditCode,
      }),
    ]);
  });

  it("rolls back a command whose success audit is rejected and stores one safe failure audit", async () => {
    const fixture = setup();
    const taskId = await prepareRunning(fixture, humanActor, "success-audit-storage");
    const before = await fixture.tasks.findById(taskId);
    const eventCount = await fixture.tasks.countEvents(taskId);
    fixture.database.exec(`CREATE TEMP TRIGGER reject_success_audit BEFORE INSERT ON audit_logs
      WHEN NEW.outcome = 'success' BEGIN SELECT RAISE(ABORT, 'forced success audit failure'); END`);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await commandsFor(fixture, humanActor, "request-success-audit-storage").completeTask({
      taskId,
      expectedVersion: 4,
      completionSummary: "원자적으로 완료한다",
    });

    expect(result).toEqual({
      ok: false,
      code: "STORAGE_ERROR",
      message: "작업을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    });
    expect(await fixture.tasks.findById(taskId)).toEqual(before);
    expect(await fixture.tasks.countEvents(taskId)).toBe(eventCount);
    expect(fixture.audits.listByRequestIdForTest("request-success-audit-storage")).toEqual([
      expect.objectContaining({
        taskId,
        action: "task.complete",
        outcome: "failure",
        errorCode: "STORAGE_ERROR",
        fromState: "in_progress",
        toState: null,
        metadata: {
          expectedVersion: 4,
          fieldNames: [],
          actorType: "human",
        },
      }),
    ]);
  });

  it("preserves the classified command result when failure-audit persistence fails", async () => {
    const fixture = setup();
    const taskId = await prepareRunning(fixture, humanActor, "audit-storage");
    const before = await fixture.tasks.findById(taskId);
    const eventCount = await fixture.tasks.countEvents(taskId);
    fixture.database.exec(`CREATE TRIGGER reject_failure_audit BEFORE INSERT ON audit_logs
      WHEN NEW.outcome = 'failure' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await commandsFor(fixture, humanActor, "request-audit-storage").completeTask({
      taskId,
      expectedVersion: 4,
      completionSummary: "   ",
    });

    expect(result).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "입력 내용을 확인해 주세요.",
      fieldErrors: { completionSummary: ["완료 결과를 입력해 주세요."] },
    });
    expect(consoleError).toHaveBeenCalledWith("Audit persistence failed", expect.any(Error));
    expect(fixture.audits.listByRequestIdForTest("request-audit-storage")).toEqual([]);
    expect(await fixture.tasks.findById(taskId)).toEqual(before);
    expect(await fixture.tasks.countEvents(taskId)).toBe(eventCount);
  });
});
