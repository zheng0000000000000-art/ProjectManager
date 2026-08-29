import { getTaskRepository } from "@/db/client";
import { getCurrentActor } from "@/features/actors/server/current-actor";
import { createTaskCommands } from "@/features/tasks/server/task-commands";
import { apiErrorResponse, commandResultResponse } from "@/features/tasks/server/http";

export async function POST() {
  try {
    const actor = await getCurrentActor();
    const result = await createTaskCommands(getTaskRepository(), actor).createDraft();
    return commandResultResponse(result, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
