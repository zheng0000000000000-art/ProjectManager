import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSchema } from "@/db/schema";
import { seedDefaultProject } from "@/db/seed";
import type { ActorContext } from "@/features/actors/domain/actor";
import { DEFAULT_PROJECT_ID } from "@/features/scope/domain/scope";
import { publish } from "../domain/task-transitions";
import { SqliteTaskRepository } from "./sqlite-task-repository";
import type { SuccessAuditInput } from "./task-repository";

const temporaryDirectories: string[] = [];
const human: ActorContext = { userId: "user-fixed", projectId: DEFAULT_PROJECT_ID, actorType: "human" };
const codex: ActorContext = { userId: "user-codex", projectId: DEFAULT_PROJECT_ID, actorType: "ai" };

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function audit(overrides: Partial<SuccessAuditInput> = {}): SuccessAuditInput {
  return {
    projectId: DEFAULT_PROJECT_ID,
    taskId: null,
    actorId: human.userId,
    action: "task.create",
    errorCode: null,
    requestId: crypto.randomUUID(),
    metadata: { actorType: "human" },
    createdAt: "2026-08-29T12:00:00.000Z",
    ...overrides,
  };
}

function takeInWorker(filename: string, taskId: string, actor: ActorContext, requestId: string) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const tsxCli = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
    const workerFile = path.resolve(process.cwd(), "src/features/tasks/data/sqlite-task-take-worker.ts");
    execFile(process.execPath, [tsxCli, workerFile, filename, taskId, "2", JSON.stringify(actor), requestId],
      { cwd: process.cwd() }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve(JSON.parse(stdout) as Record<string, unknown>);
      });
  });
}

describe("concurrent task take", () => {
  it("allows exactly one actor to take the same task version", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "project-manager-take-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "concurrency.db");
    const database = new Database(filename);
    try {
      database.pragma("journal_mode = WAL");
      database.pragma("busy_timeout = 5000");
      createSchema(database);
      seedDefaultProject(database);
      const repository = new SqliteTaskRepository(database);
      const created = await repository.createDraft(human.userId, human.projectId, audit());
      await repository.runCommand(created.id, 1, audit({
        taskId: created.id,
        action: "task.publish",
        metadata: { expectedVersion: 1, actorType: "human" },
      }), ({ task, appendEvent }) => {
        const next = publish(task, {
          title: "동시 가져오기",
          goal: "한 작업자만 성공해야 한다",
          workTypeId: "work-development",
          estimatedBlocks: 1,
          deadline: null,
        });
        appendEvent({
          eventType: "published",
          actorId: human.userId,
          fromState: task.publicationState,
          toState: next.publicationState,
          createdAt: "2026-08-29T12:00:00.000Z",
        });
        return next;
      });

      const humanRequestId = crypto.randomUUID();
      const codexRequestId = crypto.randomUUID();

      const results = await Promise.all([
        takeInWorker(filename, created.id, human, humanRequestId),
        takeInWorker(filename, created.id, codex, codexRequestId),
      ]);

      expect(results.filter((result) => result.ok), JSON.stringify(results)).toHaveLength(1);
      expect(results.filter((result) => result.code === "VERSION_CONFLICT"), JSON.stringify(results)).toHaveLength(1);
      expect(database.prepare(`SELECT COUNT(*) count FROM task_events
        WHERE task_id = ? AND event_type = 'taken'`).get(created.id)).toEqual({ count: 1 });
      expect(database.prepare(`SELECT COUNT(*) count FROM audit_logs
        WHERE task_id = ? AND action = 'task.take' AND outcome = 'success'
          AND request_id IN (?, ?)`).get(created.id, humanRequestId, codexRequestId)).toEqual({ count: 1 });
      expect(database.prepare("SELECT assignee_id, version FROM tasks WHERE id = ?").get(created.id))
        .toMatchObject({ version: 3 });
    } finally {
      database.close();
    }
  }, 15_000);
});
