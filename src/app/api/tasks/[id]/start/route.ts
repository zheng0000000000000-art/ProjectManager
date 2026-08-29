import { z } from "zod";
import { getTaskRepository } from "@/db/client";
import { getCurrentActor } from "@/features/actors/server/current-actor";
import { createTaskCommands } from "@/features/tasks/server/task-commands";
import { apiErrorResponse, commandResultResponse, invalidJsonResponse } from "@/features/tasks/server/http";

const versionedBody = z.object({ expectedVersion: z.number().int().positive() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = versionedBody.safeParse(await request.json());
    if (!parsed.success) return invalidJsonResponse();
    const actor = await getCurrentActor();
    const { id } = await context.params;
    return commandResultResponse(await createTaskCommands(getTaskRepository(), actor).startTask({
      taskId: id,
      expectedVersion: parsed.data.expectedVersion,
    }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
