# Phase 2 Core Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the persistent draft-to-start task loop for independently identified human and Codex workers, including readiness, scope, prerequisites, optimistic concurrency, and actual start history.

**Architecture:** Resolve a validated `ActorContext` at the HTTP boundary and inject it into one shared command service used by server actions and JSON routes. Keep domain transitions pure and make the SQLite repository enforce readiness, scope, conditional version updates, and event insertion in one transaction. UI pages read through actor-aware repository queries, while two browser contexts prove isolation and competition.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, SQLite via better-sqlite3, Vitest, Testing Library, Playwright, pnpm, Node `>=20.9 <24`.

**Spec:** `docs/superpowers/specs/2026-08-29-phase-2-core-prototype-design.md`

## Global Constraints

- Preserve the existing loginless prototype and default human fallback.
- Treat the actor selector and actor header as local prototype identity, not production authentication.
- Server actions and API routes must call the same task command service; neither may perform transitions or write SQLite directly.
- Every mutation requires `expectedVersion`, changes one versioned row, and appends exactly one event in the same transaction.
- Pool visibility is not authorization; take repeats actor, membership, scope, and prerequisite checks transactionally.
- `task_prerequisites.resolved_at` is the only Phase 2 prerequisite completion signal; dependency editing and cycle detection remain deferred.
- Start sets `started_at` exactly once and records the `started` event in the same transaction.
- Follow red-green-refactor for every production behavior and keep commits focused.

---

## File Structure

- `src/features/actors/domain/actor.ts`: actor IDs, actor types, and `ActorContext`.
- `src/features/actors/data/actor-repository.ts`: actor lookup contract.
- `src/features/actors/data/sqlite-actor-repository.ts`: active project-member validation.
- `src/features/actors/server/current-actor.ts`: cookie/header parsing and validated actor resolution.
- `src/features/actors/server/actions.ts`: loginless actor selection action.
- `src/features/actors/components/actor-switcher.tsx`: current worker selector.
- `src/db/schema.ts`, `drizzle/0002_core_prototype.sql`: actor type, start time, and prerequisite schema.
- `src/db/seed.ts`: idempotent human and Codex memberships/scopes.
- `src/features/tasks/domain/task.ts`: `startedAt` task property.
- `src/features/tasks/domain/task-transitions.ts`: clock-driven start transition.
- `src/features/tasks/data/task-repository.ts`: readiness and transaction context contracts.
- `src/features/tasks/data/sqlite-task-repository.ts`: actor-aware reads, readiness checks, start persistence, conditional update.
- `src/features/tasks/server/task-commands.ts`: injected actor and shared classified results.
- `src/features/tasks/server/actions.ts`: actor-aware form adapters.
- `src/app/api/tasks/**/route.ts`: minimal JSON read and command adapters.
- `src/components/app-shell.tsx`, `src/app/layout.tsx`: actor selector placement.
- `src/app/task-pool/page.tsx`, `src/app/my-work/page.tsx`, `src/app/tasks/[id]/page.tsx`, `src/app/tasks/new/page.tsx`: actor-aware reads and display.
- `tests/e2e/phase-2-core-prototype.spec.ts`: independent-session loop and competition.

---

### Task 1: Persist human and AI actor identities

**Files:**
- Create: `drizzle/0002_core_prototype.sql`
- Create: `src/features/actors/domain/actor.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/seed.ts`
- Modify: `src/db/seed.test.ts`

**Interfaces:**
- Produces: `ActorType = "human" | "ai"`.
- Produces: `ActorContext = { userId: string; projectId: string; actorType: ActorType }`.
- Produces: `HUMAN_USER_ID`, `CODEX_USER_ID`, `CODEX_MEMBER_ID` constants.
- Produces database columns `users.actor_type`, `tasks.started_at` and table `task_prerequisites(task_id, prerequisite_task_id, resolved_at)`.

- [ ] **Step 1: Write failing seed and schema tests**

Add assertions to `src/db/seed.test.ts`:

```ts
expect(database.prepare("SELECT id, actor_type FROM users ORDER BY id").all()).toEqual([
  { id: "user-codex", actor_type: "ai" },
  { id: "user-fixed", actor_type: "human" },
]);
expect(database.prepare("SELECT COUNT(*) count FROM project_members WHERE active = 1").get())
  .toEqual({ count: 2 });
expect(database.prepare("SELECT COUNT(*) count FROM member_work_scopes WHERE active = 1").get())
  .toEqual({ count: 6 });
expect(database.prepare("PRAGMA table_info(tasks)").all())
  .toEqual(expect.arrayContaining([expect.objectContaining({ name: "started_at" })]));
```

Add a test inserting a self prerequisite and expect a SQLite constraint error.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm vitest run src/db/seed.test.ts`

Expected: FAIL because `actor_type`, `started_at`, `task_prerequisites`, and the Codex rows do not exist.

- [ ] **Step 3: Add actor types, additive schema upgrade, and idempotent seed**

Create `actor.ts` with exact constants and type:

```ts
export type ActorType = "human" | "ai";
export type ActorContext = { userId: string; projectId: string; actorType: ActorType };
export const HUMAN_USER_ID = "user-fixed";
export const CODEX_USER_ID = "user-codex";
export const CODEX_MEMBER_ID = "member-codex";
```

Update schema creation and upgrades so existing user rows become `human`, add nullable `started_at`, and create `task_prerequisites` with primary key `(task_id, prerequisite_task_id)`, both foreign keys, and `CHECK(task_id <> prerequisite_task_id)`.

Seed `user-codex` as `ai`, its active default-project membership, and one active scope per default work type. Use upserts that preserve user-created task data.

- [ ] **Step 4: Run schema and seed tests**

Run: `pnpm vitest run src/db/seed.test.ts src/features/scope/data/sqlite-scope-repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Generate and inspect the migration**

Run: `pnpm db:generate`

Expected: `drizzle/0002_core_prototype.sql` contains additive actor, start, and prerequisite changes without destructive table drops. If the generator cannot express the safe upgrade, keep the reviewed hand-written migration and ensure `src/db/schema.ts` applies the same shape.

- [ ] **Step 6: Commit the actor persistence slice**

```bash
git add drizzle src/db src/features/actors/domain/actor.ts
git commit -m "feat: add human and ai actor records"
```

---

### Task 2: Resolve a validated actor for browser and API requests

**Files:**
- Create: `src/features/actors/data/actor-repository.ts`
- Create: `src/features/actors/data/sqlite-actor-repository.ts`
- Create: `src/features/actors/data/sqlite-actor-repository.test.ts`
- Create: `src/features/actors/server/current-actor.ts`
- Create: `src/features/actors/server/current-actor.test.ts`
- Create: `src/features/actors/server/actions.ts`
- Modify: `src/db/client.ts`

**Interfaces:**
- Consumes: `ActorContext`, `HUMAN_USER_ID`, `DEFAULT_PROJECT_ID`.
- Produces: `ActorRepository.findActiveProjectActor(userId, projectId): Promise<ActorContext | null>`.
- Produces: `resolveActor({ cookieActorId?, headerActorId? }): Promise<ActorContext>`.
- Produces: `getCurrentActor(): Promise<ActorContext>` for server components/actions.
- Produces: `selectActorAction(formData: FormData): Promise<void>`.

- [ ] **Step 1: Write failing repository validation tests**

Cover an active human, active Codex worker, unknown ID, inactive membership, and a user belonging only to another project:

```ts
expect(await repository.findActiveProjectActor("user-codex", DEFAULT_PROJECT_ID))
  .toEqual({ userId: "user-codex", projectId: DEFAULT_PROJECT_ID, actorType: "ai" });
expect(await repository.findActiveProjectActor("missing", DEFAULT_PROJECT_ID)).toBeNull();
```

- [ ] **Step 2: Run the repository test and verify failure**

Run: `pnpm vitest run src/features/actors/data/sqlite-actor-repository.test.ts`

Expected: FAIL because the actor repository does not exist.

- [ ] **Step 3: Implement active-member actor lookup**

Join `users` to `project_members`, require `m.active = 1`, match both IDs, and map `actor_type` to `ActorContext`. Add `getActorRepository()` to `src/db/client.ts` using the shared database.

- [ ] **Step 4: Write failing resolver precedence and fallback tests**

Inject an actor repository into a pure resolver factory and assert:

```ts
expect(await resolve({ headerActorId: "user-codex", cookieActorId: "user-fixed" }))
  .toMatchObject({ userId: "user-codex", actorType: "ai" });
expect(await resolve({ cookieActorId: "missing" }))
  .toMatchObject({ userId: "user-fixed", actorType: "human" });
```

Header precedence supports explicit local API calls; browser requests use the HTTP-only cookie; invalid values fall back only for browser cookie resolution. An explicitly invalid API header returns an `ACTOR_NOT_ALLOWED` error instead of impersonating the human fallback.

- [ ] **Step 5: Implement resolver and selector action**

Use cookie name `project-actor`. `selectActorAction` validates the posted ID before setting `{ httpOnly: true, sameSite: "lax", path: "/" }`, then revalidates `/task-pool` and `/my-work`. Do not accept project IDs from the form.

- [ ] **Step 6: Run actor tests**

Run: `pnpm vitest run src/features/actors`

Expected: PASS.

- [ ] **Step 7: Commit actor resolution**

```bash
git add src/features/actors src/db/client.ts
git commit -m "feat: resolve validated prototype actors"
```

---

### Task 3: Make task commands actor-aware and record actual starts

**Files:**
- Modify: `src/features/tasks/domain/task.ts`
- Modify: `src/features/tasks/domain/task-transitions.ts`
- Modify: `src/features/tasks/domain/task-transitions.test.ts`
- Modify: `src/features/tasks/server/task-commands.ts`
- Modify: `src/features/tasks/server/task-commands.test.ts`
- Modify: `src/features/tasks/server/command-result.ts`

**Interfaces:**
- Consumes: `createTaskCommands(repository, actor, clock?)` where `clock` defaults to `() => new Date().toISOString()`.
- Produces: `TaskRecord.startedAt: string | null`.
- Produces classified codes `ACTOR_NOT_ALLOWED`, `PREREQUISITE_UNRESOLVED`, `OWNERSHIP_REQUIRED`, and existing codes.

- [ ] **Step 1: Write failing actor-event and start-time tests**

Create commands for the Codex actor and assert create/take/start use `user-codex`. Inject `clock = () => "2026-08-29T12:00:00.000Z"` and assert:

```ts
expect(started.ok && await repository.findById(taskId)).toMatchObject({
  workStatus: "in_progress",
  assigneeId: "user-codex",
  startedAt: "2026-08-29T12:00:00.000Z",
});
```

Add a test that a human cannot start the Codex worker's task.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm vitest run src/features/tasks/domain/task-transitions.test.ts src/features/tasks/server/task-commands.test.ts`

Expected: FAIL because commands use `FIXED_USER_ID` and TaskRecord lacks `startedAt`.

- [ ] **Step 3: Inject actor and clock into the command service**

Change the factory to:

```ts
export function createTaskCommands(
  repository: TaskRepository,
  actor: ActorContext,
  clock: () => string = () => new Date().toISOString(),
) { /* commands */ }
```

Use `actor.userId` and `actor.projectId` in every command and event. Change `start(task, actorId, startedAt)` to return `startedAt`; reject any start when the actor is not the assignee, state is not `taken`, or a start time already exists.

- [ ] **Step 4: Map known repository/domain errors without leaking storage details**

Extend `CommandResult` and `failure()` so scope, prerequisite, ownership, actor, not-found, invalid-transition, and version errors retain distinct codes and Korean messages.

- [ ] **Step 5: Run task command and transition tests**

Run: `pnpm vitest run src/features/tasks/domain src/features/tasks/server`

Expected: PASS.

- [ ] **Step 6: Commit actor-aware commands**

```bash
git add src/features/tasks/domain src/features/tasks/server
git commit -m "feat: make task commands actor aware"
```

---

### Task 4: Enforce readiness, prerequisites, and versioned persistence

**Files:**
- Modify: `src/features/tasks/data/task-repository.ts`
- Modify: `src/features/tasks/data/sqlite-task-repository.ts`
- Modify: `src/features/tasks/data/sqlite-task-repository.test.ts`
- Create: `src/features/tasks/data/sqlite-task-concurrency.test.ts`

**Interfaces:**
- Produces: `CommandContext.requireTakeEligibility(actor: ActorContext): void`.
- Produces: `TaskRepository.listPool(actor: ActorContext): Promise<TaskListItem[]>`.
- Produces: `TaskRepository.listForAssignee(actor: ActorContext): Promise<TaskListItem[]>`.
- Persists `TaskRecord.startedAt` and a command-provided event timestamp.

- [ ] **Step 1: Write failing readiness tests**

Create one published task with an unresolved prerequisite and assert it is absent from `listPool(actor)` and direct `takeTask` returns `PREREQUISITE_UNRESOLVED`. Set `resolved_at`, assert it becomes visible and takeable. Also assert an actor without scope cannot see or take it.

- [ ] **Step 2: Run repository tests and verify failure**

Run: `pnpm vitest run src/features/tasks/data/sqlite-task-repository.test.ts`

Expected: FAIL because prerequisite rows are ignored and list methods accept strings.

- [ ] **Step 3: Implement one reusable readiness predicate**

Use the same SQL conditions in pool discovery and transactional eligibility:

```sql
t.publication_state = 'published'
AND t.work_status = 'open'
AND t.assignee_id IS NULL
AND NOT EXISTS (
  SELECT 1 FROM task_prerequisites p
  WHERE p.task_id = t.id AND p.resolved_at IS NULL
)
```

Inside `requireTakeEligibility`, classify missing active membership/scope as `SCOPE_REQUIRED` and unresolved rows as `PREREQUISITE_UNRESOLVED` before the domain transition.

- [ ] **Step 4: Persist `started_at` and event time atomically**

Map `started_at` in `toTask`. Include it in the conditional update. Extend `TaskEventInput` with `createdAt` and persist that exact value so start state and event use one clock reading.

- [ ] **Step 5: Write deterministic two-connection concurrency test**

Open two `better-sqlite3` connections to one temporary file, enable WAL and `busy_timeout`, construct one repository per connection, and submit take commands for different actors with the same `expectedVersion`. Assert:

```ts
expect(results.filter((result) => result.ok)).toHaveLength(1);
expect(database.prepare("SELECT COUNT(*) count FROM task_events WHERE task_id=? AND event_type='taken'").get(taskId))
  .toEqual({ count: 1 });
expect(database.prepare("SELECT assignee_id, version FROM tasks WHERE id=?").get(taskId))
  .toMatchObject({ version: 3 });
```

If synchronous SQLite serializes before the test barrier, start each attempt in a separate worker process against the same file; do not weaken the assertion to sequential calls.

- [ ] **Step 6: Run repository and concurrency tests**

Run: `pnpm vitest run src/features/tasks/data`

Expected: PASS repeatedly, including `--repeat=10` for the concurrency test.

- [ ] **Step 7: Commit transactional readiness**

```bash
git add src/features/tasks/data
git commit -m "feat: enforce ready task concurrency rules"
```

---

### Task 5: Connect actor-aware server actions and UI

**Files:**
- Create: `src/features/actors/components/actor-switcher.tsx`
- Modify: `src/features/actors/server/actions.ts`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/app-shell.test.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/features/tasks/server/actions.ts`
- Modify: `src/app/task-pool/page.tsx`
- Modify: `src/app/my-work/page.tsx`
- Modify: `src/app/tasks/new/page.tsx`
- Modify: `src/app/tasks/[id]/page.tsx`
- Modify: `src/features/tasks/components/task-card.tsx`
- Modify: `src/features/tasks/components/task-card.test.tsx`

**Interfaces:**
- Consumes: `getCurrentActor()`, `selectActorAction`, actor-aware repository reads, and `createTaskCommands(repository, actor)`.
- Produces: worker selector labelled `현재 작업자`, options `나 · 사람` and `Codex · AI`.

- [ ] **Step 1: Write failing shell and task-card UI tests**

Assert the shell renders selected actor name/type and the form posts actor ID. Assert an in-progress card renders `진행 중` and a non-empty formatted start time, while a taken card renders `가져옴` without a start time.

- [ ] **Step 2: Run component tests and verify failure**

Run: `pnpm vitest run src/components src/features/tasks/components`

Expected: FAIL because actor and start-time UI do not exist.

- [ ] **Step 3: Render the compact actor selector in the existing sidebar**

Resolve the current actor in `layout.tsx` and pass it into `AppShell`. Keep existing mockup spacing and place the selector above the current-project context. Submit on change; show a visible badge `사람` or `AI`.

- [ ] **Step 4: Resolve actor in every read and server action**

Replace every `FIXED_USER_ID` read with `getCurrentActor()`. Construct commands with the resolved actor. The task detail may hide impossible buttons for clarity, but direct commands must still reject invalid ownership/state.

- [ ] **Step 5: Add classified Korean feedback and start timestamp**

Keep the existing query-string error pattern. Ensure scope, unresolved prerequisite, stale version, and ownership errors render their shared command messages. Display `시작 YYYY. MM. DD. HH:mm` on an in-progress task.

- [ ] **Step 6: Run component, action-adjacent, and existing E2E tests**

Run: `pnpm test && pnpm test:e2e -- tests/e2e/core-task-flow.spec.ts`

Expected: PASS with default human fallback preserving the Phase 1 flow.

- [ ] **Step 7: Commit the actor-aware UI**

```bash
git add src/app src/components src/features/actors src/features/tasks
git commit -m "feat: add loginless worker switching"
```

---

### Task 6: Expose the shared core loop to Codex through JSON

**Files:**
- Create: `src/features/tasks/server/http.ts`
- Create: `src/features/tasks/server/http.test.ts`
- Create: `src/app/api/task-pool/route.ts`
- Create: `src/app/api/my-work/route.ts`
- Create: `src/app/api/tasks/route.ts`
- Create: `src/app/api/tasks/[id]/publish/route.ts`
- Create: `src/app/api/tasks/[id]/take/route.ts`
- Create: `src/app/api/tasks/[id]/start/route.ts`

**Interfaces:**
- Consumes: `resolveActor`, `createTaskCommands`, and actor-aware repository reads.
- Produces: `commandResultResponse(result): Response` with `200/201` success, `400` validation/state, `403` actor/scope/ownership, `404` not found, `409` version/prerequisite conflict, and `500` storage failure.
- Uses prototype header `x-project-actor: user-codex` or the current actor cookie.

- [ ] **Step 1: Write failing HTTP mapping tests**

Assert representative mappings:

```ts
expect(commandResultResponse({ ok: false, code: "VERSION_CONFLICT", message: "conflict" }).status).toBe(409);
expect(commandResultResponse({ ok: false, code: "SCOPE_REQUIRED", message: "forbidden" }).status).toBe(403);
```

Add route tests proving an unknown explicit actor header is rejected and a Codex actor create response stores `creator_id = 'user-codex'`.

- [ ] **Step 2: Run HTTP tests and verify failure**

Run: `pnpm vitest run src/features/tasks/server/http.test.ts`

Expected: FAIL because the response mapper and routes do not exist.

- [ ] **Step 3: Implement thin read and command handlers**

Parse JSON with Zod at the route boundary. Require numeric `expectedVersion` for publish, take, and start. Resolve actor once, call the same command service, and serialize `{ ok, data }` or `{ ok, code, message, fieldErrors? }`. Do not import `better-sqlite3` in route files.

- [ ] **Step 4: Run HTTP and command tests**

Run: `pnpm vitest run src/features/tasks/server src/features/actors/server`

Expected: PASS.

- [ ] **Step 5: Manually exercise the Codex API**

With the local server running, create a draft using `x-project-actor: user-codex`, publish it with version 1, list it in the pool, take with version 2, list it in My Work, and start with version 3. Confirm the stored events all use `user-codex` and the task has `started_at`.

- [ ] **Step 6: Commit JSON access**

```bash
git add src/app/api src/features/tasks/server
git commit -m "feat: expose shared task loop api"
```

---

### Task 7: Prove independent-session behavior and complete Phase 2 gates

**Files:**
- Create: `tests/e2e/phase-2-core-prototype.spec.ts`
- Modify: `tests/e2e/global-setup.ts`
- Modify: `playwright.config.ts`
- Create: `docs/development/phase-2-core-prototype-retrospective.md`

**Interfaces:**
- Consumes all Phase 2 behavior.
- Produces automated evidence for all ten design success criteria.

- [ ] **Step 1: Extend browser database reset for Phase 2 tables**

Delete prerequisite rows before task rows, then seed both actors. Assert global setup closes the database even when reset fails by using `try/finally`.

- [ ] **Step 2: Write the independent-context happy path**

Use `browser.newContext()` twice. Select `나 · 사람` in one and `Codex · AI` in the other. Have the human create/publish, verify both scoped contexts see it, let Codex take and start, then assert only Codex My Work contains the task and refresh preserves `진행 중` and its start time.

- [ ] **Step 3: Write the exact-one-winner browser competition**

Open the same pool task in both contexts before either action. Trigger both take submissions with `Promise.allSettled`, then assert one context reaches My Work, the other receives the conflict/no-longer-open message, and a database query shows one assignee and one `taken` event.

- [ ] **Step 4: Write prerequisite and scope rejection coverage**

Prepare one unresolved-prerequisite task and revoke one actor's development scope in setup. Assert it is absent from that actor's pool and a direct API take returns the classified failure. Resolve/restore fixture state after each test.

- [ ] **Step 5: Run the Phase 2 E2E repeatedly**

Run: `pnpm test:e2e -- tests/e2e/phase-2-core-prototype.spec.ts --repeat-each=3`

Expected: all repetitions PASS without shared-cookie or database leakage.

- [ ] **Step 6: Run the full verification matrix**

Run:

```bash
pnpm test
pnpm lint
pnpm build
pnpm test:e2e
```

Expected: all commands exit 0 under the repository's supported Node version.

- [ ] **Step 7: Audit every Phase 2 completion condition**

In `docs/development/phase-2-core-prototype-retrospective.md`, make a table mapping each milestone condition to its database constraint, command/repository test, browser test, and manual evidence. Record encountered problems, root causes, fixes, and any intentionally deferred work. Do not mark a condition complete without direct evidence.

- [ ] **Step 8: Commit the verified Phase 2 checkpoint**

```bash
git add tests docs/development
git commit -m "test: verify phase 2 core prototype"
```

- [ ] **Step 9: Record and publish the major milestone**

Create or update the Phase 2 problem/solution record in the designated Google Drive `04_AI` folder using the retrospective as source. Push the verified commits to the configured GitHub `ProjectManager` remote only after the full verification matrix passes. Confirm the remote commit ID matches local `HEAD`.

