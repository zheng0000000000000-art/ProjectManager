import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function runSeed(filename: string) {
  const tsxCli = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
  const seedFile = path.resolve(process.cwd(), "scripts/seed.ts");
  const result = spawnSync(process.execPath, [tsxCli, seedFile], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: filename },
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
}

describe("database seed script", () => {
  it("seeds audited tasks once without rewriting them on a second run", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "project-manager-seed-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "seed.db");

    runSeed(filename);

    const database = new Database(filename);
    try {
      const tasksBefore = database.prepare(`SELECT id, title, goal, work_type_id, estimated_blocks,
        publication_state, work_status, version, updated_at FROM tasks ORDER BY title`).all();
      const auditsBefore = database.prepare(`SELECT task_id, action, outcome, error_code, from_state,
        to_state, request_id, metadata_json, created_at FROM audit_logs ORDER BY task_id, action`).all() as {
        task_id: string;
        action: string;
        outcome: string;
        error_code: string | null;
        from_state: string | null;
        to_state: string;
        request_id: string;
        metadata_json: string;
        created_at: string;
      }[];

      expect(tasksBefore).toHaveLength(3);
      expect(database.prepare("SELECT COUNT(*) count FROM task_events").get()).toEqual({ count: 6 });
      expect(auditsBefore).toHaveLength(6);
      expect(new Set(auditsBefore.map((audit) => audit.request_id)).size).toBe(6);
      expect(auditsBefore.filter((audit) => audit.action === "task.create")).toHaveLength(3);
      expect(auditsBefore.filter((audit) => audit.action === "task.publish")).toHaveLength(3);
      expect(auditsBefore.every((audit) => audit.outcome === "success" && audit.error_code === null)).toBe(true);
      expect(auditsBefore.filter((audit) => audit.action === "task.create").every((audit) =>
        audit.from_state === null
        && audit.to_state === "draft"
        && audit.metadata_json === JSON.stringify({ actorType: "human" }))).toBe(true);
      expect(auditsBefore.filter((audit) => audit.action === "task.publish").every((audit) =>
        audit.from_state === "open"
        && audit.to_state === "open"
        && audit.metadata_json === JSON.stringify({
          expectedVersion: 1,
          fieldNames: ["title", "goal", "workTypeId", "estimatedBlocks", "deadline"],
          actorType: "human",
        }))).toBe(true);
      expect(auditsBefore.every((audit) => audit.created_at.length > 0)).toBe(true);
      expect(database.prepare(`SELECT COUNT(*) count FROM (
        SELECT task_id FROM audit_logs GROUP BY task_id HAVING COUNT(*) = 2
      )`).get()).toEqual({ count: 3 });

      runSeed(filename);

      expect(database.prepare(`SELECT id, title, goal, work_type_id, estimated_blocks,
        publication_state, work_status, version, updated_at FROM tasks ORDER BY title`).all()).toEqual(tasksBefore);
      expect(database.prepare(`SELECT task_id, action, outcome, error_code, from_state,
        to_state, request_id, metadata_json, created_at FROM audit_logs ORDER BY task_id, action`).all()).toEqual(auditsBefore);
      expect(database.prepare("SELECT COUNT(*) count FROM task_events").get()).toEqual({ count: 6 });
    } finally {
      database.close();
    }
  });
});
