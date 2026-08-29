import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { recreateBrowserTestDatabase } from "./global-setup";

const databaseFilename = path.join(process.cwd(), "data", "browser-test.db");
const safeTaskKeys = [
  "assigneeId",
  "completedAt",
  "completionSummary",
  "deadline",
  "estimatedBlocks",
  "goal",
  "id",
  "projectId",
  "publicationState",
  "startedAt",
  "title",
  "version",
  "workStatus",
  "workTypeId",
  "workTypeName",
] as const;

async function apiJson(
  request: APIRequestContext,
  method: "get" | "post",
  url: string,
  actorId: string,
  data?: unknown,
) {
  const response = await request[method](url, {
    headers: { "x-project-actor": actorId },
    data,
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

async function createPublishedTask(request: APIRequestContext, actorId: string, title: string) {
  const created = await apiJson(request, "post", "/api/tasks", actorId);
  expect(created.response.status()).toBe(201);
  const taskId = (created.body.data as { taskId: string }).taskId;

  expect((await apiJson(request, "post", `/api/tasks/${taskId}/publish`, actorId, {
    expectedVersion: 1,
    title,
    goal: "실패한 완료 요청이 작업 상태를 보존하는지 검증한다",
    workTypeId: "work-development",
    estimatedBlocks: 1,
    deadline: null,
  })).response.ok()).toBe(true);
  return taskId;
}

async function createRunningTask(request: APIRequestContext, actorId: string, title: string) {
  const taskId = await createPublishedTask(request, actorId, title);
  expect((await apiJson(request, "post", `/api/tasks/${taskId}/take`, actorId, {
    expectedVersion: 2,
  })).response.ok()).toBe(true);
  expect((await apiJson(request, "post", `/api/tasks/${taskId}/start`, actorId, {
    expectedVersion: 3,
  })).response.ok()).toBe(true);

  return taskId;
}

test("global setup recreates the Phase 3 database without audit history", () => {
  const staleRequestId = `stale-browser-audit-${crypto.randomUUID()}`;
  const isolatedFilename = path.join(process.cwd(), "test-results", `${staleRequestId}.db`);
  recreateBrowserTestDatabase(isolatedFilename);
  const database = new Database(isolatedFilename);
  try {
    database.prepare(`INSERT INTO audit_logs
      (id, project_id, task_id, actor_id, action, outcome, error_code, from_state, to_state,
        request_id, metadata_json, created_at)
      VALUES (?, 'project-default', NULL, 'user-fixed', 'task.create', 'failure', 'VALIDATION_ERROR',
        NULL, NULL, ?, '{}', ?)`).run(crypto.randomUUID(), staleRequestId, new Date().toISOString());
  } finally {
    database.close();
  }

  try {
    execFileSync(process.execPath, [
      path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
      path.join(process.cwd(), "tests", "e2e", "global-setup.ts"),
    ], {
      cwd: process.cwd(),
      env: { ...process.env, BROWSER_TEST_DATABASE_URL: isolatedFilename },
      stdio: "pipe",
    });

    const recreated = new Database(isolatedFilename, { readonly: true });
    try {
      expect(recreated.prepare("SELECT COUNT(*) count FROM audit_logs WHERE request_id = ?")
        .get(staleRequestId)).toEqual({ count: 0 });
    } finally {
      recreated.close();
    }
  } finally {
    fs.rmSync(isolatedFilename, { force: true });
  }
});

test("malformed API mutations return validation errors and write one safe audit", async ({ request }) => {
  const draftCreated = await apiJson(request, "post", "/api/tasks", "user-fixed");
  expect(draftCreated.response.status()).toBe(201);
  const draftTaskId = (draftCreated.body.data as { taskId: string }).taskId;
  const runningTaskId = await createRunningTask(
    request,
    "user-fixed",
    `요청 검증 감사 ${Date.now()}`,
  );
  const database = new Database(databaseFilename, { readonly: true });
  const taskIds = [draftTaskId, runningTaskId].sort();
  const taskRowsBefore = database.prepare(`SELECT * FROM tasks WHERE id IN (?, ?) ORDER BY id`)
    .all(...taskIds);
  const eventRowsBefore = database.prepare(`SELECT * FROM task_events
    WHERE task_id IN (?, ?) ORDER BY task_id, created_at, id`).all(...taskIds);
  const rawMarker = `raw-request-${crypto.randomUUID()}`;
  const cases: Array<{
    name: string;
    action: "task.publish" | "task.take" | "task.start" | "task.complete";
    url: string;
    data?: unknown;
    raw?: string;
    fieldNames: string[];
    expectedVersion?: number;
    actorId?: string;
  }> = [
    {
      name: "missing version",
      action: "task.complete",
      url: `/api/tasks/${runningTaskId}/complete`,
      data: { completionSummary: "완료" },
      fieldNames: ["expectedVersion"],
    },
    {
      name: "mistyped version",
      action: "task.take",
      url: `/api/tasks/${runningTaskId}/take`,
      data: { expectedVersion: rawMarker },
      fieldNames: ["expectedVersion"],
    },
    {
      name: "fractional version",
      action: "task.start",
      url: `/api/tasks/${runningTaskId}/start`,
      data: { expectedVersion: 1.5 },
      fieldNames: ["expectedVersion"],
    },
    {
      name: "nonpositive version",
      action: "task.take",
      url: `/api/tasks/${runningTaskId}/take`,
      data: { expectedVersion: 0 },
      fieldNames: ["expectedVersion"],
    },
    {
      name: "wrong publish field type",
      action: "task.publish",
      url: `/api/tasks/${draftTaskId}/publish`,
      data: {
        expectedVersion: 1,
        title: { rawMarker },
        goal: "요청 검증",
        workTypeId: "work-development",
        estimatedBlocks: 1,
        deadline: null,
      },
      fieldNames: ["title"],
      expectedVersion: 1,
    },
    {
      name: "wrong completion field type",
      action: "task.complete",
      url: `/api/tasks/${runningTaskId}/complete`,
      data: { expectedVersion: 4, completionSummary: { rawMarker } },
      fieldNames: ["completionSummary"],
      expectedVersion: 4,
    },
    ...([
      ["task.publish", `/api/tasks/${draftTaskId}/publish`],
      ["task.take", `/api/tasks/${runningTaskId}/take`],
      ["task.start", `/api/tasks/${runningTaskId}/start`],
      ["task.complete", `/api/tasks/${runningTaskId}/complete`],
    ] as const).map(([action, url]) => ({
      name: `${action} malformed JSON`,
      action,
      url,
      raw: `{"rawMarker":"${rawMarker}"`,
      fieldNames: [],
    })),
    {
      name: "malformed JSON preserves validation precedence over an untrusted actor",
      action: "task.take",
      url: `/api/tasks/${runningTaskId}/take`,
      raw: `{"rawMarker":"${rawMarker}"`,
      fieldNames: [],
      actorId: rawMarker,
    },
  ];

  try {
    for (const testCase of cases) {
      const knownAuditIds = new Set(
        (database.prepare("SELECT id FROM audit_logs").all() as Array<{ id: string }>)
          .map((audit) => audit.id),
      );
      const response = await request.post(testCase.url, {
        headers: {
          "x-project-actor": testCase.actorId ?? "user-fixed",
          ...(testCase.raw === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(testCase.raw === undefined ? { data: testCase.data } : { data: testCase.raw }),
      });

      expect(response.status(), testCase.name).toBe(400);
      expect(await response.json(), testCase.name).toMatchObject({
        ok: false,
        code: "VALIDATION_ERROR",
      });
      const newAudits = (database.prepare(`SELECT id, project_id, task_id, actor_id, action,
        outcome, error_code, from_state, to_state, request_id, metadata_json
        FROM audit_logs ORDER BY created_at, id`).all() as Array<{
          id: string;
          project_id: string;
          task_id: string | null;
          actor_id: string | null;
          action: string;
          outcome: string;
          error_code: string | null;
          from_state: string | null;
          to_state: string | null;
          request_id: string;
          metadata_json: string;
        }>).filter((audit) => !knownAuditIds.has(audit.id));
      expect(newAudits, testCase.name).toHaveLength(1);
      expect(newAudits[0], testCase.name).toMatchObject({
        project_id: "project-default",
        actor_id: null,
        action: testCase.action,
        outcome: "failure",
        error_code: "VALIDATION_ERROR",
        to_state: null,
      });
      expect(database.prepare("SELECT COUNT(*) count FROM audit_logs WHERE request_id = ?")
        .get(newAudits[0].request_id), testCase.name).toEqual({ count: 1 });
      const metadata = JSON.parse(newAudits[0].metadata_json) as Record<string, unknown>;
      expect(metadata, testCase.name).toEqual({
        ...(testCase.expectedVersion === undefined
          ? {}
          : { expectedVersion: testCase.expectedVersion }),
        fieldNames: testCase.fieldNames,
      });
      expect(Object.keys(metadata).sort(), testCase.name)
        .toEqual((testCase.expectedVersion === undefined
          ? ["fieldNames"]
          : ["expectedVersion", "fieldNames"]).sort());
      expect(newAudits[0].metadata_json, testCase.name).not.toContain(rawMarker);
    }

    expect(database.prepare(`SELECT * FROM tasks WHERE id IN (?, ?) ORDER BY id`)
      .all(...taskIds)).toEqual(taskRowsBefore);
    expect(database.prepare(`SELECT * FROM task_events
      WHERE task_id IN (?, ?) ORDER BY task_id, created_at, id`).all(...taskIds))
      .toEqual(eventRowsBefore);
  } finally {
    database.close();
  }
});

test("human completion persists while audits stay internal", async ({ page }) => {
  const title = `사람 완료 감사 ${Date.now()}`;
  const completionSummary = "브라우저에서 완료 결과와 감사 분리를 확인했다";

  await page.goto("/tasks/new");
  await page.getByLabel("작업명").fill(title);
  await page.getByLabel("목표").fill("사람 완료 결과가 새로고침 뒤에도 유지되는지 검증한다");
  await page.getByLabel("작업 종류").selectOption({ label: "개발" });
  await page.getByLabel("예상 작업량").fill("1");
  await page.getByRole("button", { name: "작업 풀에 공개" }).click();

  const poolCard = page.getByRole("article", { name: title });
  await expect(poolCard).toBeVisible();
  await poolCard.getByRole("button", { name: "가져가기" }).click();
  const myWorkCard = page.getByRole("article", { name: title });
  await myWorkCard.getByRole("button", { name: "작업 시작" }).click();
  await myWorkCard.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(/\/tasks\/[^/]+$/);
  const taskId = page.url().split("/").at(-1)!;

  await page.getByLabel("완료 결과").fill(completionSummary);
  await page.getByRole("button", { name: "작업 완료" }).click();
  const detailCard = page.getByRole("article", { name: title });
  await expect(detailCard.locator(".status")).toHaveText("완료");
  const completionTime = detailCard.locator(".task-meta span").filter({ hasText: /^완료 / });
  await expect(completionTime).toHaveText(/^완료 20\d\d/);
  const completionTimeText = await completionTime.innerText();
  await expect(detailCard).toContainText(completionSummary);

  await page.reload();
  await expect(detailCard.locator(".status")).toHaveText("완료");
  await expect(completionTime).toHaveText(completionTimeText);
  await expect(detailCard).toContainText(completionSummary);

  const html = await page.content();
  expect(html).not.toContain("request_id");
  expect(html).not.toContain("metadata_json");
  expect(html).not.toContain("requestId");

  const openTaskId = await createPublishedTask(page.request, "user-fixed", `공개 API 안전 키 ${Date.now()}`);
  for (const { url, expectedTaskId } of [
    { url: "/api/my-work", expectedTaskId: taskId },
    { url: "/api/task-pool", expectedTaskId: openTaskId },
  ]) {
    const response = await page.request.get(url, {
      headers: { "x-project-actor": "user-fixed" },
    });
    expect(response.ok()).toBe(true);
    const body = await response.json() as {
      ok: boolean;
      data: { tasks: Array<Record<string, unknown> & { id: string }> };
    };
    expect(Object.keys(body).sort()).toEqual(["data", "ok"]);
    expect(body.ok).toBe(true);
    expect(Object.keys(body.data)).toEqual(["tasks"]);
    expect(body.data.tasks.map((task) => task.id)).toContain(expectedTaskId);
    for (const task of body.data.tasks) {
      expect(Object.keys(task).sort()).toEqual([...safeTaskKeys].sort());
    }
  }

  const database = new Database(databaseFilename, { readonly: true });
  try {
    const audits = database.prepare(`SELECT action, outcome, error_code, from_state, to_state,
      request_id, metadata_json FROM audit_logs
      WHERE task_id = ? AND action = 'task.complete'`).all(taskId) as Array<Record<string, unknown>>;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "task.complete",
      outcome: "success",
      error_code: null,
      from_state: "in_progress",
      to_state: "completed",
    });
    expect(JSON.parse(audits[0].metadata_json as string)).toEqual({
      expectedVersion: 4,
      fieldNames: ["completionSummary"],
      actorType: "human",
    });
    expect(database.prepare(`SELECT event_type, created_at FROM task_events
      WHERE task_id = ? AND event_type = 'completed'`).all(taskId)).toHaveLength(1);
  } finally {
    database.close();
  }
});

test("failed completion is audited without changing the task", async ({ request }) => {
  const taskId = await createRunningTask(request, "user-fixed", `완료 실패 감사 ${Date.now()}`);
  const aiSummary = "감사 메타데이터에 남으면 안 되는 AI 완료 원문";
  const database = new Database(databaseFilename, { readonly: true });

  try {
    const taskBefore = database.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    const eventsBefore = database.prepare(`SELECT * FROM task_events
      WHERE task_id = ? ORDER BY created_at, id`).all(taskId);

    const emptySummary = await apiJson(request, "post", `/api/tasks/${taskId}/complete`, "user-fixed", {
      expectedVersion: 4,
      completionSummary: "   ",
    });
    expect(emptySummary.response.status()).toBe(400);
    expect(emptySummary.body).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { completionSummary: ["완료 결과를 입력해 주세요."] },
    });

    const aiCompletion = await apiJson(request, "post", `/api/tasks/${taskId}/complete`, "user-codex", {
      expectedVersion: 4,
      completionSummary: aiSummary,
    });
    expect(aiCompletion.response.status()).toBe(403);
    expect(aiCompletion.body).toMatchObject({ ok: false, code: "ACTOR_NOT_ALLOWED" });

    expect(database.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId)).toEqual(taskBefore);
    const eventsAfter = database.prepare(`SELECT * FROM task_events
      WHERE task_id = ? ORDER BY created_at, id`).all(taskId);
    expect(eventsAfter).toHaveLength(eventsBefore.length);
    expect(eventsAfter).toEqual(eventsBefore);

    const failureAudits = database.prepare(`SELECT outcome, error_code, request_id, metadata_json
      FROM audit_logs WHERE task_id = ? AND action = 'task.complete' AND outcome = 'failure'
      ORDER BY created_at, id`).all(taskId) as Array<{
        outcome: string;
        error_code: string;
        request_id: string;
        metadata_json: string;
      }>;
    expect(failureAudits).toHaveLength(2);
    expect(new Set(failureAudits.map((audit) => audit.request_id)).size).toBe(2);
    expect(failureAudits.map((audit) => audit.error_code).sort()).toEqual([
      "ACTOR_REJECTED",
      "VALIDATION_ERROR",
    ]);
    for (const audit of failureAudits) {
      expect(database.prepare("SELECT COUNT(*) count FROM audit_logs WHERE request_id = ?")
        .get(audit.request_id)).toEqual({ count: 1 });
      expect(audit.metadata_json).not.toContain(aiSummary);
    }
    expect(JSON.parse(failureAudits.find((audit) => audit.error_code === "VALIDATION_ERROR")!.metadata_json))
      .toEqual({ fieldNames: ["completionSummary"], actorType: "human", expectedVersion: 4 });
    expect(JSON.parse(failureAudits.find((audit) => audit.error_code === "ACTOR_REJECTED")!.metadata_json))
      .toEqual({ fieldNames: [], actorType: "ai", expectedVersion: 4 });
  } finally {
    database.close();
  }
});
