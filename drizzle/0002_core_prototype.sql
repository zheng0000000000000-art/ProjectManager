ALTER TABLE users ADD COLUMN actor_type TEXT NOT NULL DEFAULT 'human' CHECK(actor_type IN ('human', 'ai'));
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN started_at TEXT;
--> statement-breakpoint
CREATE TABLE task_prerequisites (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  prerequisite_task_id TEXT NOT NULL REFERENCES tasks(id),
  resolved_at TEXT,
  PRIMARY KEY(task_id, prerequisite_task_id),
  CHECK(task_id <> prerequisite_task_id)
);
