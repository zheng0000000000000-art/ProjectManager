import type Database from "better-sqlite3";

export function createSchema(database: Database.Database) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      actor_type TEXT NOT NULL DEFAULT 'human' CHECK(actor_type IN ('human', 'ai'))
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      is_admin INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(project_id, user_id),
      UNIQUE(project_id, id)
    );
    CREATE TABLE IF NOT EXISTS work_types (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      UNIQUE(project_id, id)
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      creator_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL DEFAULT '',
      goal TEXT NOT NULL DEFAULT '',
      work_type_id TEXT REFERENCES work_types(id),
      estimated_blocks INTEGER,
      deadline TEXT,
      publication_state TEXT NOT NULL,
      work_status TEXT NOT NULL,
      assignee_id TEXT REFERENCES users(id),
      started_at TEXT,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id, work_type_id) REFERENCES work_types(project_id, id)
    );
    CREATE TABLE IF NOT EXISTS member_work_scopes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      member_id TEXT NOT NULL,
      work_type_id TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(member_id, work_type_id),
      FOREIGN KEY(project_id, member_id) REFERENCES project_members(project_id, id),
      FOREIGN KEY(project_id, work_type_id) REFERENCES work_types(project_id, id)
    );
    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      event_type TEXT NOT NULL,
      actor_id TEXT NOT NULL REFERENCES users(id),
      from_state TEXT,
      to_state TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_prerequisites (
      task_id TEXT NOT NULL REFERENCES tasks(id),
      prerequisite_task_id TEXT NOT NULL REFERENCES tasks(id),
      resolved_at TEXT,
      PRIMARY KEY(task_id, prerequisite_task_id),
      CHECK(task_id <> prerequisite_task_id)
    );
    CREATE INDEX IF NOT EXISTS tasks_pool_idx
      ON tasks(publication_state, work_status, assignee_id);
    CREATE INDEX IF NOT EXISTS tasks_assignee_idx
      ON tasks(assignee_id, work_status);
    CREATE INDEX IF NOT EXISTS member_scope_lookup_idx
      ON member_work_scopes(member_id, work_type_id, active);
  `);

  // Upgrade databases created by the earlier prototype before project scope existed.
  const columns = (table: string) => new Set(
    (database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name),
  );
  if (!columns("work_types").has("project_id")) {
    database.exec("ALTER TABLE work_types ADD COLUMN project_id TEXT REFERENCES projects(id)");
  }
  if (!columns("tasks").has("project_id")) {
    database.exec("ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id)");
  }
  if (!columns("users").has("actor_type")) {
    database.exec("ALTER TABLE users ADD COLUMN actor_type TEXT NOT NULL DEFAULT 'human' CHECK(actor_type IN ('human', 'ai'))");
  }
  if (!columns("tasks").has("started_at")) {
    database.exec("ALTER TABLE tasks ADD COLUMN started_at TEXT");
  }
  database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS work_types_project_id_idx
    ON work_types(project_id, id)`);
}
