import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSchema } from "@/db/schema";
import { seedDefaultProject } from "@/db/seed";
import { SqliteActorRepository } from "../data/sqlite-actor-repository";
import { ActorResolutionError, createActorResolver } from "./actor-resolver";

const databases: Database.Database[] = [];

function setup() {
  const database = new Database(":memory:");
  databases.push(database);
  createSchema(database);
  seedDefaultProject(database);
  return createActorResolver(new SqliteActorRepository(database));
}

afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe("actor resolver", () => {
  it("gives an explicit API header precedence over a browser cookie", async () => {
    const resolve = setup();

    await expect(resolve({ headerActorId: "user-codex", cookieActorId: "user-fixed" })).resolves.toEqual({
      userId: "user-codex",
      projectId: "project-default",
      actorType: "ai",
    });
  });

  it("falls back to the human actor for an invalid browser cookie", async () => {
    const resolve = setup();

    await expect(resolve({ cookieActorId: "missing" })).resolves.toMatchObject({
      userId: "user-fixed",
      actorType: "human",
    });
  });

  it("rejects an invalid explicit API actor instead of impersonating the human", async () => {
    const resolve = setup();

    await expect(resolve({ headerActorId: "missing" })).rejects.toEqual(
      new ActorResolutionError("ACTOR_NOT_ALLOWED", "허용된 프로젝트 작업자가 아닙니다."),
    );
  });
});
