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
import { createTaskCommands } from "../server/task-commands";
import { SqliteTaskRepository } from "./sqlite-task-repository";

const temporaryDirectories: string[] = [];
const human: ActorContext = { userId: "user-fixed", projectId: DEFAULT_PROJECT_ID, actorType: "human" };
const codex: ActorContext = { userId: "user-codex", projectId: DEFAULT_PROJECT_ID, actorType: "ai" };

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function takeInWorker(filename: string, taskId: string, actor: ActorContext) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const tsxCli = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
    const workerFile = path.resolve(process.cwd(), "src/features/tasks/data/sqlite-task-take-worker.ts");
    execFile(process.execPath, [tsxCli, workerFile, filename, taskId, "2", JSON.stringify(actor)],
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
      const commands = createTaskCommands(new SqliteTaskRepository(database), human);
      const created = await commands.createDraft();
      if (!created.ok) throw new Error("draft failed");
      await commands.publishTask({
        taskId: created.data.taskId, expectedVersion: 1, title: "동시 가져오기",
        goal: "한 작업자만 성공해야 한다", workTypeId: "work-development",
        estimatedBlocks: 1, deadline: null,
      });

      const results = await Promise.all([
        takeInWorker(filename, created.data.taskId, human),
        takeInWorker(filename, created.data.taskId, codex),
      ]);

      expect(results.filter((result) => result.ok), JSON.stringify(results)).toHaveLength(1);
      expect(results.filter((result) => result.code === "VERSION_CONFLICT"), JSON.stringify(results)).toHaveLength(1);
      expect(database.prepare(`SELECT COUNT(*) count FROM task_events
        WHERE task_id = ? AND event_type = 'taken'`).get(created.data.taskId)).toEqual({ count: 1 });
      expect(database.prepare("SELECT assignee_id, version FROM tasks WHERE id = ?").get(created.data.taskId))
        .toMatchObject({ version: 3 });
    } finally {
      database.close();
    }
  }, 15_000);
});
