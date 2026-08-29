# Phase 3 Human Completion Audit Retrospective

## Outcome

Phase 3 now has browser-level evidence that a human can complete a started task, refresh the detail page, and still see the completed status, Seoul-formatted completion time, and stored result. Read-only SQLite checks observed exactly one successful `task.complete` audit and one completed task event for that flow.

The completion audit is internal. The rendered task detail HTML and public task-pool/my-work JSON contained neither `request_id`, `metadata_json`, nor `requestId`. `task_events` are the task timeline; `audit_logs` are operational and security records and are not the timeline or a user-facing task history.

## Observed Problems and Fixes

### Browser setup retained audit history

- Evidence: the red setup scenario inserted a sentinel audit, ran the original setup, and received `{ count: 1 }` where `{ count: 0 }` was required.
- Cause: setup deleted task and actor tables in place but did not clear `audit_logs`.
- Fix: the `pretest:e2e` execution now recreates `data/browser-test.db`, creates the current Phase 3 schema, and seeds only the existing human and Codex actors and their current project scopes. The configured Playwright setup remains idempotent for the already-created database.
- Prevention: a setup-contract scenario recreates an isolated database and proves stale audit history is absent.

### Recreation initially collided with the running browser server

- Evidence: deleting `browser-test.db` from Playwright's configured setup failed on Windows with `EBUSY` after the server health check had opened SQLite.
- Cause: the package lifecycle loaded the setup file before Playwright, but did not execute its exported function; Playwright then invoked the function after starting the server.
- Fix: direct execution of `global-setup.ts` now performs recreation before the server starts. The later configured setup only initializes the schema and existing seed records without deleting the live file.
- Prevention: file recreation stays in the pre-server lifecycle, and the setup-contract scenario uses an isolated database rather than the server's live database.

### Direct-execution detection was incompatible with Playwright's loader

- Evidence: an `import.meta.url` implementation failed with `ReferenceError: exports is not defined` when Playwright loaded the setup module.
- Cause: the setup module is loaded through a different module transformation than the standalone TypeScript execution.
- Fix: direct execution is identified from the setup script's argument basename, which worked in both observed execution paths.
- Prevention: the focused Phase 3 command exercises both the standalone setup phase and Playwright's configured setup phase.

## Failure-Audit Evidence

The browser/API scenario made two rejected completion requests against the same running task:

- an all-whitespace human result returned `400 VALIDATION_ERROR` with a `completionSummary` field error;
- a Codex completion returned `403 ACTOR_NOT_ALLOWED`.

The task row and complete ordered event list were identical before and after both requests. SQLite contained two failure audits with distinct request IDs, exactly one audit per request ID, and classified error codes `VALIDATION_ERROR` and `ACTOR_REJECTED`. Their allowlisted metadata contained only expected version, field names, and actor type; the submitted AI result text was absent.

## Final Verification

- Runtime: `node --version` printed `v22.14.0`.
- Focused Phase 3 E2E: 3 passed, 0 failed.
- Unit tests: 15 files and 84 tests passed, 0 failed.
- Lint: exit code 0 with no findings.
- Production build: exit code 0; compilation and TypeScript checks passed.
- Full E2E: 16 passed, 0 failed.

The browser runner emitted repeated `NO_COLOR`/`FORCE_COLOR` environment warnings. They did not change test outcomes and no application error or failed assertion accompanied them.

## Fix Round 1 — Privacy and Persistence Assertion Depth

- Evidence: the initial privacy test scanned response text without proving that the completed target task was in `/api/my-work`, and a completed task could not establish that `/api/task-pool` returned a task. The revised scenario observed the completed target ID in my-work and a separately created open task ID in the pool.
- Fix: every returned task object is now constrained to an explicit allowlist of task-domain keys. Any snake_case, camelCase, renamed, or otherwise additional audit property fails the scenario.
- Evidence: the initial rejected-completion snapshot selected only work status, version, completion time, and summary. The revised scenario snapshots `SELECT *` for the task and full event rows, then proves exact row equality, event identity, and event count after both failures.
- Evidence: the initial completion UI checks used card-wide substring matching. The revised scenario observed an exact `.status` value of `완료`, captured the complete displayed completion-time string, reloaded, and observed the identical string afterward.
- Setup coverage: the setup-contract scenario now launches the actual standalone `global-setup.ts` process against an isolated database selected through `BROWSER_TEST_DATABASE_URL`. Before that path was supported, the red run attempted to unlink the live database and failed with `EBUSY`; after the fix, the isolated sentinel audit was removed.
- Fresh verification for this round used Node `v22.14.0`: focused Phase 3 E2E 3/3, unit tests 84/84 across 15 files, lint exit 0, production build exit 0, and full E2E 16/16.

## Fix Round 2 — Whole-Response Audit Privacy

- Evidence: Fix Round 1 constrained each `data.tasks` object to task-domain keys, but no longer checked the complete response envelope. A sibling or top-level audit field could therefore bypass the object allowlist.
- Fix: both `/api/my-work` and `/api/task-pool` responses are serialized after parsing and checked for the exact quoted property names `request_id`, `metadata_json`, `requestId`, `auditLogs`, and `metadata`. The target-task presence and per-task safe-key allowlists remain in place; no broad `audit` substring check was added.
- Focused evidence used Node `v22.14.0`, explicitly recreated the database, and invoked the Playwright CLI directly with `tests/e2e/phase-3-human-completion-audit.spec.ts`. The runner reported exactly 3 tests and all 3 passed.
- Full E2E verification then reported 16 passed and 0 failed.

## Fix Round 3 — Structural Response Privacy

- Evidence: the whole-response denylist still depended on enumerating audit aliases and did not name `audit_logs`, `audits`, or `auditEntries`.
- Fix: both public task reads now require exactly `ok` and `data` at the response top level, exactly `tasks` inside `data`, and the existing exact safe-key set on every task object. Any future audit container alias at those response levels fails structurally without expanding a denylist.
- The completed target and known open task presence assertions remain unchanged.
- Fresh Node `v22.14.0` verification reported exactly 3/3 tests from the directly invoked Phase 3 file and 16/16 tests from the full E2E suite.
