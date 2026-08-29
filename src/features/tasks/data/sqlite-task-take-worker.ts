import Database from "better-sqlite3";
import { SqliteTaskRepository } from "./sqlite-task-repository";
import { createTaskCommands } from "../server/task-commands";
import type { ActorContext } from "@/features/actors/domain/actor";

type WorkerInput = {
  filename: string;
  taskId: string;
  expectedVersion: number;
  actor: ActorContext;
};

async function takeTaskInWorker(input: WorkerInput) {
  const database = new Database(input.filename);
  database.pragma("busy_timeout = 5000");
  try {
    const commands = createTaskCommands(new SqliteTaskRepository(database), input.actor);
    return await commands.takeTask({
      taskId: input.taskId,
      expectedVersion: input.expectedVersion,
    });
  } finally {
    database.close();
  }
}

const [filename, taskId, expectedVersion, serializedActor] = process.argv.slice(2);
takeTaskInWorker({
  filename,
  taskId,
  expectedVersion: Number(expectedVersion),
  actor: JSON.parse(serializedActor) as ActorContext,
}).then((result) => process.stdout.write(JSON.stringify(result)));
