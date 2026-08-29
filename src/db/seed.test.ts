import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { seedDefaultProject } from "./seed";

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe("seedDefaultProject", () => {
  it("creates one reusable loginless project context when run repeatedly", () => {
    const database = new Database(":memory:");
    databases.push(database);
    createSchema(database);

    seedDefaultProject(database);
    seedDefaultProject(database);

    expect(database.prepare("SELECT COUNT(*) count FROM projects").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT id, actor_type FROM users ORDER BY id").all()).toEqual([
      { id: "user-codex", actor_type: "ai" },
      { id: "user-fixed", actor_type: "human" },
    ]);
    expect(database.prepare("SELECT COUNT(*) count FROM project_members WHERE active = 1").get()).toEqual({ count: 2 });
    expect(database.prepare("SELECT COUNT(*) count FROM work_types").get()).toEqual({ count: 3 });
    expect(database.prepare("SELECT COUNT(*) count FROM member_work_scopes WHERE active = 1").get()).toEqual({ count: 6 });
    expect(database.prepare("PRAGMA table_info(tasks)").all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "started_at" }),
        expect.objectContaining({ name: "completed_at" }),
        expect.objectContaining({ name: "completion_summary" }),
      ]),
    );
    expect(database.prepare("PRAGMA table_info(audit_logs)").all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id" }),
        expect.objectContaining({ name: "project_id" }),
        expect.objectContaining({ name: "task_id" }),
        expect.objectContaining({ name: "actor_id" }),
        expect.objectContaining({ name: "action" }),
        expect.objectContaining({ name: "outcome" }),
        expect.objectContaining({ name: "error_code" }),
        expect.objectContaining({ name: "from_state" }),
        expect.objectContaining({ name: "to_state" }),
        expect.objectContaining({ name: "request_id" }),
        expect.objectContaining({ name: "metadata_json" }),
        expect.objectContaining({ name: "created_at" }),
      ]),
    );
  });

  it("rejects a task that lists itself as a prerequisite", () => {
    const database = new Database(":memory:");
    databases.push(database);
    createSchema(database);
    seedDefaultProject(database);
    database.prepare(`INSERT INTO tasks
      (id, project_id, creator_id, publication_state, work_status, version, created_at, updated_at)
      VALUES ('task-self', 'project-default', 'user-fixed', 'draft', 'open', 1, 'now', 'now')`).run();

    expect(() => database.prepare(`INSERT INTO task_prerequisites
      (task_id, prerequisite_task_id, resolved_at) VALUES ('task-self', 'task-self', NULL)`).run())
      .toThrow();
  });
});
