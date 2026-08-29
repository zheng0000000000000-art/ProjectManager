# Phase 3 Human Completion and Audit Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add human task completion and a background audit trail that atomically records successful commands and separately records classified failures without exposing logs in normal UI or APIs.

**Architecture:** Extend the existing task domain and SQLite transaction boundary for terminal completion. Add a focused audit module; successful audit rows are inserted by `SqliteTaskRepository` inside the task/event transaction, while the command service writes standalone failure rows after rollback. Server actions and API routes share the same audited command factory.

**Tech Stack:** Next.js 16 App Router, React 19 server actions, TypeScript, better-sqlite3, Vitest, Testing Library, Playwright, ESLint.

**Spec:** `docs/superpowers/specs/2026-08-29-phase-3-human-completion-audit-log-design.md`

## Global Constraints

- Use Node.js `>=20.9 <24`; verification runs with Node.js 22.14.0 and pnpm 11.19.0.
- Audit logs are background-only: add no audit list page or audit read API.
- Keep `task_events` as domain facts and `audit_logs` as operational attempts.
- Store only allowlisted audit metadata: `expectedVersion`, `fieldNames`, and `actorType`.
- Never store cookies, headers, raw request bodies, stack traces, SQLite messages, task text, or completion summaries in `metadata_json`.
- Only a human assignee can complete an `in_progress` task.
- Every production behavior change follows a witnessed red-green test cycle.

---

### Task 1: Completion Schema and Domain Transition

**Files:**
- Create: `drizzle/0003_human_completion_audit_log.sql`
- Modify: `src/db/schema.ts`
- Modify: `src/features/tasks/domain/task.ts`
- Modify: `src/features/tasks/domain/task-transitions.ts`
- Test: `src/db/seed.test.ts`
- Test: `src/features/tasks/domain/task-transitions.test.ts`

**Interfaces:**
- Consumes: existing `TaskRecord`, `TaskDomainError`, and `createSchema(database)`.
- Produces: `WorkStatus` including `completed`; `TaskRecord.completedAt`; `TaskRecord.completionSummary`; `complete(task, actor, summary, completedAt)`.

- [ ] **Step 1: Write failing schema and domain tests**

Add a schema assertion for `tasks.completed_at`, `tasks.completion_summary`, and the `audit_logs` columns. Add domain tests using this contract:

```ts
const completed = complete(runningTask, humanActor, "검증을 마쳤다", "2026-08-29T15:00:00.000Z");
expect(completed).toMatchObject({
  workStatus: "completed",
  completedAt: "2026-08-29T15:00:00.000Z",
  completionSummary: "검증을 마쳤다",
  version: runningTask.version + 1,
});
expect(() => complete(runningTask, aiActor, "결과", now)).toThrow("사람 작업자");
expect(() => complete(runningTask, humanActor, "   ", now)).toThrow("완료 결과");
expect(() => complete({ ...runningTask, assigneeId: "someone-else" }, humanActor, "결과", now)).toThrow("담당자");
expect(() => complete({ ...runningTask, workStatus: "completed" }, humanActor, "결과", now)).toThrow("진행 중");
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
pnpm test src/db/seed.test.ts src/features/tasks/domain/task-transitions.test.ts
```

Expected: FAIL because completion columns, `completed` status, and `complete` do not exist.

- [ ] **Step 3: Add the migration and runtime schema**

Create the migration with:

```sql
ALTER TABLE tasks ADD COLUMN completed_at TEXT;
ALTER TABLE tasks ADD COLUMN completion_summary TEXT;
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_id TEXT REFERENCES tasks(id),
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('success', 'failure')),
  error_code TEXT,
  from_state TEXT,
  to_state TEXT,
  request_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX audit_logs_task_created_idx ON audit_logs(task_id, created_at);
CREATE INDEX audit_logs_request_idx ON audit_logs(request_id);
CREATE INDEX audit_logs_project_created_idx ON audit_logs(project_id, created_at);
```

Mirror this in `createSchema` and add guarded upgrades for the two task columns.

- [ ] **Step 4: Implement the completion domain rule**

Extend `TaskRecord` with nullable completion fields and implement:

```ts
export function complete(
  task: TaskRecord,
  actor: ActorContext,
  completionSummary: string,
  completedAt: string,
): TaskRecord
```

Validate human actor type, ownership, `in_progress`, existing `startedAt`, unset completion fields, and trimmed non-empty summary before returning the terminal state.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add drizzle/0003_human_completion_audit_log.sql src/db/schema.ts src/db/seed.test.ts src/features/tasks/domain/task.ts src/features/tasks/domain/task-transitions.ts src/features/tasks/domain/task-transitions.test.ts
git commit -m "feat: add human task completion schema"
```

---

### Task 2: Audit Types and SQLite Failure Repository

**Files:**
- Create: `src/features/audit/domain/audit-entry.ts`
- Create: `src/features/audit/data/audit-repository.ts`
- Create: `src/features/audit/data/sqlite-audit-repository.ts`
- Create: `src/features/audit/data/sqlite-audit-repository.test.ts`
- Modify: `src/db/client.ts`

**Interfaces:**
- Consumes: the `audit_logs` schema from Task 1.
- Produces: `AuditEntryInput`, `TaskAuditAction`, `AuditRepository.appendFailure`, and `getAuditRepository()`.

- [ ] **Step 1: Write the failing repository test**

Test a real in-memory database:

```ts
await repository.appendFailure({
  projectId: "project-default",
  taskId: null,
  actorId: null,
  action: "task.take",
  outcome: "failure",
  errorCode: "ACTOR_REJECTED",
  fromState: null,
  toState: null,
  requestId: "request-1",
  metadata: { expectedVersion: 2, fieldNames: ["actorId"] },
  createdAt: "2026-08-29T15:00:00.000Z",
});
expect(repository.listByRequestIdForTest("request-1")).toEqual([
  expect.objectContaining({ outcome: "failure", actorId: null, metadata: { expectedVersion: 2, fieldNames: ["actorId"] } }),
]);
```

Also assert that passing a forbidden metadata key throws before SQL execution.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm test src/features/audit/data/sqlite-audit-repository.test.ts
```

Expected: FAIL because the audit module does not exist.

- [ ] **Step 3: Implement focused audit types and allowlist validation**

Define stable actions and metadata:

```ts
export type TaskAuditAction = "task.create" | "task.publish" | "task.take" |
  "task.start" | "task.return" | "task.complete";
export type SafeAuditMetadata = Partial<{
  expectedVersion: number;
  fieldNames: string[];
  actorType: "human" | "ai";
}>;
```

Serialize only these exact keys, require finite numeric versions and string arrays, and parse rows back for tests.

- [ ] **Step 4: Implement SQLite persistence and factory wiring**

`appendFailure` must reject `outcome !== "failure"`, insert one row in an immediate transaction, and never expose a production list method. Add `getAuditRepository()` beside the existing database factories.

- [ ] **Step 5: Run the test and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/features/audit src/db/client.ts
git commit -m "feat: add internal audit failure repository"
```

---

### Task 3: Atomic Success Audits in the Task Repository

**Files:**
- Modify: `src/features/tasks/data/task-repository.ts`
- Modify: `src/features/tasks/data/sqlite-task-repository.ts`
- Modify: `src/features/tasks/data/sqlite-task-repository.test.ts`
- Modify: `src/features/tasks/data/sqlite-task-concurrency.test.ts`
- Modify: `src/features/tasks/data/sqlite-task-take-worker.ts`

**Interfaces:**
- Consumes: `AuditEntryInput` from Task 2.
- Produces: audited `createDraft(actorId, projectId, audit)` and `runCommand(taskId, expectedVersion, audit, command)` transactions.

- [ ] **Step 1: Write failing atomicity tests**

Update repository tests to pass a success audit template and assert one task,
one task event, and one success audit. Add a rollback test that installs a
temporary SQLite trigger rejecting `audit_logs` inserts, then asserts task
version and event count remain unchanged after `runCommand` rejects.

- [ ] **Step 2: Run repository tests and verify RED**

```powershell
pnpm test src/features/tasks/data/sqlite-task-repository.test.ts src/features/tasks/data/sqlite-task-concurrency.test.ts
```

Expected: FAIL because repository methods do not accept or insert audits.

- [ ] **Step 3: Extend repository transaction inputs**

Add:

```ts
type SuccessAuditInput = Omit<AuditEntryInput, "outcome" | "fromState" | "toState">;
```

`createDraft` inserts `task.create` with `from_state = null` and
`to_state = "draft"`. `runCommand` inserts its audit after the conditional task
update and event insert, using actual `task.workStatus` and `next.workStatus`.

- [ ] **Step 4: Persist completion columns in every task update/read**

Add `completed_at` and `completion_summary` to `TaskRow`, `toTask`, and the
conditional `UPDATE tasks` statement. Keep the audit insert in the same
`.immediate()` transaction.

- [ ] **Step 5: Update concurrency worker inputs and verify GREEN**

Give each worker a unique request ID and `task.take` success audit template.
Assert exactly one `taken` event and one successful `task.take` audit. Run the
command from Step 2. Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/features/tasks/data
git commit -m "feat: commit task changes with success audits"
```

---

### Task 4: Audited Commands and Human Completion

**Files:**
- Create: `src/features/audit/server/audited-actor-resolver.ts`
- Create: `src/features/audit/server/audited-actor-resolver.test.ts`
- Modify: `src/features/tasks/server/command-result.ts`
- Modify: `src/features/tasks/server/task-commands.ts`
- Modify: `src/features/tasks/server/task-commands.test.ts`

**Interfaces:**
- Consumes: audited task repository methods, `AuditRepository`, `ActorContext`, and `complete`.
- Produces: `createTaskCommands(repository, auditRepository, actor, context)`, `completeTask(input)`, and `resolveActorForMutation(input)`.

- [ ] **Step 1: Write failing command audit tests**

Use a real in-memory SQLite database and fixed context:

```ts
const context = { requestId: "request-complete", clock: () => "2026-08-29T15:00:00.000Z" };
const commands = createTaskCommands(tasks, audits, humanActor, context);
const result = await commands.completeTask({ taskId, expectedVersion: 4, completionSummary: "완료했다" });
expect(result.ok).toBe(true);
expect(audits.listByRequestIdForTest("request-complete")).toEqual([
  expect.objectContaining({ action: "task.complete", outcome: "success", toState: "completed" }),
]);
```

Add table-driven failure cases for validation, scope, prerequisite, ownership,
state, not found, and stale version. Each case asserts one failure audit, zero
success audits, unchanged task state, and unchanged event count.

- [ ] **Step 2: Run command tests and verify RED**

```powershell
pnpm test src/features/tasks/server/task-commands.test.ts src/features/audit/server/audited-actor-resolver.test.ts
```

Expected: FAIL because audited commands and completion do not exist.

- [ ] **Step 3: Refactor failure classification to return audit-safe data**

Create an internal classifier returning both the existing `CommandResult` and:

```ts
{ errorCode: string; fieldNames: string[] }
```

On catch, append one standalone failure audit with only `expectedVersion`,
`fieldNames`, and `actorType`. Catch audit persistence errors, call
`console.error("Audit persistence failed", auditError)`, and return the original
command classification unchanged.

- [ ] **Step 4: Add completion and actor-resolution auditing**

Implement `completeTask` with the fixed clock shared by the completion event
and audit. Implement `AuditedActorResolver` so a rejected mutation actor creates
`ACTOR_REJECTED` with `actorId: null` and no untrusted ID in metadata.

- [ ] **Step 5: Run focused and full unit tests**

Run the command from Step 2, then `pnpm test`. Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/features/audit/server src/features/tasks/server
git commit -m "feat: audit task commands and human completion"
```

---

### Task 5: Completion Server Action, API, and Task Detail UI

**Files:**
- Create: `src/app/api/tasks/[id]/complete/route.ts`
- Create: `src/app/tasks/[id]/complete-task-form.tsx`
- Create: `src/app/tasks/[id]/complete-task-form.test.tsx`
- Modify: `src/features/tasks/server/actions.ts`
- Modify: `src/app/tasks/[id]/page.tsx`
- Modify: `src/features/tasks/components/task-card.tsx`
- Modify: `src/features/tasks/components/task-card.test.tsx`
- Modify: `src/app/globals.css`
- Test: `src/features/tasks/server/http.test.ts`

**Interfaces:**
- Consumes: `completeTask`, current human actor, and existing command-result HTTP mapping.
- Produces: `completeTaskAction`, `POST /api/tasks/[id]/complete`, and `CompleteTaskForm`.

- [ ] **Step 1: Write failing component and HTTP tests**

Assert that the form renders a labeled `완료 결과` textarea, hidden task ID and
version, validation feedback, and `작업 완료` button. Extend task-card tests so
a completed task shows `완료`, completion time, and summary. Add HTTP mapping
coverage for completion validation and actor rejection.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
pnpm test src/app/tasks/[id]/complete-task-form.test.tsx src/features/tasks/components/task-card.test.tsx src/features/tasks/server/http.test.ts
```

Expected: FAIL because the completion UI and status rendering do not exist.

- [ ] **Step 3: Implement server action and API route**

Parse `taskId`, `expectedVersion`, and `completionSummary`, create one request ID
per mutation, resolve the actor through the audited mutation resolver, and call
the shared command. The API returns success using the existing JSON envelope;
validation remains `400`, actor/ownership `403`, conflict/state `409`.

- [ ] **Step 4: Implement the minimal completion UI**

Render `CompleteTaskForm` only for the human assignee of an `in_progress` task.
After completion, render the terminal status, formatted completion time, and
result summary. Do not query or render `audit_logs`.

- [ ] **Step 5: Run focused tests, lint, and build**

```powershell
pnpm test src/app/tasks/[id]/complete-task-form.test.tsx src/features/tasks/components/task-card.test.tsx src/features/tasks/server/http.test.ts
pnpm lint
pnpm build
```

Expected: all commands PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app src/features/tasks/components src/features/tasks/server
git commit -m "feat: complete human tasks from ui and api"
```

---

### Task 6: Browser Privacy and Completion Verification

**Files:**
- Create: `tests/e2e/phase-3-human-completion-audit.spec.ts`
- Modify: `tests/e2e/global-setup.ts`
- Create: `docs/development/phase-3-human-completion-audit-retrospective.md`

**Interfaces:**
- Consumes: browser completion UI, completion API, SQLite audit rows.
- Produces: end-to-end completion, audit privacy, and failure-audit evidence.

- [ ] **Step 1: Write the failing browser scenarios**

Cover these exact flows:

```ts
test("human completion persists while audits stay internal", async ({ page }) => {
  // create, publish, take, start, open detail, enter result, complete
  // refresh and assert completed status, time, and result
  // assert page HTML and JSON task reads contain no request_id or metadata_json
  // inspect SQLite and assert one task.complete success audit
});

test("failed completion is audited without changing the task", async ({ request }) => {
  // attempt empty summary and AI completion
  // assert classified responses, unchanged task/version/events
  // assert one failure audit per request ID and no raw summary in metadata_json
});
```

- [ ] **Step 2: Run the new spec and verify RED**

```powershell
pnpm test:e2e -- tests/e2e/phase-3-human-completion-audit.spec.ts
```

Expected: FAIL until UI/API integration and global setup support the new schema.

- [ ] **Step 3: Make test setup deterministic**

Ensure global setup initializes Phase 3 schema, seeds only the existing actors,
and clears `audit_logs` through database recreation rather than production
delete APIs. Do not add audit history to the seed.

- [ ] **Step 4: Run the Phase 3 spec and full verification matrix**

```powershell
pnpm test:e2e -- tests/e2e/phase-3-human-completion-audit.spec.ts
pnpm test
pnpm lint
pnpm build
pnpm test:e2e
```

Expected: all commands PASS with zero failed tests.

- [ ] **Step 5: Write the local retrospective**

Record only observed problems, evidence, causes, fixes, and prevention in
`docs/development/phase-3-human-completion-audit-retrospective.md`. Include the
final test counts and explicitly state that audit logs are not the timeline.

- [ ] **Step 6: Commit**

```powershell
git add tests/e2e docs/development/phase-3-human-completion-audit-retrospective.md
git commit -m "test: verify phase 3 completion audit log"
```

---

### Task 7: External Record and Verified Checkpoint

**Files:**
- No additional source files unless final verification exposes a defect.

**Interfaces:**
- Consumes: verified Phase 3 implementation and local retrospective.
- Produces: Google Drive problem/solution record and GitHub checkpoint.

- [ ] **Step 1: Re-run completion verification immediately before release**

Run `pnpm test`, `pnpm lint`, `pnpm build`, and `pnpm test:e2e`. Read every exit
code and test count. Stop if any command fails.

- [ ] **Step 2: Create the Google Drive record**

Create `ProjectManager Phase 3 사람 작업 완료·감사 로그 · 문제와 해결 기록`
inside Drive folder `04_AI` (`1oYe-OKD1nZQjBx6MI3cAzwfX3VPQg68I`). Summarize
the verified scope, observed problems, solutions, prevention, and final test
evidence. Read it back and verify both content and parent folder.

- [ ] **Step 3: Finish the development branch**

Use `superpowers:finishing-a-development-branch`, present its integration
options, execute the selected option, and re-run the full matrix on the merged
tree when locally merged.

- [ ] **Step 4: Push the authorized large-feature checkpoint**

After a green merged tree and consistent user authorization, push the chosen
branch or `main` to `https://github.com/zheng0000000000000-art/ProjectManager.git`
using the repository's configured `origin`. Report the actual resulting commit
and URL; never force-push.
