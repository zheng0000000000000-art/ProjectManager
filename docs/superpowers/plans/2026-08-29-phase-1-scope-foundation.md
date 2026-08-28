# Phase 1 Scope Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real project, membership, work-type scope, and server-side take eligibility to the loginless task prototype.

**Architecture:** Keep the fixed actor and default project for zero-login use, but represent every Phase 1 relationship in SQLite. Resolve project context in the repository, filter the pool by active scope, and repeat authorization inside the transactional take command so UI filtering cannot bypass the rule.

**Tech Stack:** Next.js 16, TypeScript, SQLite (`better-sqlite3`), Vitest, Testing Library, Playwright

**Spec:** `docs/superpowers/specs/2026-08-29-phase-1-scope-foundation-design.md`

## Global Constraints

- Preserve the existing loginless fixed-user experience.
- Seed data may be temporary, but constraints and command rules must use real persisted relationships.
- Admin membership must not bypass active work scope.
- Cross-project relationships must fail at the database or repository boundary.
- Do not add authentication, project switching, member administration UI, or timeline UI.
- Follow test-first red-green-refactor for each production behavior.

---

### Task 1: Project and scope schema with deterministic seed data

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/client.ts`
- Create: `src/features/scope/domain/scope.ts`
- Create: `src/features/scope/data/scope-repository.ts`
- Create: `src/features/scope/data/sqlite-scope-repository.ts`
- Create: `src/features/scope/data/sqlite-scope-repository.test.ts`
- Create: `drizzle/0001_scope_foundation.sql`

**Interfaces:**
- Produces: `DEFAULT_PROJECT_ID`, `FIXED_USER_ID`, `ProjectRecord`, `ProjectMemberRecord`, `WorkTypeRecord`, `MemberWorkScopeRecord`.
- Produces: `SqliteScopeRepository.listWorkTypes(projectId)`, `grantScope(memberId, workTypeId)`, `revokeScope(memberId, workTypeId)`, and `canTake(userId, taskId)`.

- [ ] **Step 1: Write failing repository tests**

```ts
it("grants and revokes a member work scope", async () => {
  const scope = await repository.grantScope(member.id, workType.id);
  expect(scope.active).toBe(true);
  await repository.revokeScope(member.id, workType.id);
  expect(await repository.canTake(member.userId, task.id)).toBe(false);
});

it("rejects cross-project scope links", async () => {
  expect(() => repository.grantScope(memberA.id, workTypeB.id)).toThrow();
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because the scope repository is absent**

Run: `pnpm vitest run src/features/scope/data/sqlite-scope-repository.test.ts`

- [ ] **Step 3: Add project-aware tables and composite constraints**

Use composite uniqueness and foreign keys so `(project_id, member_id)` and `(project_id, work_type_id)` remain within one project. Add `project_id` to tasks and work types. Keep schema creation compatible with a fresh database and implement a safe local upgrade path for the existing development database.

- [ ] **Step 4: Add idempotent default seed data**

Seed `project-default`, `user-fixed`, membership `member-fixed`, two work types, and active scopes with `INSERT OR IGNORE`/upsert semantics.

- [ ] **Step 5: Implement the scope repository minimally and rerun the focused test**

Run: `pnpm vitest run src/features/scope/data/sqlite-scope-repository.test.ts`

- [ ] **Step 6: Commit the schema slice**

```bash
git add src/db src/features/scope drizzle/0001_scope_foundation.sql
git commit -m "feat: add project work scope foundation"
```

### Task 2: Make tasks project-aware and pool queries scope-aware

**Files:**
- Modify: `src/features/tasks/domain/task.ts`
- Modify: `src/features/tasks/data/task-repository.ts`
- Modify: `src/features/tasks/data/sqlite-task-repository.ts`
- Modify: `src/features/tasks/data/sqlite-task-repository.test.ts`

**Interfaces:**
- Changes: `TaskRecord` includes `projectId: string`.
- Changes: `createDraft(actorId, projectId)` creates a project-owned task.
- Changes: `listPool(actorId)` returns only tasks takeable by the actor's active scope.
- Produces: `listWorkTypes(projectId): Promise<WorkTypeRecord[]>` for the editor.

- [ ] **Step 1: Write failing tests for project ownership, scoped pool visibility, and cross-project work-type rejection**

```ts
expect((await repository.createDraft(userId, projectId)).projectId).toBe(projectId);
expect((await repository.listPool(scopedUserId)).map((task) => task.id)).toContain(scopedTask.id);
expect((await repository.listPool(unscopedUserId)).map((task) => task.id)).not.toContain(scopedTask.id);
expect(() => publishWithForeignWorkType()).toThrow();
```

- [ ] **Step 2: Run the repository tests and confirm the new assertions fail**

Run: `pnpm vitest run src/features/tasks/data/sqlite-task-repository.test.ts`

- [ ] **Step 3: Add project mapping and scope joins**

Map `project_id` in every task read/write. Filter pool rows through project membership and `member_work_scopes.active = 1`, and list only work types belonging to the task project.

- [ ] **Step 4: Rerun repository and domain tests**

Run: `pnpm vitest run src/features/tasks/data/sqlite-task-repository.test.ts src/features/tasks/domain/task-transitions.test.ts`

- [ ] **Step 5: Commit the repository slice**

```bash
git add src/features/tasks
git commit -m "feat: scope tasks to projects and eligible members"
```

### Task 3: Enforce take eligibility inside server commands

**Files:**
- Modify: `src/features/tasks/data/task-repository.ts`
- Modify: `src/features/tasks/data/sqlite-task-repository.ts`
- Modify: `src/features/tasks/server/command-result.ts`
- Modify: `src/features/tasks/server/task-commands.ts`
- Modify: `src/features/tasks/server/task-commands.test.ts`

**Interfaces:**
- Produces: repository error code `SCOPE_REQUIRED` with a Korean user-facing explanation.
- Changes: `runCommand` supports a transaction-local eligibility check before `take` mutates the task.

- [ ] **Step 1: Write failing command tests**

```ts
it("rejects take without active scope even for an admin", async () => {
  const result = await commands.takeTask({ taskId, expectedVersion: 1 });
  expect(result).toMatchObject({ ok: false, code: "SCOPE_REQUIRED" });
});

it("allows take with active scope", async () => {
  const result = await commands.takeTask({ taskId, expectedVersion: 1 });
  expect(result.ok).toBe(true);
});
```

- [ ] **Step 2: Run the command tests and confirm expected failures**

Run: `pnpm vitest run src/features/tasks/server/task-commands.test.ts`

- [ ] **Step 3: Implement transaction-local authorization**

Check project membership and active scope using the actor, task project, and task work type inside the same SQLite transaction that performs the versioned update. Do not inspect `is_admin` when deciding eligibility.

- [ ] **Step 4: Verify allowed, denied, revoked, admin, and version-conflict cases**

Run: `pnpm vitest run src/features/tasks/server/task-commands.test.ts`

- [ ] **Step 5: Commit the command slice**

```bash
git add src/features/tasks
git commit -m "feat: enforce work scope when taking tasks"
```

### Task 4: Connect the existing UI to persisted work types

**Files:**
- Modify: `src/app/tasks/[id]/page.tsx`
- Modify: `src/app/tasks/[id]/edit-task-form.tsx`
- Modify: `src/app/task-pool/page.tsx`
- Modify: `src/app/my-work/page.tsx`
- Modify: `src/features/tasks/server/actions.ts`
- Modify: relevant component/page tests under `src/`

**Interfaces:**
- Consumes: task project ID and `listWorkTypes(projectId)`.
- Preserves: existing labels, layout, publish feedback, and navigation.

- [ ] **Step 1: Write a failing UI test proving work-type options come from persisted project data**

```tsx
expect(screen.getByRole("option", { name: "기획" })).toBeInTheDocument();
expect(screen.getByRole("option", { name: "개발" })).toBeInTheDocument();
```

- [ ] **Step 2: Run the focused UI test and confirm the options are not supplied by the repository**

Run: `pnpm vitest run src/features/tasks/components/task-card.test.tsx src/components/app-shell.test.tsx`

- [ ] **Step 3: Load project work types and preserve server error feedback**

Replace hard-coded options with repository results, pass the selected value through publish, and keep scope rejection visible on the pool page.

- [ ] **Step 4: Run all unit tests**

Run: `pnpm test`

- [ ] **Step 5: Commit the UI slice**

```bash
git add src/app src/features/tasks src/components
git commit -m "feat: connect task editor to project work types"
```

### Task 5: Prove the Phase 1 gate end to end

**Files:**
- Modify: `tests/e2e/core-task-flow.spec.ts`
- Modify: `tests/e2e/global-setup.ts`
- Modify: `README.md`

**Interfaces:**
- Proves: seeded loginless draft → publish → scoped pool → take → My Work → start.
- Documents: local startup and deterministic seed behavior.

- [ ] **Step 1: Add a failing browser assertion for persisted work types and scoped pool visibility**

```ts
await expect(page.getByLabel("작업 종류")).toContainText("개발");
await expect(page.getByRole("heading", { name: taskTitle })).toBeVisible();
```

- [ ] **Step 2: Run the focused browser test and confirm failure before final wiring**

Run: `pnpm playwright test tests/e2e/core-task-flow.spec.ts`

- [ ] **Step 3: Complete seed/reset wiring and update local instructions**

Ensure the test database starts from a deterministic Phase 1 seed and document that no login or manual setup is required.

- [ ] **Step 4: Run the full verification gate**

Run: `pnpm test`

Run: `pnpm lint`

Run: `pnpm build`

Run: `pnpm playwright test`

- [ ] **Step 5: Commit the gate evidence**

```bash
git add tests README.md
git commit -m "test: verify phase 1 scope foundation"
```

### Task 6: Record and publish the completed major feature

**Files:**
- Create: `docs/development/phase-1-scope-foundation-retrospective.md`
- Copy verified project into: `C:/Users/1/Documents/새 프로젝트/ProjectManager`

**Interfaces:**
- Produces: one concise record with symptom/problem, root cause, resolution, verification, and reusable lesson.
- Publishes: one major-feature checkpoint to `zheng0000000000000-art/ProjectManager` only after Task 5 is green.

- [ ] **Step 1: Write the local retrospective from actual implementation evidence**

Use these headings: `기능`, `발생한 문제`, `원인`, `해결 방법`, `검증 결과`, `다음 단계에서 재사용할 기준`. Include only problems actually encountered.

- [ ] **Step 2: Create or update the Google Drive development record**

Place the record under the supplied project Drive folder, using a dedicated development-record document or folder. Verify the created/updated file by readback and retain its observed URL.

- [ ] **Step 3: Synchronize the verified source to the user's GitHub working repository**

Exclude `.git`, `.next`, `node_modules`, runtime SQLite data, and test artifacts. Preserve the destination `.git` directory and verify the resulting diff before committing.

- [ ] **Step 4: Commit and push one Phase 1 checkpoint**

```bash
git add .
git commit -m "feat: complete phase 1 scope foundation"
git push origin main
```

- [ ] **Step 5: Verify GitHub and Drive results**

Confirm the remote commit SHA, clean working tree, Drive file title, Drive parent folder, and readable content before reporting completion.
