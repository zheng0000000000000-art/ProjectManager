# Task Card, Subtasks, and Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the task card as a human-first execution unit with calculated priority, one-level subtasks, review states, permissions, events, and auditable mutations, while keeping the stored structure ready for later AI actors and timeline scheduling.

**Architecture:** Keep `Task` as the aggregate root and store `Subtask` as a dedicated child entity rather than a recursive task. Add focused priority and subtask modules beside the existing task domain, extend the SQLite repository through explicit interfaces, and route every mutation through the current command/result and audit boundary. The task detail page composes one read model from task, priority, subtasks, member choices, and visible events.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, SQLite via better-sqlite3, Vitest and Testing Library, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-29-task-card-subtasks-priority-design.md`

## Global Constraints

- `Task` remains the aggregate root; `Subtask` is a one-level child and cannot own children.
- Browser mutations remain human-first; `users.actor_type` does not grant permission by itself.
- Existing direct completion remains compatible, while the new task detail defaults to review request and completion confirmation.
- User-visible task/subtask events remain separate from internal `audit_logs`.
- Successful data changes, visible events, and success audits commit atomically.
- Cross-project member/task references and inactive-member assignment are rejected server-side.
- Schedule blocks, milestones, AI automatic execution, recursive subtasks, promotion execution, and productivity scoring are outside this plan.
- Use test-first changes and commit after every independently testable task.

---

## File Structure

### Database and shared model

- Modify `drizzle/0004_task_card_subtasks_priority.sql`: schema migration for task description, expanded work statuses, task-card permissions, priority tables, subtasks, and subtask events.
- Modify `src/db/schema.ts`: fresh-database schema plus safe upgrades matching migration 0004.
- Modify `src/db/seed.ts`: deterministic priority, project member, and subtask fixtures for UI/E2E coverage.

### Task aggregate and priority

- Modify `src/features/tasks/domain/task.ts`: expanded `WorkStatus`, task description, priority read model.
- Modify `src/features/tasks/domain/task-transitions.ts`: review, waiting, hold, resume, revision, and confirmation transitions.
- Create `src/features/tasks/domain/priority.ts`: deterministic score inputs, calculation, and ordering policy.
- Create `src/features/tasks/domain/priority.test.ts`: calculation and tie-break tests.
- Modify `src/features/tasks/domain/task-transitions.test.ts`: full transition table and compatibility tests.

### Subtasks

- Create `src/features/subtasks/domain/subtask.ts`: child record, statuses, inputs, and transition functions.
- Create `src/features/subtasks/domain/subtask.test.ts`: lifecycle, permission-independent invariants, and parent-completed guards.
- Create `src/features/subtasks/data/subtask-repository.ts`: repository interfaces and error types.
- Create `src/features/subtasks/data/sqlite-subtask-repository.ts`: transactional SQLite implementation.
- Create `src/features/subtasks/data/sqlite-subtask-repository.test.ts`: ordering, project boundary, concurrency, event, and audit tests.
- Create `src/features/subtasks/server/subtask-commands.ts`: actor-aware commands and public results.
- Create `src/features/subtasks/server/subtask-commands.test.ts`: ownership, assignment, transition, and failure-audit tests.
- Create `src/features/subtasks/server/actions.ts`: validated server actions and task-detail revalidation.

### Task repository, commands, and read model

- Modify `src/features/tasks/data/task-repository.ts`: priority/detail interfaces and command capabilities.
- Modify `src/features/tasks/data/sqlite-task-repository.ts`: description persistence, priority reads/writes, review-state persistence, sorted task lists.
- Modify `src/features/tasks/data/sqlite-task-repository.test.ts`: migration-compatible reads, atomic priority changes, and sorting.
- Modify `src/features/tasks/server/task-commands.ts`: card update, priority adjustment, and review-state commands.
- Modify `src/features/tasks/server/task-commands.test.ts`: validation, permissions, audit metadata, and compatibility.
- Modify `src/features/tasks/server/actions.ts`: form actions for new task-card commands.
- Modify `src/features/audit/domain/audit-entry.ts`: explicit task/subtask action union and safe metadata keys.
- Modify `src/db/client.ts`: instantiate and export the subtask repository.

### UI and end-to-end verification

- Modify `src/app/tasks/[id]/page.tsx`: compose the complete task detail read model and permission-specific actions.
- Create `src/app/tasks/[id]/task-card-details.tsx`: main information, priority breakdown, and review-state controls.
- Create `src/app/tasks/[id]/subtask-list.tsx`: ordered child list, progress summary, forms, and available actions.
- Create `src/app/tasks/[id]/subtask-list.test.tsx`: rendering and permission visibility tests.
- Modify `src/features/tasks/components/task-card.tsx`: priority badge and expanded status labels.
- Modify `src/features/tasks/components/task-card.test.tsx`: priority and status rendering.
- Modify `src/app/globals.css`: task-detail and subtask responsive styles.
- Create `tests/e2e/task-card-subtasks-priority.spec.ts`: complete browser flow.

---

### Task 1: Persist the complete task-card foundation

**Files:**
- Create: `drizzle/0004_task_card_subtasks_priority.sql`
- Modify: `src/db/schema.ts`
- Modify: `src/db/seed.ts`
- Test: `src/db/seed.test.ts`
- Test: `src/features/tasks/data/sqlite-task-repository.test.ts`

**Interfaces:**
- Produces tables `member_permissions`, `priority_current`, `task_priority_adjustments`, `subtasks`, and `subtask_events`.
- Produces `tasks.description` and a `work_status` value set that accepts `open`, `taken`, `in_progress`, `waiting`, `on_hold`, `review_requested`, `revision_requested`, and `completed`.
- Later tasks rely on `subtasks.version`, `(task_id, position)`, and `priority_current.task_id` uniqueness.

- [ ] **Step 1: Add failing schema tests**

Add assertions that a fresh in-memory database contains the new columns, tables, checks, foreign keys, and indexes. Include an insertion test that rejects `subtasks.task_id = NULL`, a status outside the four allowed subtask statuses, and a negative `position`.

```ts
expect(columns(database, "tasks")).toContain("description");
expect(tableNames(database)).toEqual(expect.arrayContaining([
  "member_permissions",
  "priority_current",
  "task_priority_adjustments",
  "subtasks",
  "subtask_events",
]));
expect(() => database.prepare(`INSERT INTO subtasks
  (id, task_id, title, description, position, status, version, created_by, created_at, updated_at)
  VALUES ('bad', NULL, 'x', '', 0, 'todo', 1, 'user-fixed', ?, ?)`)
  .run(now, now)).toThrow();
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm vitest run src/db/seed.test.ts src/features/tasks/data/sqlite-task-repository.test.ts`

Expected: FAIL because `description`, priority tables, and subtask tables do not exist.

- [ ] **Step 3: Add migration 0004 and fresh-schema definitions**

Use concrete SQLite definitions equivalent to:

```sql
ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT '';

CREATE TABLE member_permissions (
  member_id TEXT NOT NULL REFERENCES project_members(id),
  permission_key TEXT NOT NULL CHECK(permission_key IN ('priority_adjust','completion_confirm')),
  granted_by TEXT NOT NULL REFERENCES users(id),
  granted_at TEXT NOT NULL,
  PRIMARY KEY(member_id, permission_key)
);

CREATE TABLE priority_current (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id),
  deadline_pressure_score INTEGER NOT NULL,
  dependency_score INTEGER NOT NULL,
  manager_adjustment_score INTEGER NOT NULL,
  final_score INTEGER NOT NULL,
  downstream_active_count INTEGER NOT NULL DEFAULT 0,
  calculated_at TEXT NOT NULL,
  calculation_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE task_priority_adjustments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  previous_value INTEGER NOT NULL,
  new_value INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  changed_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL CHECK(position >= 0),
  assignee_member_id TEXT REFERENCES project_members(id),
  status TEXT NOT NULL CHECK(status IN ('todo','in_progress','completion_requested','completed')),
  promoted_task_id TEXT REFERENCES tasks(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE subtask_events (
  id TEXT PRIMARY KEY,
  subtask_id TEXT NOT NULL REFERENCES subtasks(id),
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  from_state TEXT,
  to_state TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
```

Create indexes on `subtasks(task_id, position)`, `subtask_events(subtask_id, created_at)`, `task_priority_adjustments(task_id, created_at)`, `priority_current(final_score)`, and `member_permissions(permission_key, member_id)`.

Because SQLite cannot alter the existing `work_status` check in place, inspect the actual table SQL first. If a check exists, rebuild `tasks` within the migration using `tasks_new`, copy all columns, drop the old table only after verifying the copy count, rename, and recreate indexes. Preserve all existing task IDs and foreign-key targets. Mirror the final definition in `createSchema` for new databases.

- [ ] **Step 4: Seed deterministic examples**

Seed one task with priority components and at least three subtasks in different states and positions. Grant the existing human administrator `priority_adjust` and `completion_confirm`. Use fixed IDs so E2E tests can locate them. Do not seed an AI-owned browser action; retain the human default.

- [ ] **Step 5: Run schema and seed tests**

Run: `pnpm vitest run src/db/seed.test.ts src/db/seed-script.test.ts src/features/tasks/data/sqlite-task-repository.test.ts`

Expected: PASS with the migration and fresh schema producing equivalent structures.

- [ ] **Step 6: Commit the database foundation**

```bash
git add drizzle/0004_task_card_subtasks_priority.sql src/db/schema.ts src/db/seed.ts src/db/seed.test.ts src/features/tasks/data/sqlite-task-repository.test.ts
git commit -m "feat: add task card subtask priority schema"
```

---

### Task 2: Define task states and deterministic priority policy

**Files:**
- Modify: `src/features/tasks/domain/task.ts`
- Modify: `src/features/tasks/domain/task-transitions.ts`
- Modify: `src/features/tasks/domain/task-transitions.test.ts`
- Create: `src/features/tasks/domain/priority.ts`
- Create: `src/features/tasks/domain/priority.test.ts`

**Interfaces:**
- Produces `PriorityComponents`, `PriorityCurrent`, `calculatePriority(input)`, and `compareTaskPriority(a, b)`.
- Produces transitions `requestReview`, `wait`, `hold`, `resume`, `requestRevision`, and `confirmCompletion` without removing existing `complete` compatibility.
- Consumers receive normalized domain errors through existing `TaskDomainError`.

- [ ] **Step 1: Write failing transition-table tests**

Test every allowed edge and at least one rejected edge per source state. Require a non-empty waiting target and hold reason. Assert only a human actor with confirmation permission can confirm completion.

```ts
expect(requestReview(inProgressTask, assignee)).toMatchObject({ workStatus: "review_requested" });
expect(() => hold(inProgressTask, assignee, " ")).toThrowError("보류 이유를 입력해 주세요.");
expect(confirmCompletion(reviewTask, humanConfirmer, now)).toMatchObject({
  workStatus: "completed",
  completedAt: now,
});
```

- [ ] **Step 2: Write failing priority-policy tests**

Use fixed integer inputs. Assert the final score is the sum of components and ordering follows final score, deadline with null last, downstream count, then creation time.

```ts
expect(calculatePriority({
  deadlinePressureScore: 7,
  dependencyScore: 3,
  managerAdjustmentScore: -1,
  downstreamActiveCount: 3,
  calculatedAt: now,
})).toMatchObject({ finalScore: 9, calculationVersion: 1 });
```

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm vitest run src/features/tasks/domain/task-transitions.test.ts src/features/tasks/domain/priority.test.ts`

Expected: FAIL because expanded statuses and priority functions are absent.

- [ ] **Step 4: Implement minimal domain types and pure functions**

Keep priority calculation pure and free of database access. Add `description` and optional `priority` to task read types. Implement each transition as a focused function that returns a version-incremented task and never writes events directly.

- [ ] **Step 5: Run task-domain tests**

Run: `pnpm vitest run src/features/tasks/domain/task-transitions.test.ts src/features/tasks/domain/priority.test.ts`

Expected: PASS, including existing direct completion tests.

- [ ] **Step 6: Commit the domain policy**

```bash
git add src/features/tasks/domain/task.ts src/features/tasks/domain/task-transitions.ts src/features/tasks/domain/task-transitions.test.ts src/features/tasks/domain/priority.ts src/features/tasks/domain/priority.test.ts
git commit -m "feat: define task review states and priority policy"
```

---

### Task 3: Implement the one-level subtask domain and repository

**Files:**
- Create: `src/features/subtasks/domain/subtask.ts`
- Create: `src/features/subtasks/domain/subtask.test.ts`
- Create: `src/features/subtasks/data/subtask-repository.ts`
- Create: `src/features/subtasks/data/sqlite-subtask-repository.ts`
- Create: `src/features/subtasks/data/sqlite-subtask-repository.test.ts`
- Modify: `src/db/client.ts`

**Interfaces:**
- Produces `SubtaskRecord`, `SubtaskStatus`, `createSubtaskRecord`, `updateSubtaskRecord`, and `transitionSubtaskRecord`.
- Produces `SubtaskRepository.listForTask(taskId, actor)`, `create`, `update`, `reorder`, `assign`, and `transition`.
- All write methods accept `expectedVersion`, `actor`, timestamp, and success-audit input, and return the updated child or ordered list.

- [ ] **Step 1: Write failing subtask domain tests**

Cover trimmed titles, non-negative position, forward-only transitions, completion timestamp, and the completed-parent guard.

```ts
expect(transitionSubtaskRecord(todo, "in_progress", now)).toMatchObject({
  status: "in_progress",
  version: 2,
});
expect(() => transitionSubtaskRecord(todo, "completed", now)).toThrow();
```

- [ ] **Step 2: Write failing repository tests**

Test ordered reads, active same-project assignment, rejection of a different-project member, stale version conflict, event insertion, audit insertion, and rollback when event insertion fails.

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm vitest run src/features/subtasks/domain/subtask.test.ts src/features/subtasks/data/sqlite-subtask-repository.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement the child entity and repository contract**

Define exact statuses:

```ts
export type SubtaskStatus = "todo" | "in_progress" | "completion_requested" | "completed";

export interface SubtaskRecord {
  id: string;
  taskId: string;
  title: string;
  description: string;
  position: number;
  assigneeMemberId: string | null;
  status: SubtaskStatus;
  promotedTaskId: string | null;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
```

Repository commands must load the parent task and active project member inside the same immediate transaction. Never accept a nested `parentSubtaskId` field.

- [ ] **Step 5: Register `getSubtaskRepository()`**

Instantiate one `SqliteSubtaskRepository` from the shared database in `src/db/client.ts`, following the existing lazy singleton pattern used by task and audit repositories.

- [ ] **Step 6: Run subtask tests**

Run: `pnpm vitest run src/features/subtasks/domain/subtask.test.ts src/features/subtasks/data/sqlite-subtask-repository.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the subtask model and storage**

```bash
git add src/features/subtasks src/db/client.ts
git commit -m "feat: add one-level subtask storage"
```

---

### Task 4: Persist priority and sort task queries

**Files:**
- Modify: `src/features/tasks/data/task-repository.ts`
- Modify: `src/features/tasks/data/sqlite-task-repository.ts`
- Modify: `src/features/tasks/data/sqlite-task-repository.test.ts`

**Interfaces:**
- Produces `TaskDetailRecord` with `description` and `priority: PriorityCurrent | null`.
- Produces `recalculatePriority(taskId, inputs, audit)` and `adjustPriority(taskId, expectedVersion, adjustment, audit)`.
- `listPool` and `listForAssignee` return task items ordered by the approved tie-break policy.

- [ ] **Step 1: Add failing repository tests**

Create four tasks that differ at each tie-break level. Assert the exact order and null deadlines last. Test adjustment history reason persistence and atomic current-score replacement.

- [ ] **Step 2: Run focused repository tests and verify failure**

Run: `pnpm vitest run src/features/tasks/data/sqlite-task-repository.test.ts`

Expected: FAIL because priority is not joined or sorted.

- [ ] **Step 3: Add priority joins and mapping**

Use a left join so pre-migration or uncalculated tasks remain visible. Map absent rows to `priority: null` and render them below scored tasks. Keep `TaskRecord` mutation persistence separate from list/detail SQL mapping.

- [ ] **Step 4: Implement atomic adjustment and recalculation**

Within one immediate transaction: validate reason, insert `task_priority_adjustments`, upsert `priority_current`, append one success audit, and increment the task version only when the manager adjustment command changes task-card state. Reject stale expected versions.

- [ ] **Step 5: Run repository and concurrency tests**

Run: `pnpm vitest run src/features/tasks/data/sqlite-task-repository.test.ts src/features/tasks/data/sqlite-task-concurrency.test.ts`

Expected: PASS with deterministic priority ordering and no stale overwrite.

- [ ] **Step 6: Commit priority persistence**

```bash
git add src/features/tasks/data/task-repository.ts src/features/tasks/data/sqlite-task-repository.ts src/features/tasks/data/sqlite-task-repository.test.ts
git commit -m "feat: persist and sort calculated task priority"
```

---

### Task 5: Expose audited task-card and subtask commands

**Files:**
- Modify: `src/features/audit/domain/audit-entry.ts`
- Modify: `src/features/tasks/server/task-commands.ts`
- Modify: `src/features/tasks/server/task-commands.test.ts`
- Create: `src/features/subtasks/server/subtask-commands.ts`
- Create: `src/features/subtasks/server/subtask-commands.test.ts`
- Modify: `src/features/tasks/server/task-mutation-commands.ts`

**Interfaces:**
- Produces task commands `updateTaskCard`, `adjustTaskPriority`, `requestTaskReview`, `waitTask`, `holdTask`, `resumeTask`, `requestTaskRevision`, and `confirmTaskCompletion`.
- Produces subtask commands `createSubtask`, `updateSubtask`, `reorderSubtasks`, `assignSubtask`, and `transitionSubtask`.
- All return existing `CommandResult<{ taskId: string }>` or `CommandResult<{ taskId: string; subtaskId: string }>` shapes.
- Permission checks query `member_permissions` for `priority_adjust` and `completion_confirm`; project administrators receive these rows through seed/migration data rather than an implicit actor-type bypass.

- [ ] **Step 1: Extend the closed audit action union**

Add explicit actions rather than accepting arbitrary strings:

```ts
export type TaskAuditAction =
  | ExistingTaskAuditAction
  | "task.update_card"
  | "task.adjust_priority"
  | "task.request_review"
  | "task.wait"
  | "task.hold"
  | "task.resume"
  | "task.request_revision"
  | "task.confirm_completion"
  | "subtask.create"
  | "subtask.update"
  | "subtask.reorder"
  | "subtask.assign"
  | "subtask.transition";
```

Permit only safe metadata keys already needed for diagnostics: `expectedVersion`, `fieldNames`, `actorType`, and `subtaskId`. Validate `subtaskId` as a string.

- [ ] **Step 2: Write failing command tests**

Test creator-only draft update, assignee-only task transitions, priority permission, active-member assignment, subtask-assignee transitions, parent-assignee completion confirmation, stale versions, and sanitized failure audits.

- [ ] **Step 3: Run command tests and verify failure**

Run: `pnpm vitest run src/features/tasks/server/task-commands.test.ts src/features/subtasks/server/subtask-commands.test.ts`

Expected: FAIL because the new command factories and actions are absent.

- [ ] **Step 4: Implement actor-aware command factories**

Resolve the actor once per request through the existing audited resolver. Put permission checks in command/domain services, not React. Retain the existing human-only direct `completeTask` command for compatibility and make `confirmTaskCompletion` human-only in this phase.

- [ ] **Step 5: Run command and audit tests**

Run: `pnpm vitest run src/features/tasks/server/task-commands.test.ts src/features/subtasks/server/subtask-commands.test.ts src/features/audit/data/sqlite-audit-repository.test.ts src/features/audit/server/audited-actor-resolver.test.ts`

Expected: PASS; public errors expose no audit metadata.

- [ ] **Step 6: Commit command boundaries**

```bash
git add src/features/audit/domain/audit-entry.ts src/features/tasks/server/task-commands.ts src/features/tasks/server/task-commands.test.ts src/features/tasks/server/task-mutation-commands.ts src/features/subtasks/server
git commit -m "feat: add audited task card and subtask commands"
```

---

### Task 6: Add validated server actions and the complete task detail UI

**Files:**
- Modify: `src/features/tasks/server/actions.ts`
- Create: `src/features/subtasks/server/actions.ts`
- Modify: `src/app/tasks/[id]/page.tsx`
- Create: `src/app/tasks/[id]/task-card-details.tsx`
- Create: `src/app/tasks/[id]/subtask-list.tsx`
- Create: `src/app/tasks/[id]/subtask-list.test.tsx`
- Modify: `src/features/tasks/components/task-card.tsx`
- Modify: `src/features/tasks/components/task-card.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes task/subtask command factories from Task 5 and detail records from Tasks 3–4.
- Produces server actions that return `{ message?, fieldErrors? }` for inline forms and revalidate `/tasks/[id]`, `/my-work`, and `/task-pool` after success.

- [ ] **Step 1: Read the installed Next.js form/action guidance**

Before editing App Router files, read the relevant local guides under `node_modules/next/dist/docs/` for server actions, `revalidatePath`, `redirect`, async `params`, and form state. Record no code from memory when the installed docs disagree.

- [ ] **Step 2: Write failing component tests**

Cover priority badge and breakdown, every expanded status label, ordered subtasks, progress count, completed collapse, human/AI type marker, and permission-specific buttons.

```tsx
render(<SubtaskList task={task} subtasks={subtasks} actor={mainAssignee} members={members} />);
expect(screen.getByText("완료 1 / 전체 3")).toBeVisible();
expect(screen.getAllByRole("article").map((row) => row.textContent)).toEqual([
  expect.stringContaining("가장 먼저"),
  expect.stringContaining("두 번째"),
  expect.stringContaining("완료된 일"),
]);
```

- [ ] **Step 3: Run component tests and verify failure**

Run: `pnpm vitest run src/features/tasks/components/task-card.test.tsx src/app/tasks/[id]/subtask-list.test.tsx`

Expected: FAIL because components and status labels are absent.

- [ ] **Step 4: Implement validated actions**

Parse form input into explicit strings/numbers, reject invalid versions before command execution, return field errors for title, description, reason, waiting target, and priority adjustment reason, and reuse the current refresh helper. Do not accept actor type or permission flags from form data.

- [ ] **Step 5: Compose the detail page**

Fetch task, current actor, work types, active project members, priority, and ordered subtasks on the server. Render:

1. priority, deadline, expected blocks, status;
2. goal, description, assignee, work type;
3. subtask progress and list;
4. existing prerequisites and completion summary areas;
5. visible task and subtask event feed ordered newest first.

Show only commands permitted for the actor. Preserve the existing draft publish form and direct completion compatibility path.

- [ ] **Step 6: Add responsive styles**

Use existing Pretendard and design tokens. On wide screens, keep priority/status metadata compact and subtasks full-width below. Below the current responsive breakpoint, stack metadata and action buttons without horizontal clipping. The priority badge is small, circular, red, and contains `finalScore`.

- [ ] **Step 7: Run component and action tests**

Run: `pnpm vitest run src/features/tasks/components/task-card.test.tsx src/app/tasks/[id]/subtask-list.test.tsx src/features/tasks/server/http.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the task detail experience**

```bash
git add src/features/tasks/server/actions.ts src/features/subtasks/server/actions.ts src/app/tasks/[id] src/features/tasks/components/task-card.tsx src/features/tasks/components/task-card.test.tsx src/app/globals.css
git commit -m "feat: complete task card and subtask detail UI"
```

---

### Task 7: Verify the complete human task-card workflow

**Files:**
- Create: `tests/e2e/task-card-subtasks-priority.spec.ts`
- Modify: `tests/e2e/global-setup.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes the seeded IDs and all UI/actions from earlier tasks.
- Produces reproducible browser verification and concise operator instructions.

- [ ] **Step 1: Write the failing E2E flow**

Cover these user-visible actions in order:

1. open a seeded in-progress task as the default human;
2. verify priority badge and breakdown;
3. create three subtasks;
4. assign an active human member and verify an AI member can be represented but gains no browser permission automatically;
5. reorder subtasks and reload to prove persistence;
6. move a subtask through `todo → in_progress → completion_requested → completed` using permitted actors;
7. request review on the parent and confirm completion as an authorized human;
8. verify completed parent subtasks are read-only;
9. attempt a stale-version mutation and verify a clear conflict message;
10. verify `/my-work` and `/task-pool` display priority-sorted cards.

- [ ] **Step 2: Run the new E2E test and verify failure**

Run: `pnpm playwright test tests/e2e/task-card-subtasks-priority.spec.ts`

Expected: FAIL at the first unimplemented or incorrectly wired behavior.

- [ ] **Step 3: Fix only integration defects revealed by E2E**

Keep fixes within the files owned by Tasks 1–6. Add a focused unit/integration regression test beside every defect before changing production code.

- [ ] **Step 4: Run the complete verification suite**

Run in this order:

```bash
pnpm test
pnpm lint
pnpm build
pnpm test:e2e
```

Expected: all commands exit 0. Record the exact unit/integration and E2E test counts in the handoff; do not predict counts in advance.

- [ ] **Step 5: Update README verification instructions**

Document the human-default local flow, where priority is displayed, how to create and progress subtasks, and that schedule/milestone screens are the next phase. Do not describe AI automatic execution as available.

- [ ] **Step 6: Commit verification and documentation**

```bash
git add tests/e2e/task-card-subtasks-priority.spec.ts tests/e2e/global-setup.ts README.md
git commit -m "test: verify complete task card workflow"
```

---

## Final Acceptance Checklist

- [ ] Fresh and upgraded SQLite databases preserve existing task data and expose the same final schema.
- [ ] Task cards display persisted description, expanded state, calculated priority, deadline, and expected blocks.
- [ ] Priority adjustment requires permission and a reason, is recalculated atomically, and is fully audited.
- [ ] Subtasks are ordered, one-level children with active same-project assignees and optimistic locking.
- [ ] Subtask and parent transitions enforce the approved ownership and human-first rules.
- [ ] Visible events and internal audit logs stay separate and transactionally consistent.
- [ ] Existing direct human completion remains compatible.
- [ ] The task detail UI completes the create/assign/reorder/progress/review/complete workflow without exposing unauthorized actions.
- [ ] Unit/integration tests, lint, production build, and all Playwright tests pass.
- [ ] No schedule, milestone, recursive subtask, or AI automatic execution behavior has leaked into this implementation.
