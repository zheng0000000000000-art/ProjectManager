import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSchema } from "@/db/schema";
import { SqliteScopeRepository } from "./sqlite-scope-repository";

const databases: Database.Database[] = [];

function setup() {
  const database = new Database(":memory:");
  databases.push(database);
  createSchema(database);
  database.prepare("INSERT INTO users (id, name) VALUES ('user-a', 'A'), ('user-b', 'B')").run();
  database.prepare("INSERT INTO projects (id, name) VALUES ('project-a', 'A'), ('project-b', 'B')").run();
  database.prepare(`INSERT INTO project_members (id, project_id, user_id, is_admin, active)
    VALUES ('member-a', 'project-a', 'user-a', 1, 1), ('member-b', 'project-b', 'user-b', 0, 1)`).run();
  database.prepare(`INSERT INTO work_types (id, project_id, name)
    VALUES ('work-a', 'project-a', '개발'), ('work-b', 'project-b', '검수')`).run();
  database.prepare(`INSERT INTO tasks
    (id, project_id, creator_id, title, goal, work_type_id, publication_state, work_status, version, created_at, updated_at)
    VALUES ('task-a', 'project-a', 'user-a', '작업', '목표', 'work-a', 'published', 'open', 1, 'now', 'now')`).run();
  return { database, repository: new SqliteScopeRepository(database) };
}

afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe("SqliteScopeRepository", () => {
  it("grants and revokes the scope that permits taking a task", async () => {
    const { repository } = setup();

    expect(await repository.canTake("user-a", "task-a")).toBe(false);
    expect(await repository.grantScope("member-a", "work-a")).toMatchObject({ active: true });
    expect(await repository.canTake("user-a", "task-a")).toBe(true);

    await repository.revokeScope("member-a", "work-a");
    expect(await repository.canTake("user-a", "task-a")).toBe(false);
  });

  it("does not let admin membership bypass a missing scope", async () => {
    const { repository } = setup();
    expect(await repository.canTake("user-a", "task-a")).toBe(false);
  });

  it("rejects a scope that connects different projects", async () => {
    const { repository } = setup();
    await expect(repository.grantScope("member-a", "work-b")).rejects.toThrow();
  });

  it("lists only work types owned by the requested project", async () => {
    const { repository } = setup();
    expect(await repository.listWorkTypes("project-a")).toEqual([
      { id: "work-a", projectId: "project-a", name: "개발" },
    ]);
  });
});
