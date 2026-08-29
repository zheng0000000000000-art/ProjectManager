import { z } from "zod";
import { getTaskRepository } from "@/db/client";
import { getCurrentActor } from "@/features/actors/server/current-actor";
import { createTaskCommands } from "@/features/tasks/server/task-commands";
import { apiErrorResponse, commandResultResponse, invalidJsonResponse } from "@/features/tasks/server/http";

const publishBody = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string(),
  goal: z.string(),
  workTypeId: z.string(),
  estimatedBlocks: z.number().int(),
  deadline: z.string().nullable().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = publishBody.safeParse(await request.json());
    if (!parsed.success) return invalidJsonResponse();
    const actor = await getCurrentActor();
    const { id } = await context.params;
    const result = await createTaskCommands(getTaskRepository(), actor).publishTask({
      taskId: id,
      ...parsed.data,
      deadline: parsed.data.deadline ?? null,
    });
    return commandResultResponse(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
