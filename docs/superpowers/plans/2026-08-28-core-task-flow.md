# Core Task Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent Korean-language web app where a fixed user can create a task draft, publish it, take it from the task pool, see it in My Work, and start it.

**Architecture:** Use one Next.js application with server actions as explicit commands, pure domain transition functions, and a repository boundary backed by SQLite. Each successful command updates `Task` and appends `TaskEvent` in one transaction; pages only read view models and invoke commands.

**Tech Stack:** Next.js App Router, TypeScript, React, Tailwind CSS, Drizzle ORM, SQLite (`better-sqlite3`), Zod, Vitest, Testing Library, Playwright

**Spec:** `docs/superpowers/specs/2026-08-28-core-task-flow-design.md`

## Global Constraints

- The first version has no login and uses exactly one seeded fixed user.
- Task publication and work execution remain separate state axes.
- Mutations use named commands: `createDraft`, `publishTask`, `takeTask`, and `startTask`.
- Every successful command updates the task and appends one event in a single SQLite transaction.
- Failed commands append no event.
- User-facing validation and command errors are written in Korean.
- Data must survive browser refreshes and application restarts.
- UI follows the supplied desktop wireframes: dark left navigation, light workspace, row-style task cards, restrained status colors.
- Features outside the approved spec are not implemented.

---

### Task 1: Application Shell and Test Harness

**Files:**
- Create: `package.json`
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `postcss.config.mjs`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `src/components/app-shell.tsx`
- Create: `src/components/app-shell.test.tsx`
- Create: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: None.
- Produces: `AppShell({ children }: { children: React.ReactNode })`, navigation routes `/my-work`, `/task-pool`, and `/tasks/new`, plus working `test`, `test:e2e`, and `build` scripts.

- [ ] **Step 1: Initialize the Next.js project without overwriting the committed docs**

Run from the repository root:

```powershell
pnpm dlx create-next-app@latest .app-scaffold --ts --tailwind --eslint --app --src-dir --use-pnpm --import-alias "@/*"
```

Copy the generated application/configuration files into the repository root, excluding `.git`, `docs`, and generated dependency/build directories. Remove `.app-scaffold` after verifying the copied paths.

- [ ] **Step 2: Add test dependencies and scripts**

Run:

```powershell
pnpm add zod drizzle-orm better-sqlite3
pnpm add -D drizzle-kit @types/better-sqlite3 vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @playwright/test
```

Add these scripts to `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:seed": "tsx scripts/seed.ts"
  }
}
```

Add `tsx` as a development dependency because the seed command consumes it.

- [ ] **Step 3: Write the failing shell test**

Create `src/components/app-shell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("shows the three first-version destinations", () => {
    render(<AppShell><main>내용</main></AppShell>);
    expect(screen.getByRole("link", { name: "내 작업" })).toHaveAttribute("href", "/my-work");
    expect(screen.getByRole("link", { name: "작업 풀" })).toHaveAttribute("href", "/task-pool");
    expect(screen.getByRole("link", { name: "새 작업" })).toHaveAttribute("href", "/tasks/new");
  });
});
```

- [ ] **Step 4: Run the shell test and verify failure**

Run: `pnpm test -- src/components/app-shell.test.tsx`

Expected: FAIL because `AppShell` does not exist.

- [ ] **Step 5: Implement the shell and visual tokens**

Create `src/components/app-shell.tsx` with semantic navigation links and a content slot. Define CSS variables in `globals.css` for `--nav`, `--surface`, `--canvas`, `--border`, `--text`, `--muted`, `--accent`, `--success`, and `--warning`. Ensure the layout collapses to a top bar below 800 px without horizontally clipping content.

- [ ] **Step 6: Add a smoke browser test**

Create `tests/e2e/smoke.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("opens the app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "내 작업" })).toBeVisible();
  await expect(page.getByRole("link", { name: "작업 풀" })).toBeVisible();
});
```

- [ ] **Step 7: Verify and commit**

Run:

```powershell
pnpm test -- src/components/app-shell.test.tsx
pnpm lint
pnpm build
git add package.json pnpm-lock.yaml next.config.ts tsconfig.json postcss.config.mjs vitest.config.ts playwright.config.ts src tests
git commit -m "feat: scaffold task flow application"
```

Expected: unit test, lint, and production build pass.

---

### Task 2: Pure Task Domain Rules

**Files:**
- Create: `src/features/tasks/domain/task.ts`
- Create: `src/features/tasks/domain/task-errors.ts`
- Create: `src/features/tasks/domain/task-transitions.ts`
- Create: `src/features/tasks/domain/task-transitions.test.ts`

**Interfaces:**
- Consumes: Zod.
- Produces: `TaskRecord`, `PublicationState`, `WorkStatus`, `CommandError`, `validatePublishInput(input)`, `publish(task, input)`, `take(task, actorId)`, and `start(task, actorId)`.

- [ ] **Step 1: Define domain types and error codes in the failing test**

Create test cases that import the planned interfaces and assert:

```ts
expect(() => publish(draft, {
  title: "",
  goal: "",
  workTypeId: "",
  estimatedBlocks: 0,
  deadline: null,
})).toThrowError("제목을 입력해 주세요.");

expect(publish(draft, validInput)).toMatchObject({
  publicationState: "published",
  workStatus: "open",
});

expect(take(published, "user-fixed")).toMatchObject({
  assigneeId: "user-fixed",
  workStatus: "taken",
});

expect(start(taken, "user-fixed")).toMatchObject({ workStatus: "in_progress" });
expect(() => start(taken, "another-user")).toThrowError("담당자만 작업을 시작할 수 있습니다.");
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- src/features/tasks/domain/task-transitions.test.ts`

Expected: FAIL because domain modules do not exist.

- [ ] **Step 3: Implement minimal pure transitions**

Use these exact state types:

```ts
export type PublicationState = "draft" | "published";
export type WorkStatus = "open" | "taken" | "in_progress";

export interface TaskRecord {
  id: string;
  title: string;
  goal: string;
  workTypeId: string | null;
  estimatedBlocks: number | null;
  deadline: string | null;
  publicationState: PublicationState;
  workStatus: WorkStatus;
  assigneeId: string | null;
  version: number;
}
```

Every transition returns a new object with `version + 1` and never mutates its input. `publish` rejects non-drafts; `take` rejects non-published, non-open, or assigned tasks; `start` rejects non-taken tasks and non-assignees.

- [ ] **Step 4: Run focused and full unit tests**

Run:

```powershell
pnpm test -- src/features/tasks/domain/task-transitions.test.ts
pnpm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/features/tasks/domain
git commit -m "feat: define task state transitions"
```

---

### Task 3: SQLite Schema, Repository, and Seed Data

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/db/schema.ts`
- Create: `src/db/client.ts`
- Create: `src/features/tasks/data/task-repository.ts`
- Create: `src/features/tasks/data/sqlite-task-repository.ts`
- Create: `src/features/tasks/data/sqlite-task-repository.test.ts`
- Create: `scripts/seed.ts`
- Create: `drizzle/0000_initial.sql`
- Create: `.env.example`

**Interfaces:**
- Consumes: `TaskRecord` from Task 2.
- Produces: `TaskRepository` with `createDraft`, `findById`, `listPool`, `listForAssignee`, and `runCommand`; `getTaskRepository()`; seeded IDs `user-fixed`, `work-planning`, `work-development`, and `work-qa`.

- [ ] **Step 1: Write repository transaction tests against a temporary SQLite database**

The test creates a database under a per-test temporary directory and asserts:

```ts
const draft = await repository.createDraft("user-fixed");
expect(draft).toMatchObject({ publicationState: "draft", workStatus: "open", version: 1 });

await repository.runCommand(draft.id, 1, ({ task, appendEvent }) => {
  const next = publish(task, validInput);
  appendEvent({ eventType: "published", actorId: "user-fixed", fromState: "draft", toState: "published" });
  return next;
});

expect((await repository.findById(draft.id))?.version).toBe(2);
expect(await repository.countEvents(draft.id)).toBe(2);
```

Add a rollback test where the callback throws and event count remains unchanged, plus a stale-version test returning `VERSION_CONFLICT`.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- src/features/tasks/data/sqlite-task-repository.test.ts`

Expected: FAIL because schema and repository do not exist.

- [ ] **Step 3: Define schema and repository boundary**

Create tables `users`, `work_types`, `tasks`, and `task_events`. Use text UUID IDs, ISO timestamp text, integer booleans, and a unique `task_events.id`. Add indexes for `(publication_state, work_status, assignee_id)` and `(assignee_id, work_status)`.

Define:

```ts
export interface TaskRepository {
  createDraft(actorId: string): Promise<TaskRecord>;
  findById(id: string): Promise<TaskRecord | null>;
  listPool(): Promise<TaskListItem[]>;
  listForAssignee(assigneeId: string): Promise<TaskListItem[]>;
  countEvents(taskId: string): Promise<number>;
  runCommand(
    taskId: string,
    expectedVersion: number,
    command: (context: CommandContext) => TaskRecord,
  ): Promise<TaskRecord>;
}
```

`createDraft` inserts both the task and a `created` event in one transaction. `runCommand` reloads the row inside the transaction, compares versions, collects exactly one appended event, updates with a version guard, inserts the event, and commits.

- [ ] **Step 4: Generate and apply migration**

Set `DATABASE_URL=./data/app.db` in local `.env` and document the same key in `.env.example` without secrets.

Run:

```powershell
pnpm db:generate
pnpm db:migrate
```

Expected: four tables and the planned indexes exist.

- [ ] **Step 5: Implement idempotent seed**

`scripts/seed.ts` upserts the fixed user and three work types. Seed three published open tasks only when no tasks exist; do not recreate them after the user changes their state.

- [ ] **Step 6: Verify tests, migration, and seed rerun**

Run:

```powershell
pnpm test -- src/features/tasks/data/sqlite-task-repository.test.ts
pnpm db:seed
pnpm db:seed
pnpm test
```

Expected: tests pass and the second seed run creates no duplicates.

- [ ] **Step 7: Commit**

```powershell
git add drizzle.config.ts drizzle src/db src/features/tasks/data scripts/seed.ts .env.example package.json pnpm-lock.yaml
git commit -m "feat: persist tasks in sqlite"
```

Do not commit `.env` or `data/app.db`.

---

### Task 4: Server Commands and Command Integration Tests

**Files:**
- Create: `src/features/tasks/server/command-result.ts`
- Create: `src/features/tasks/server/task-commands.ts`
- Create: `src/features/tasks/server/task-commands.test.ts`

**Interfaces:**
- Consumes: domain transitions and `TaskRepository`.
- Produces: `createDraft()`, `publishTask(input)`, `takeTask(input)`, and `startTask(input)`, each returning `Promise<CommandResult<{ taskId: string }>>`.

- [ ] **Step 1: Write command integration tests with a repository test instance**

Use these input shapes:

```ts
type VersionedTaskInput = { taskId: string; expectedVersion: number };
type PublishTaskInput = VersionedTaskInput & {
  title: string;
  goal: string;
  workTypeId: string;
  estimatedBlocks: number;
  deadline: string | null;
};
```

Assert the full sequence succeeds and yields versions 1 through 4. Assert missing title returns:

```ts
{
  ok: false,
  code: "VALIDATION_ERROR",
  message: "입력 내용을 확인해 주세요.",
  fieldErrors: { title: ["제목을 입력해 주세요."] }
}
```

Assert a repeated take returns `INVALID_TRANSITION`, and a stale version returns `VERSION_CONFLICT` with `다른 변경 사항이 반영되었습니다. 최신 내용을 불러와 다시 시도해 주세요.`

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- src/features/tasks/server/task-commands.test.ts`

Expected: FAIL because command functions do not exist.

- [ ] **Step 3: Implement command result mapping**

Use one discriminated union:

```ts
export type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "VALIDATION_ERROR" | "NOT_FOUND" | "INVALID_TRANSITION" | "VERSION_CONFLICT" | "STORAGE_ERROR"; message: string; fieldErrors?: Record<string, string[]> };
```

Each command uses `FIXED_USER_ID = "user-fixed"`, invokes one repository transaction, maps known domain/repository errors, logs unexpected errors server-side, and returns `STORAGE_ERROR` without exposing internal details.

- [ ] **Step 4: Add Next.js cache invalidation**

After success, call `revalidatePath` for `/task-pool`, `/my-work`, and `/tasks/{id}`. Do not invalidate on failure.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
pnpm test -- src/features/tasks/server/task-commands.test.ts
pnpm test
git add src/features/tasks/server
git commit -m "feat: add task workflow commands"
```

---

### Task 5: Task Pool, My Work, Draft, and Detail UI

**Files:**
- Create: `src/features/tasks/components/task-card.tsx`
- Create: `src/features/tasks/components/task-card.test.tsx`
- Create: `src/features/tasks/components/command-form.tsx`
- Create: `src/features/tasks/components/command-feedback.tsx`
- Create: `src/app/task-pool/page.tsx`
- Create: `src/app/my-work/page.tsx`
- Create: `src/app/tasks/new/page.tsx`
- Create: `src/app/tasks/[id]/page.tsx`
- Create: `src/app/tasks/[id]/edit-task-form.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: repository list/read methods and server commands.
- Produces: complete browser flow across `/tasks/new`, `/task-pool`, `/my-work`, and `/tasks/[id]`.

- [ ] **Step 1: Write TaskCard component tests**

Assert a pool card renders title, goal, work type, deadline, blocks, and a `가져가기` button. Assert a taken My Work card renders `가져감` and a `작업 시작` button. Assert an in-progress card renders `진행 중` and no start button.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- src/features/tasks/components/task-card.test.tsx`

Expected: FAIL because `TaskCard` does not exist.

- [ ] **Step 3: Implement shared cards and command feedback**

`TaskCard` receives data and action slots rather than importing server commands. `CommandForm` prevents repeat submission while pending. `CommandFeedback` uses `aria-live="polite"` for success and `role="alert"` for errors.

- [ ] **Step 4: Implement task pool and My Work pages**

`/task-pool` reads `listPool()` and renders an empty state `지금 가져갈 수 있는 작업이 없습니다.`. Each action includes hidden `taskId` and `expectedVersion` fields.

`/my-work` groups fixed-user tasks under `진행 중` and `가져감`. It renders `아직 가져간 작업이 없습니다.` when empty.

- [ ] **Step 5: Implement draft creation and detail editing**

Entering `/tasks/new` invokes `createDraft` once and redirects to `/tasks/{id}`. The detail page renders a form for title, goal, work type, estimated blocks, and optional deadline while the task is a draft. The `작업 풀에 공개` submission calls `publishTask`. Published open tasks show `가져가기`; taken tasks owned by the fixed user show `작업 시작`.

Use these Korean field messages from the command result without rewriting them client-side.

- [ ] **Step 6: Complete responsive wireframe styling**

Implement a 220 px desktop navigation rail, 1180 px maximum content width, 12 px card radius, clear focus rings, and card metadata that wraps below 800 px. Use text labels in addition to color for every state.

- [ ] **Step 7: Verify component tests and build**

Run:

```powershell
pnpm test -- src/features/tasks/components/task-card.test.tsx
pnpm test
pnpm lint
pnpm build
```

Expected: all pass with no hydration or accessibility warnings.

- [ ] **Step 8: Commit**

```powershell
git add src/app src/features/tasks/components
git commit -m "feat: build core task workflow screens"
```

---

### Task 6: End-to-End Persistence and Failure Verification

**Files:**
- Create: `tests/e2e/core-task-flow.spec.ts`
- Create: `tests/e2e/validation.spec.ts`
- Create: `tests/e2e/persistence.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the complete application from Tasks 1-5.
- Produces: repeatable end-to-end verification and local run instructions.

- [ ] **Step 1: Write the failing core-flow browser test**

```ts
test("draft to started task flow", async ({ page }) => {
  await page.goto("/tasks/new");
  await page.getByLabel("작업명").fill("첫 번째 수직 슬라이스");
  await page.getByLabel("목표").fill("생성부터 시작까지 검증한다");
  await page.getByLabel("작업 종류").selectOption({ label: "개발" });
  await page.getByLabel("예상 작업량").fill("3");
  await page.getByRole("button", { name: "작업 풀에 공개" }).click();
  await page.goto("/task-pool");
  await page.getByRole("article", { name: "첫 번째 수직 슬라이스" }).getByRole("button", { name: "가져가기" }).click();
  await page.goto("/my-work");
  await page.getByRole("article", { name: "첫 번째 수직 슬라이스" }).getByRole("button", { name: "작업 시작" }).click();
  await expect(page.getByRole("article", { name: "첫 번째 수직 슬라이스" })).toContainText("진행 중");
});
```

- [ ] **Step 2: Write validation and reload tests**

Validation test submits an empty draft and expects `제목을 입력해 주세요.` and no pool card. Persistence test starts a uniquely named task, reloads `/my-work`, and expects the same task to remain `진행 중`.

- [ ] **Step 3: Run and diagnose the expected initial failures**

Run: `pnpm test:e2e`

Expected: tests expose any missing accessible names, redirects, seed setup, or persistence behavior. Fix only defects required by the approved specification.

- [ ] **Step 4: Add isolated E2E database lifecycle**

Configure Playwright's web server with `DATABASE_URL=./data/e2e.db`. Before the suite, delete only that explicit test database, migrate it, and seed it. Never delete `data/app.db`.

- [ ] **Step 5: Document local use**

README must contain exact commands:

```powershell
Copy-Item .env.example .env
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Also document `pnpm test`, `pnpm test:e2e`, and `pnpm build`, the fixed-user limitation, and the implemented workflow.

- [ ] **Step 6: Run the complete verification gate**

Run:

```powershell
pnpm test
pnpm test:e2e
pnpm lint
pnpm build
git status --short
```

Expected: all checks pass; status contains only intentionally untracked local `.env` or database files ignored by `.gitignore`.

- [ ] **Step 7: Commit**

```powershell
git add tests playwright.config.ts README.md .gitignore
git commit -m "test: verify persistent core task flow"
```

---

### Task 7: Final Product Review

**Files:**
- Modify only files with defects found during the review.

**Interfaces:**
- Consumes: completed application and passing automated tests.
- Produces: visually reviewed, runnable first version with a clean repository state.

- [ ] **Step 1: Start the production build locally**

Run:

```powershell
pnpm build
pnpm start
```

- [ ] **Step 2: Inspect every implemented screen at desktop and narrow widths**

Check `/task-pool`, `/my-work`, `/tasks/new`, and one `/tasks/{id}` at 1440×900 and 390×844. Verify no clipped text, horizontal page overflow, overlapping controls, missing focus indicators, color-only states, or unreadable Korean glyphs.

- [ ] **Step 3: Exercise the complete workflow manually**

Create a uniquely named task, publish it, take it, start it, refresh, and confirm it remains in progress. Submit one invalid draft and confirm no partial task update or event occurs.

- [ ] **Step 4: Repair defects with focused tests**

For each defect, first add or tighten the smallest relevant unit/component/E2E assertion, verify it fails, apply the minimal fix, and rerun the focused test.

- [ ] **Step 5: Re-run the full gate and commit review fixes**

Run:

```powershell
pnpm test
pnpm test:e2e
pnpm lint
pnpm build
git status --short
```

If fixes were required:

```powershell
git add <only-reviewed-files>
git commit -m "fix: polish core task flow"
```

Expected: all checks pass and the worktree is clean apart from ignored local runtime files.
