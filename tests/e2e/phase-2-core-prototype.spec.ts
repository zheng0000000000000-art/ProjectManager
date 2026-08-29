import path from "node:path";
import Database from "better-sqlite3";
import { expect, test, type APIRequestContext } from "@playwright/test";

const databaseFilename = path.join(process.cwd(), "data", "browser-test.db");
async function publishFromBrowser(page: import("@playwright/test").Page, title: string) {
  await page.goto("/tasks/new");
  await page.getByLabel("작업명").fill(title);
  await page.getByLabel("목표").fill("두 독립 세션의 실제 경쟁을 검증한다");
  await page.getByLabel("작업 종류").selectOption({ label: "개발" });
  await page.getByLabel("예상 작업량").fill("1");
  await page.getByRole("button", { name: "작업 풀에 공개" }).click();
  await expect(page).toHaveURL(/\/task-pool/);
}

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

test("the human-facing browser has no loginless actor switcher", async ({ page }) => {
  await page.goto("/my-work");
  await expect(page.getByLabel("현재 작업자")).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Codex · AI" })).toHaveCount(0);
});

test("independent browser sessions use the same human account and record one take", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  const title = `독립 세션 경쟁 ${Date.now()}`;

  try {
    await publishFromBrowser(firstPage, title);
    await secondPage.goto("/task-pool");
    const firstCard = firstPage.getByRole("article", { name: title });
    const secondCard = secondPage.getByRole("article", { name: title });
    await expect(firstCard).toBeVisible();
    await expect(secondCard).toBeVisible();

    await Promise.allSettled([
      firstCard.getByRole("button", { name: "가져가기" }).click(),
      secondCard.getByRole("button", { name: "가져가기" }).click(),
    ]);

    const database = new Database(databaseFilename, { readonly: true });
    const winner = database.prepare("SELECT assignee_id FROM tasks WHERE title = ?").get(title) as { assignee_id: string };
    const eventCount = database.prepare(`SELECT COUNT(*) count FROM task_events e
      JOIN tasks t ON t.id = e.task_id WHERE t.title = ? AND e.event_type = 'taken'`).get(title) as { count: number };
    database.close();
    expect(winner.assignee_id).toBe("user-fixed");
    expect(eventCount.count).toBe(1);

    await firstPage.goto("/my-work");
    await secondPage.goto("/my-work");
    await expect(firstPage.getByRole("article", { name: title })).toContainText("가져감");
    await expect(secondPage.getByRole("article", { name: title })).toContainText("가져감");
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});

test("Codex completes the core loop through the shared JSON command boundary", async ({ request }) => {
  const created = await apiJson(request, "post", "/api/tasks", "user-codex");
  expect(created.response.status()).toBe(201);
  const taskId = (created.body.data as { taskId: string }).taskId;

  expect((await apiJson(request, "post", `/api/tasks/${taskId}/publish`, "user-codex", {
    expectedVersion: 1,
    title: "Codex API 작업",
    goal: "화면과 같은 명령을 사용한다",
    workTypeId: "work-development",
    estimatedBlocks: 1,
    deadline: null,
  })).response.ok()).toBe(true);

  const pool = await apiJson(request, "get", "/api/task-pool", "user-codex");
  expect((pool.body.data as { tasks: { id: string }[] }).tasks.map((task) => task.id)).toContain(taskId);
  expect((await apiJson(request, "post", `/api/tasks/${taskId}/take`, "user-codex", { expectedVersion: 2 })).response.ok()).toBe(true);
  const myWork = await apiJson(request, "get", "/api/my-work", "user-codex");
  expect((myWork.body.data as { tasks: { id: string }[] }).tasks.map((task) => task.id)).toContain(taskId);
  expect((await apiJson(request, "post", `/api/tasks/${taskId}/start`, "user-codex", { expectedVersion: 3 })).response.ok()).toBe(true);

  const database = new Database(databaseFilename, { readonly: true });
  expect(database.prepare("SELECT creator_id, assignee_id, work_status, started_at FROM tasks WHERE id = ?").get(taskId))
    .toMatchObject({ creator_id: "user-codex", assignee_id: "user-codex", work_status: "in_progress" });
  expect(database.prepare("SELECT DISTINCT actor_id FROM task_events WHERE task_id = ?").all(taskId))
    .toEqual([{ actor_id: "user-codex" }]);
  database.close();
});

test("API rejects unknown actors, unresolved prerequisites, and missing scope", async ({ request }) => {
  const unknown = await apiJson(request, "get", "/api/task-pool", "unknown-user");
  expect(unknown.response.status()).toBe(403);
  expect(unknown.body).toMatchObject({ ok: false, code: "ACTOR_NOT_ALLOWED" });

  const prerequisite = await apiJson(request, "post", "/api/tasks", "user-fixed");
  const blocked = await apiJson(request, "post", "/api/tasks", "user-fixed");
  const prerequisiteId = (prerequisite.body.data as { taskId: string }).taskId;
  const blockedId = (blocked.body.data as { taskId: string }).taskId;
  await apiJson(request, "post", `/api/tasks/${blockedId}/publish`, "user-fixed", {
    expectedVersion: 1,
    title: "선행 조건 차단",
    goal: "미완료 선행 작업을 검증한다",
    workTypeId: "work-development",
    estimatedBlocks: 1,
    deadline: null,
  });

  const database = new Database(databaseFilename);
  database.prepare(`INSERT INTO task_prerequisites
    (task_id, prerequisite_task_id, resolved_at) VALUES (?, ?, NULL)`).run(blockedId, prerequisiteId);
  try {
    const blockedPool = await apiJson(request, "get", "/api/task-pool", "user-fixed");
    expect((blockedPool.body.data as { tasks: { id: string }[] }).tasks.map((task) => task.id)).not.toContain(blockedId);
    const blockedTake = await apiJson(request, "post", `/api/tasks/${blockedId}/take`, "user-fixed", { expectedVersion: 2 });
    expect(blockedTake.response.status()).toBe(409);
    expect(blockedTake.body).toMatchObject({ code: "PREREQUISITE_UNRESOLVED" });

    database.prepare(`UPDATE member_work_scopes SET active = 0
      WHERE member_id = 'member-codex' AND work_type_id = 'work-development'`).run();
    database.prepare("UPDATE task_prerequisites SET resolved_at = '2026-08-29T12:00:00.000Z' WHERE task_id = ?").run(blockedId);
    const scopeTake = await apiJson(request, "post", `/api/tasks/${blockedId}/take`, "user-codex", { expectedVersion: 2 });
    expect(scopeTake.response.status()).toBe(403);
    expect(scopeTake.body).toMatchObject({ code: "SCOPE_REQUIRED" });
  } finally {
    database.prepare(`UPDATE member_work_scopes SET active = 1
      WHERE member_id = 'member-codex' AND work_type_id = 'work-development'`).run();
    database.close();
  }
});
