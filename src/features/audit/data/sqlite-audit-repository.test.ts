import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSchema } from "@/db/schema";
import { seedDefaultProject } from "@/db/seed";
import { SqliteAuditRepository } from "./sqlite-audit-repository";

const databases: Database.Database[] = [];

function setup() {
  const database = new Database(":memory:");
  databases.push(database);
  createSchema(database);
  seedDefaultProject(database);
  return { database, repository: new SqliteAuditRepository(database) };
}

afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe("SqliteAuditRepository", () => {
  it("persists a failure audit with null actor and allowlisted metadata", async () => {
    const { repository } = setup();

    await repository.appendFailure({
      projectId: "project-default",
      taskId: null,
      actorId: null,
      action: "task.take",
      outcome: "failure",
      errorCode: "ACTOR_REJECTED",
      fromState: null,
      toState: null,
      requestId: "request-1",
      metadata: { expectedVersion: 2, fieldNames: ["actorId"] },
      createdAt: "2026-08-29T15:00:00.000Z",
    });

    expect(repository.listByRequestIdForTest("request-1")).toEqual([
      expect.objectContaining({
        outcome: "failure",
        actorId: null,
        metadata: { expectedVersion: 2, fieldNames: ["actorId"] },
      }),
    ]);
  });

  it("rejects forbidden metadata before inserting an audit row", async () => {
    const { repository } = setup();

    await expect(repository.appendFailure({
      projectId: "project-default",
      taskId: null,
      actorId: null,
      action: "task.take",
      outcome: "failure",
      errorCode: "ACTOR_REJECTED",
      fromState: null,
      toState: null,
      requestId: "request-forbidden",
      metadata: { requestBody: "sensitive" } as never,
      createdAt: "2026-08-29T15:00:00.000Z",
    })).rejects.toThrow("Unsupported audit metadata key: requestBody");

    expect(repository.listByRequestIdForTest("request-forbidden")).toEqual([]);
  });

  it("rejects non-failure outcomes", async () => {
    const { repository } = setup();

    await expect(repository.appendFailure({
      projectId: "project-default",
      taskId: null,
      actorId: null,
      action: "task.take",
      outcome: "success",
      errorCode: null,
      fromState: null,
      toState: null,
      requestId: "request-success",
      metadata: {},
      createdAt: "2026-08-29T15:00:00.000Z",
    })).rejects.toThrow("Audit repository only appends failures");
  });

  it("rejects non-finite versions and non-string field names", async () => {
    const { repository } = setup();
    const input = {
      projectId: "project-default",
      taskId: null,
      actorId: null,
      action: "task.take" as const,
      outcome: "failure" as const,
      errorCode: "ACTOR_REJECTED",
      fromState: null,
      toState: null,
      createdAt: "2026-08-29T15:00:00.000Z",
    };

    await expect(repository.appendFailure({
      ...input,
      requestId: "request-non-finite",
      metadata: { expectedVersion: Number.NaN },
    })).rejects.toThrow("Audit metadata expectedVersion must be a finite number");
    await expect(repository.appendFailure({
      ...input,
      requestId: "request-invalid-fields",
      metadata: { fieldNames: ["actorId", 3] } as never,
    })).rejects.toThrow("Audit metadata fieldNames must be a string array");

    expect(repository.listByRequestIdForTest("request-non-finite")).toEqual([]);
    expect(repository.listByRequestIdForTest("request-invalid-fields")).toEqual([]);
  });

  it("rejects sparse field-name arrays before inserting an audit row", async () => {
    const { repository } = setup();
    const fieldNames = new Array<string>(1);

    await expect(repository.appendFailure({
      projectId: "project-default",
      taskId: null,
      actorId: null,
      action: "task.take",
      outcome: "failure",
      errorCode: "ACTOR_REJECTED",
      fromState: null,
      toState: null,
      requestId: "request-sparse-fields",
      metadata: { fieldNames },
      createdAt: "2026-08-29T15:00:00.000Z",
    })).rejects.toThrow("Audit metadata fieldNames must be a string array");

    expect(repository.listByRequestIdForTest("request-sparse-fields")).toEqual([]);
  });
});
