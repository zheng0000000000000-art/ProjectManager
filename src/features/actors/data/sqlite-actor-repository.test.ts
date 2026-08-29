import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSchema } from "@/db/schema";
import { seedDefaultProject } from "@/db/seed";
import { DEFAULT_PROJECT_ID } from "@/features/scope/domain/scope";
import { SqliteActorRepository } from "./sqlite-actor-repository";

const databases: Database.Database[] = [];

function setup() {
  const database = new Database(":memory:");
  databases.push(database);
  createSchema(database);
  seedDefaultProject(database);
  return { database, repository: new SqliteActorRepository(database) };
}

afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe("SqliteActorRepository", () => {
  it("resolves active human and AI project members", async () => {
    const { repository } = setup();

    await expect(repository.findActiveProjectActor("user-fixed", DEFAULT_PROJECT_ID)).resolves.toEqual({
      userId: "user-fixed",
      projectId: DEFAULT_PROJECT_ID,
      actorType: "human",
    });
    await expect(repository.findActiveProjectActor("user-codex", DEFAULT_PROJECT_ID)).resolves.toEqual({
      userId: "user-codex",
      projectId: DEFAULT_PROJECT_ID,
      actorType: "ai",
    });
  });

  it("rejects unknown, inactive, and cross-project actors", async () => {
    const { database, repository } = setup();
    database.prepare("UPDATE project_members SET active = 0 WHERE user_id = 'user-codex'").run();
    database.prepare("INSERT INTO projects (id, name) VALUES ('project-other', '다른 프로젝트')").run();

    await expect(repository.findActiveProjectActor("missing", DEFAULT_PROJECT_ID)).resolves.toBeNull();
    await expect(repository.findActiveProjectActor("user-codex", DEFAULT_PROJECT_ID)).resolves.toBeNull();
    await expect(repository.findActiveProjectActor("user-fixed", "project-other")).resolves.toBeNull();
  });
});
