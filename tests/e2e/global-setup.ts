import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema";
import { seedDefaultProject } from "../../src/db/seed";

const filename = path.join(process.cwd(), "data", "browser-test.db");

export default function globalSetup() {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const database = new Database(filename);
  try {
    createSchema(database);
    database.exec(`
      PRAGMA foreign_keys = OFF;
      DELETE FROM task_prerequisites;
      DELETE FROM task_events;
      DELETE FROM tasks;
      DELETE FROM member_work_scopes;
      DELETE FROM work_types;
      DELETE FROM project_members;
      DELETE FROM projects;
      DELETE FROM users;
      PRAGMA foreign_keys = ON;
    `);
    seedDefaultProject(database);
  } finally {
    database.close();
  }
}
