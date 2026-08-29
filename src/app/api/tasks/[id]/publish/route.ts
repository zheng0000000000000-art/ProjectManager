import { z } from "zod";
import { apiErrorResponse, commandResultResponse, invalidJsonResponse } from "@/features/tasks/server/http";
import { getTaskMutationCommands } from "@/features/tasks/server/task-mutation-commands";

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
    const { id } = await context.params;
    const result = await (await getTaskMutationCommands("task.publish", parsed.data.expectedVersion)).publishTask({
      taskId: id,
      ...parsed.data,
      deadline: parsed.data.deadline ?? null,
    });
    return commandResultResponse(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
