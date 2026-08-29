import Database from "better-sqlite3";
import { SqliteTaskRepository } from "./sqlite-task-repository";
import { take } from "../domain/task-transitions";
import type { ActorContext } from "@/features/actors/domain/actor";

type WorkerInput = {
  filename: string;
  taskId: string;
  expectedVersion: number;
  actor: ActorContext;
  requestId: string;
};

async function takeTaskInWorker(input: WorkerInput) {
  const database = new Database(input.filename);
  database.pragma("busy_timeout = 5000");
  try {
    const repository = new SqliteTaskRepository(database);
    const task = await repository.runCommand(input.taskId, input.expectedVersion, {
      projectId: input.actor.projectId,
      taskId: input.taskId,
      actorId: input.actor.userId,
      action: "task.take",
      errorCode: null,
      requestId: input.requestId,
      metadata: { expectedVersion: input.expectedVersion, actorType: input.actor.actorType },
      createdAt: "2026-08-29T12:00:00.000Z",
    }, ({ task: current, appendEvent, requireTakeEligibility }) => {
      requireTakeEligibility(input.actor);
      const next = take(current, input.actor.userId);
      appendEvent({
        eventType: "taken",
        actorId: input.actor.userId,
        fromState: current.workStatus,
        toState: next.workStatus,
        createdAt: "2026-08-29T12:00:00.000Z",
      });
      return next;
    });
    return { ok: true, data: { taskId: task.id } };
  } catch (error) {
    return {
      ok: false,
      code: typeof error === "object" && error !== null && "code" in error ? error.code : "STORAGE_ERROR",
    };
  } finally {
    database.close();
  }
}

const [filename, taskId, expectedVersion, serializedActor, requestId] = process.argv.slice(2);
takeTaskInWorker({
  filename,
  taskId,
  expectedVersion: Number(expectedVersion),
  actor: JSON.parse(serializedActor) as ActorContext,
  requestId,
}).then((result) => process.stdout.write(JSON.stringify(result)));
