# Phase 2 Core Prototype Design

## Objective

Complete the smallest real task-worker loop against persistent data:

`draft -> publish -> ready pool -> take -> my work -> start`

The loop must work for both a human worker and a Codex worker through the same
application-command boundary. The loginless prototype remains intentionally
simple, but actor identity, project membership, work scope, readiness,
optimistic concurrency, and event history must be represented as real server
rules rather than UI assumptions.

## Success Criteria

Phase 2 is complete only when automated tests and a browser walkthrough prove:

1. A worker can create a draft, fill every publish requirement, and publish it.
2. A published task appears in the pool only when it is ready.
3. Missing work scope or an unresolved prerequisite prevents take on the server.
4. If two eligible workers try to take the same task from the same version,
   exactly one succeeds.
5. A successfully taken task appears only in the assignee's My Work view.
6. `taken` and `in_progress` remain distinct states.
7. Starting records an actual start timestamp and a `started` event.
8. Every mutating command checks `expectedVersion` and returns a classified
   conflict without leaving partial state or events.
9. Two independent browser contexts can reproduce the competition and the full
   task loop.
10. Human and AI actions are distinguishable in stored actor records and event
    history while using the same command implementation.

## Scope

### Included

- Explicit actor context for human and AI workers.
- Two seeded, active project members with eligible work scopes.
- A loginless local actor selector backed by an HTTP-only cookie.
- Shared application commands used by server actions and HTTP API handlers.
- Minimal read and command API needed for Codex to participate as a worker.
- Ready-pool filtering and transactional eligibility checks.
- Minimal prerequisite persistence and readiness evaluation.
- Actual task start time.
- Optimistic version checks on all mutations.
- Deterministic concurrent-take integration tests.
- Independent-session browser coverage.

### Deferred

- Password login, invitations, OAuth, API tokens, and production identity
  assurance.
- Project switching and member administration UI.
- Dependency editing, dependency removal, cycle detection, dependency graphs,
  and dependency management UI. Those remain Phase 7 work.
- Waiting, on-hold, review, completion, schedules, notifications, and handoff.
- General-purpose public API versioning and third-party integrations.

## Architecture

The application keeps the existing domain, command, repository, and UI layers.
Phase 2 makes actor identity an explicit input at the command boundary:

```text
Browser form / JSON API
        |
        v
validated local actor context
        |
        v
shared task command service
        |
        v
domain rules + transactional repository
        |
        v
SQLite task + event changes
```

Neither a server action nor an API route may implement task transitions
directly. Both resolve a validated `ActorContext`, parse command input, call the
same command service, and map the same classified result.

## Actor Model

### ActorContext

The application command boundary receives:

```ts
type ActorContext = {
  userId: string;
  projectId: string;
  actorType: "human" | "ai";
};
```

`createTaskCommands(repository, actor)` replaces the fixed-user command
factory. The command service uses only this context for creator, assignee,
scope, ownership, and event checks.

The `users` table stores `actor_type` so historical events can distinguish a
human action from an AI action without duplicating the type into every event.
The seed creates one human (`user-fixed`) and one Codex worker (`user-codex`),
each with a project membership and active development scope.

### Loginless Actor Selection

The shell displays a small worker selector. Selecting a worker posts only a
known actor ID. The server accepts it only when the user exists, is active, and
has an active membership in the default project, then stores the selected ID in
an HTTP-only local cookie. Missing or invalid cookies fall back to the seeded
human worker.

This selector is explicitly a prototype session switch, not authentication.
The UI labels the current worker and its type so test and demo sessions are not
ambiguous. Production authentication is deferred, but all downstream commands
already consume a replaceable server-resolved actor context.

### Codex Access

Codex can either use the browser as the AI worker or call the minimal JSON API.
API requests identify one of the locally seeded actors through the same
validated actor resolver used by the selector. Arbitrary user IDs that are not
active project members are rejected. This is local-prototype identity, not a
claim of secure remote authentication.

## Shared Commands and Reads

The command service exposes:

- `createDraft()`
- `publishTask(input)`
- `takeTask({ taskId, expectedVersion })`
- `startTask({ taskId, expectedVersion })`
- `returnTask({ taskId, expectedVersion })`

Return-to-pool remains available only before start and preserves the Phase 1 UI
decision. It follows the same actor, version, transaction, and event rules.

Read operations receive the actor explicitly:

- task-pool reads return only tasks ready and eligible for that actor;
- My Work reads return only tasks assigned to that actor;
- task detail exposes actions only when consistent with current state and actor,
  while the command still repeats every check server-side.

The minimal JSON surface mirrors the core loop and uses the shared services:

- list task pool;
- list current actor's work;
- create a draft;
- publish, take, and start a task.

API success and failure payloads use the existing command-result vocabulary,
with suitable HTTP status mapping. No API route accesses SQLite directly.

## Data Model

### User Changes

Add `actor_type` with allowed values `human | ai`. Existing users migrate to
`human`.

### Task Changes

Add nullable `started_at`. It is null before start and set exactly once when a
task transitions from `taken` to `in_progress`. Starting again is rejected by
the state machine and cannot replace the original timestamp.

### Minimal Prerequisites

Add a small `task_prerequisites` relation:

- `task_id`
- `prerequisite_task_id`
- nullable `resolved_at`
- unique pair constraint
- foreign keys to tasks
- check preventing a task from directly requiring itself

A prerequisite is unresolved while `resolved_at` is null. Phase 2 does not add
the completed workflow or dependency editing UI; repository fixtures create
resolved and unresolved prerequisite records only to prove the readiness
invariant. Seeded demo tasks have no prerequisites and therefore remain usable.
Phase 5 or Phase 7 may later connect `resolved_at` to actual task completion,
but Phase 2 does not pretend that completion behavior already exists.

## Readiness and Eligibility

A task is pool-ready only when all conditions hold:

- publication state is `published`;
- work status is `open`;
- assignee is null;
- publish-required fields remain valid;
- no prerequisite row has `resolved_at IS NULL`.

A task is take-eligible for an actor only when it is pool-ready and:

- the actor is an active member of the task's project;
- the task work type belongs to that project;
- the membership has an active scope for that work type.

The pool query applies these rules for discoverability. The take command repeats
them inside the same transaction as the conditional update. Hiding a task in
the pool is not authorization.

## Command Transactions and Concurrency

Every mutation receives `expectedVersion`. Inside one SQLite transaction it:

1. reads the current task;
2. rejects a version mismatch;
3. validates actor, project, scope, readiness, ownership, and state rules;
4. computes the next domain state;
5. updates the row with `WHERE id = ? AND version = expectedVersion`;
6. requires exactly one changed row;
7. appends one event with the resolved actor ID;
8. commits both changes together.

The successful update increments the version. A zero-row conditional update is
reported as `VERSION_CONFLICT`, even if both requests initially read the same
version. Failed commands append no event.

The concurrent-take test uses two independently opened repository/database
connections against the same temporary SQLite file and a barrier that releases
both attempts from the same task version. The assertion is exact: one success,
one classified conflict or no-longer-open result, one `taken` event, and one
assignee.

## Start Semantics

Start is allowed only when:

- publication state is `published`;
- work status is `taken`;
- the current actor is the assignee;
- `started_at` is null;
- `expectedVersion` matches.

The transaction changes work status to `in_progress`, sets `started_at` from the
same application clock used for the `started` event, increments the version,
and appends that event. Tests compare the stored timestamp and event time at the
appropriate precision.

## UI Behavior

The existing mockup structure remains the visual authority. Phase 2 adds only
the controls and feedback required by the milestone:

- compact current-worker selector in the shell;
- a visible `AI` or `사람` label beside the selected worker;
- pool cards visible only when ready and scoped for that worker;
- My Work cards belonging only to that worker;
- distinct labels and actions for `가져옴` and `진행 중`;
- start timestamp on an in-progress task detail;
- Korean messages for scope, prerequisite, state, and version failures.

Changing worker redirects back to the current safe application location where
possible. Two browser contexts maintain separate cookies, allowing a human and
Codex session to compete without contaminating each other's actor state.

## Error Model

Known failures remain classified command results. Phase 2 requires at least:

- validation failure;
- actor or membership rejection;
- work-scope rejection;
- unresolved-prerequisite rejection;
- ownership rejection;
- invalid state transition;
- version conflict;
- not found;
- generic storage failure.

UI and API adapters may render or serialize these differently, but classification
comes from the shared command boundary. Unexpected database details are logged
server-side and not exposed to the user.

## Verification Strategy

### Domain and Command Tests

- publish validation and state transition;
- take and start ownership/state rules;
- unresolved prerequisite rejection;
- `started_at` set once;
- actor-specific event IDs;
- expected-version rejection for every mutation;
- no event or partial update on failure.

### Repository and Integration Tests

- human and AI memberships/scopes are real rows;
- pool filtering differs by actor scope;
- unresolved prerequisite hides a task and blocks direct take;
- cross-project actor or work type is rejected;
- two database connections produce exactly one successful take;
- the winner alone sees the task in My Work;
- start stores state, timestamp, version, and event atomically.

### API Tests

- JSON reads and commands resolve an allowed actor;
- unknown or inactive actors are rejected;
- API and server-action calls return equivalent command classifications;
- stale `expectedVersion` returns a conflict response.

### Browser Tests

Using two independent browser contexts:

1. the human creates and publishes a task;
2. both human and Codex see it when both have scope;
3. both attempt take from the same version;
4. exactly one wins and only the winner sees it in My Work;
5. the winner starts it and sees `진행 중` plus the start time;
6. refresh preserves actor, assignment, status, and timestamp;
7. a scoped-out actor and a task with an unresolved prerequisite cannot take.

The existing single-worker flow remains as regression coverage.

## Migration and Compatibility

Migrations are additive. Existing development data receives `human` as its
actor type and null start timestamps. Seeds are idempotent and do not overwrite
user-created tasks or scopes. Existing fixed-user sessions continue to resolve
to the human actor when no actor cookie exists.

Tests must run against a fresh migrated database and at least one upgrade-shaped
fixture representing Phase 1 data.

## Completion Evidence

The milestone is not complete merely because the screens exist. Completion
requires:

- the migration and schema constraints;
- passing domain, repository, command, API, and browser tests that cover each
  success criterion;
- a manual loginless walkthrough with human and Codex contexts;
- lint and production build success;
- a Phase 2 problem/solution retrospective in the designated Google Drive
  folder;
- one verified GitHub checkpoint commit pushed to `ProjectManager` after all
  gates pass.
