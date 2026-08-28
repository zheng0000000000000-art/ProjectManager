# Phase 1 Scope Foundation Design

## Objective

Implement the Phase 1 milestone in the existing loginless prototype so its
project, membership, work-type scope, and task-take rules operate against real
SQLite data. Seeded records may be temporary; the relationships and server-side
rules must be production-shaped and testable.

## Scope

Phase 1 adds four working concepts around the existing task flow:

- `Project`: the boundary containing members, work types, and tasks.
- `ProjectMember`: a user participating in one project, with an admin flag that
  does not grant task-taking scope.
- `WorkType`: a type of work owned by one project.
- `MemberWorkScope`: an active or revoked grant allowing one project member to
  take tasks of one work type in the same project.

The existing fixed loginless user remains the current actor. Application
startup seeds one default project, a membership for that user, initial work
types, and active scopes so the prototype is usable without setup screens.

## Data Model

Add `projects`, `project_members`, and `member_work_scopes`. Extend
`work_types` and `tasks` with `project_id`; tasks continue to reference
`work_type_id`.

Database constraints enforce:

- membership uniqueness by project and user;
- work-type ownership by project;
- scope uniqueness by member and work type;
- tasks referencing a work type from the same project;
- scopes connecting a member and work type from the same project.

Composite keys or equivalent foreign-key constraints must prevent cross-project
links rather than relying only on UI filtering.

## Runtime Flow

The default project context is resolved server-side. Creating a draft assigns
that project. The edit screen lists work types belonging to the task project.
Publishing preserves the selected work type.

The task pool query returns only ready tasks whose project contains the current
user as a member and whose work type has an active scope for that membership.
The take command repeats the same checks inside the command transaction before
assigning the task. A missing membership, inactive or absent scope, mismatched
project, or mismatched work type returns a clear authorization/domain error.

Admin membership never bypasses the active-scope requirement.

## Temporary Seed Data

Startup idempotently creates:

- one default project;
- the existing fixed user;
- an admin project membership for that user;
- at least two project work types;
- active scopes connecting the member to those work types.

The seed path is deterministic and safe on an existing development database.
It is infrastructure for exercising the feature, not a substitute for the
constraints or command checks.

## UI

The current mockup structure stays intact. The new-task editor uses real
project work types instead of hard-coded options. Pool and My Work cards may
show the work-type name; no project administration or login UI is added in this
phase.

## Errors

Scope rejection is returned as a specific command result and shown on the task
pool page. Storage errors retain the existing generic fallback. Version
conflicts and state-transition errors remain unchanged.

## Verification

Automated tests must prove:

1. a project can be connected to a member and work types;
2. scope can be granted and revoked;
3. a task references a work type in its project;
4. an active scope permits take;
5. missing or revoked scope rejects take on the server;
6. admin status does not bypass the scope rule;
7. cross-project task, work-type, member, and scope links are rejected;
8. seeded data keeps the loginless create-to-start flow operational;
9. existing version and state-transition behavior still passes.

Unit/repository tests cover invariants and command behavior. Browser tests cover
the seeded loginless flow through draft, publish, pool, take, My Work, and start.

## Deferred Work

Member management UI, authentication, project switching, proposal intake,
timeline views, dependency handling, and operational notifications remain in
later phases.
