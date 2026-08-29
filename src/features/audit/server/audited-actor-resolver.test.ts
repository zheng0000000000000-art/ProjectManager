import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSchema } from "@/db/schema";
import { seedDefaultProject } from "@/db/seed";
import { SqliteActorRepository } from "@/features/actors/data/sqlite-actor-repository";
import { createActorResolver } from "@/features/actors/server/actor-resolver";
import { SqliteAuditRepository } from "../data/sqlite-audit-repository";
import { AuditedActorResolver } from "./audited-actor-resolver";

const databases: Database.Database[] = [];
const createdAt = "2026-08-29T15:00:00.000Z";

function setup(requestId: string) {
  const database = new Database(":memory:");
  databases.push(database);
  createSchema(database);
  seedDefaultProject(database);
  const audits = new SqliteAuditRepository(database);
  const resolver = new AuditedActorResolver(
    createActorResolver(new SqliteActorRepository(database)),
    audits,
    { requestId, clock: () => createdAt },
  );
  return { database, audits, resolver };
}

afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach((database) => database.close());
});

describe("AuditedActorResolver", () => {
  it("returns an allowed mutation actor without writing a separate audit", async () => {
    const { audits, resolver } = setup("request-allowed-actor");

    await expect(resolver.resolveActorForMutation({
      action: "task.take",
      expectedVersion: 2,
      headerActorId: "user-codex",
      cookieActorId: "user-fixed",
    })).resolves.toEqual({
      userId: "user-codex",
      projectId: "project-default",
      actorType: "ai",
    });
    expect(audits.listByRequestIdForTest("request-allowed-actor")).toEqual([]);
  });

  it("audits a rejected mutation actor without persisting the untrusted ID", async () => {
    const { database, audits, resolver } = setup("request-rejected-actor");

    await expect(resolver.resolveActorForMutation({
      action: "task.complete",
      expectedVersion: 4,
      headerActorId: "untrusted-user-id",
    })).rejects.toMatchObject({ code: "ACTOR_NOT_ALLOWED" });

    expect(audits.listByRequestIdForTest("request-rejected-actor")).toEqual([{
      projectId: "project-default",
      taskId: null,
      actorId: null,
      action: "task.complete",
      outcome: "failure",
      errorCode: "ACTOR_REJECTED",
      fromState: null,
      toState: null,
      requestId: "request-rejected-actor",
      metadata: { expectedVersion: 4 },
      createdAt,
    }]);
    expect(database.prepare(`SELECT metadata_json FROM audit_logs
      WHERE request_id = ?`).get("request-rejected-actor")).toEqual({
      metadata_json: JSON.stringify({ expectedVersion: 4 }),
    });
    expect(JSON.stringify(audits.listByRequestIdForTest("request-rejected-actor")))
      .not.toContain("untrusted-user-id");
  });

  it("recognizes structurally equivalent actor errors from another bundle", async () => {
    const { audits } = setup("request-structural-actor");
    const resolver = new AuditedActorResolver(
      async () => {
        throw { name: "ActorResolutionError", code: "ACTOR_NOT_ALLOWED", message: "허용되지 않은 작업자" };
      },
      audits,
      { requestId: "request-structural-actor", clock: () => createdAt },
    );

    await expect(resolver.resolveActorForMutation({
      action: "task.start",
      expectedVersion: 3,
      headerActorId: "untrusted-user-id",
    })).rejects.toMatchObject({ code: "ACTOR_NOT_ALLOWED" });
    expect(audits.listByRequestIdForTest("request-structural-actor")).toEqual([
      expect.objectContaining({ errorCode: "ACTOR_REJECTED", actorId: null }),
    ]);
  });

  it("preserves the actor rejection when its failure audit cannot be stored", async () => {
    const { database, audits } = setup("request-actor-audit-storage");
    database.exec(`CREATE TRIGGER reject_failure_audit BEFORE INSERT ON audit_logs
      WHEN NEW.outcome = 'failure' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const resolver = new AuditedActorResolver(
      createActorResolver(new SqliteActorRepository(database)),
      audits,
      { requestId: "request-actor-audit-storage", clock: () => createdAt },
    );

    await expect(resolver.resolveActorForMutation({
      action: "task.take",
      expectedVersion: 2,
      headerActorId: "untrusted-user-id",
    })).rejects.toMatchObject({ code: "ACTOR_NOT_ALLOWED" });
    expect(consoleError).toHaveBeenCalledWith("Audit persistence failed", expect.any(Error));
    expect(audits.listByRequestIdForTest("request-actor-audit-storage")).toEqual([]);
  });
});
