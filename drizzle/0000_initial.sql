CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS work_types (id TEXT PRIMARY KEY, name TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL DEFAULT '', goal TEXT NOT NULL DEFAULT '',
  work_type_id TEXT REFERENCES work_types(id), estimated_blocks INTEGER, deadline TEXT,
  publication_state TEXT NOT NULL, work_status TEXT NOT NULL,
  assignee_id TEXT REFERENCES users(id), version INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
  event_type TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id),
  from_state TEXT, to_state TEXT NOT NULL, created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tasks_pool_idx ON tasks(publication_state, work_status, assignee_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(assignee_id, work_status);
