CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE project_members (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  is_admin INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(project_id, user_id),
  UNIQUE(project_id, id)
);
--> statement-breakpoint
ALTER TABLE work_types ADD COLUMN project_id TEXT REFERENCES projects(id);
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id);
--> statement-breakpoint
CREATE TABLE member_work_scopes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  member_id TEXT NOT NULL,
  work_type_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(member_id, work_type_id),
  FOREIGN KEY(project_id, member_id) REFERENCES project_members(project_id, id),
  FOREIGN KEY(project_id, work_type_id) REFERENCES work_types(project_id, id)
);
