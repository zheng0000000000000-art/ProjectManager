# Phase 3 Human Completion and Audit Log Design

## Objective

Complete the human task lifecycle through a durable `completed` state and add
an internal audit log that records both successful and failed task commands.
The audit log is background infrastructure: it is not the user-facing timeline
and is not rendered in the normal application UI.

## Success Criteria

Phase 3 is complete only when automated tests and a browser walkthrough prove:

1. The assigned human can complete an `in_progress` task with a required result
   summary.
2. Completion stores the result, the exact completion time, a `completed` task
   event, and one successful audit entry atomically.
3. A failed command never leaves a task mutation, domain event, or success
   audit entry behind.
4. Every supported mutating task command records exactly one audit outcome:
   `success` or `failure`.
5. Validation, actor resolution, scope, prerequisite, ownership, state, not
   found, and version-conflict failures receive safe classified audit records.
6. Audit metadata does not contain cookies, request bodies, stack traces, or
   other sensitive raw request data.
7. Audit data is not exposed in the normal task UI or public JSON routes.
8. Existing task flows and responsive layouts remain valid.

## Scope

### Included

- `completed` task status.
- Immutable `completed_at` and required `completion_summary` task fields.
- Human-only completion control in the task detail screen.
- An internal `audit_logs` table and focused repository interface.
- Success auditing inside the task command transaction.
- Failure auditing after the failed task transaction has rolled back.
- Audit integration for create, publish, take, start, return, and complete.
- Safe request correlation through a generated `request_id`.
- Repository, command, API, and browser coverage.

### Deferred

- User-facing timelines and milestone presentation.
- General progress notes, chat, comments, attachments, and file uploads.
- Blocked and resumed task states.
- Real-time delivery through SSE or WebSockets.
- Audit-log administration, search, export, retention, deletion, and UI.
- AI execution sessions and AI-specific logs.
- Authentication and production identity assurance.

## Separation of Audit Logs and Timelines

`task_events` remain durable domain facts such as published, taken, started,
returned, and completed. They can later become one input to a curated timeline.

`audit_logs` answer an operational question: who attempted which command, when,
and whether it succeeded. They include rejected attempts that must never appear
as user-facing milestones. No normal page or JSON read endpoint returns audit
rows in Phase 3.

This separation prevents security and debugging details from leaking into the
future timeline and lets the timeline evolve without weakening audit coverage.

## Task Model

Extend `WorkStatus` with `completed` and add two nullable task columns:

- `completed_at TEXT`
- `completion_summary TEXT`

Both columns are null until completion. A valid completion sets both exactly
once. `completion_summary` is trimmed and must contain at least one character.
Completion is permitted only when:

- the task is published;
- the task status is `in_progress`;
- the current actor is the assignee;
- `started_at` is already present;
- `completed_at` and `completion_summary` are null;
- `expectedVersion` matches.

The transition changes the status to `completed`, stores the application
clock value in `completed_at`, stores the normalized summary, increments the
version, and appends a `completed` task event using the same timestamp.
Completed tasks are terminal in Phase 3.

Although the shared actor model still represents humans and AI, the completion
command rejects actors whose `actorType` is not `human`. AI completion is a
later integration milestone.

## Audit Data Model

Add `audit_logs` with:

| Column | Type | Rule |
| --- | --- | --- |
| `id` | TEXT | Primary key |
| `project_id` | TEXT | Required project reference |
| `task_id` | TEXT | Nullable task reference |
| `actor_id` | TEXT | Nullable user reference |
| `action` | TEXT | Required stable command name |
| `outcome` | TEXT | `success` or `failure` |
| `error_code` | TEXT | Nullable classified code |
| `from_state` | TEXT | Nullable prior task status |
| `to_state` | TEXT | Nullable resulting task status |
| `request_id` | TEXT | Required correlation identifier |
| `metadata_json` | TEXT | Required JSON object, default `{}` |
| `created_at` | TEXT | Required application timestamp |

Add indexes for `(task_id, created_at)`, `(request_id)`, and
`(project_id, created_at)`. Audit rows are append-only through the application
interface. The schema does not add update or delete audit operations.

Stable Phase 3 action names are:

- `task.create`
- `task.publish`
- `task.take`
- `task.start`
- `task.return`
- `task.complete`

## Safe Metadata

The command layer builds metadata from an allowlist. Permitted Phase 3 keys are:

- `expectedVersion` as a number when the command has one;
- validation `fieldNames` as an array of field names;
- `actorType` as `human` or `ai` when actor resolution succeeded.

The logger never accepts a raw `Request`, headers, cookies, form data, JSON
body, stack trace, database message, completion summary, task title, or task
goal. `metadata_json` must encode an object and defaults to `{}`.

## Command and Transaction Architecture

The existing command service remains the only task-mutation boundary. It
receives a request-scoped audit context containing `requestId` and an
application clock. Server actions and JSON routes call the same command methods
and never write audit rows directly.

Actor resolution runs through an `AuditedActorResolver` application service.
It delegates successful identity checks to the existing actor resolver. When
resolution fails for a mutating request, it writes a standalone failure audit
with a null `actor_id`, the stable intended action, and `ACTOR_REJECTED`. This
keeps actor failures auditable without letting untrusted actor IDs enter a
foreign-key column or duplicating persistence logic in HTTP adapters.

### Successful Commands

For task commands that update an existing task, the SQLite task repository
performs the following in one immediate transaction:

1. Read and validate the current task and expected version.
2. Apply the domain transition.
3. Conditionally update the task.
4. Append exactly one `task_events` row.
5. Append exactly one successful `audit_logs` row.
6. Commit all three records together.

Draft creation inserts the task, its `created` event, and its successful audit
row in one transaction.

### Failed Commands

When validation or a task transaction fails, that transaction rolls back
first. The command service then asks the audit repository to append one failure
row in a separate transaction. The failure row uses the public classified
error code and safe allowlisted metadata.

If task identity or prior state is known, the failure includes `task_id` and
`from_state`. It does not fabricate a `to_state`. If actor resolution fails
before an actor exists, `actor_id` is null and the default project context is
used. An invalid untrusted actor ID is never stored as a foreign key.

If failure-audit persistence itself fails, the original command result remains
unchanged and the server emits an operational error through `console.error`.
The application does not claim that the audit row was stored. Tests cover this
fallback without asserting on raw console content.

## Error Classification

Audit `error_code` uses the existing public command vocabulary where possible:

- `VALIDATION_ERROR`
- `ACTOR_REJECTED`
- `SCOPE_REQUIRED`
- `PREREQUISITE_UNRESOLVED`
- `OWNERSHIP_REQUIRED`
- `INVALID_TRANSITION`
- `VERSION_CONFLICT`
- `NOT_FOUND`
- `STORAGE_ERROR`

The completion transition adds a classified validation failure for an empty
summary and classified actor/state failures for non-human, non-assignee, or
non-running attempts. Internal SQLite messages and stack traces are never
copied into `error_code` or metadata.

## Internal Interfaces

The audit module exposes focused types rather than database rows:

```ts
type AuditOutcome = "success" | "failure";

type AuditEntryInput = {
  projectId: string;
  taskId: string | null;
  actorId: string | null;
  action: "task.create" | "task.publish" | "task.take" |
    "task.start" | "task.return" | "task.complete";
  outcome: AuditOutcome;
  errorCode: string | null;
  fromState: string | null;
  toState: string | null;
  requestId: string;
  metadata: Record<string, string | number | string[]>;
  createdAt: string;
};
```

`AuditRepository.appendFailure(input)` persists a standalone failed outcome.
Test-only repository reads can list entries by task or request ID. Production
application code does not expose general audit reads.

Successful audit inputs are passed into the task repository transaction rather
than written through a separate connection. This is necessary to preserve the
atomic success invariant.

## UI and API Behavior

The task detail page shows a result form only when the selected actor is the
human assignee and the task is `in_progress`. The form contains a required
result summary and a `작업 완료` button.

After completion, the task card shows `완료`, the completion time, and the
stored result summary. No audit list, request ID, error code, metadata, or
timeline is rendered.

Add `POST /api/tasks/[id]/complete` for parity with the shared command boundary.
It accepts `expectedVersion` and `completionSummary`. Existing API routes keep
their response contract. No audit read route is added.

## Migration and Compatibility

The migration is additive. Existing rows receive null completion columns and
retain their existing status. The runtime schema upgrader adds missing columns
for older local databases before any completion command runs.

Existing events remain valid. Existing human and AI actors remain seeded, but
only the human actor can complete in Phase 3. Seeds do not create audit history
for past commands or rewrite user-created data.

## Verification Strategy

### Domain Tests

- human assignee completes an in-progress task;
- result summary is trimmed and required;
- non-assignee, non-human, pre-start, and repeated completion fail;
- completion time and version change exactly once.

### Repository Tests

- completion task update, event, and success audit commit atomically;
- forced event or audit failure rolls back the whole success transaction;
- failure audit append creates one immutable row;
- safe metadata round-trips as an object;
- fresh and upgrade-shaped databases contain the new schema.

### Command Tests

- create, publish, take, start, return, and complete each produce one success
  audit row;
- classified failures produce one failure audit and no success audit;
- failed commands leave task state and task-event count unchanged;
- failure-audit storage errors preserve the original command classification;
- no forbidden raw values appear in serialized metadata.

### API and Browser Tests

- the completion endpoint and server action share command behavior;
- empty summaries return safe validation feedback;
- an AI or non-assignee cannot complete;
- a human completes from the task detail page and refresh preserves status,
  time, and summary;
- normal pages and JSON reads contain no audit-log content;
- existing desktop, mobile, and core-flow tests remain green.

## Completion Evidence

The milestone requires:

- checked-in schema migration and design/implementation documentation;
- passing domain, repository, command, API, and browser tests;
- lint and production build success;
- a Phase 3 problem/solution retrospective in the designated Google Drive
  folder;
- one verified GitHub checkpoint pushed to `ProjectManager` after all gates
  pass.
