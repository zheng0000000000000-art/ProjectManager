ALTER TABLE tasks ADD COLUMN completed_at TEXT;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN completion_summary TEXT;
--> statement-breakpoint
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
--> statement-breakpoint
CREATE INDEX audit_logs_task_created_idx ON audit_logs(task_id, created_at);
--> statement-breakpoint
CREATE INDEX audit_logs_request_idx ON audit_logs(request_id);
--> statement-breakpoint
CREATE INDEX audit_logs_project_created_idx ON audit_logs(project_id, created_at);
