import { z } from "zod";
import { apiErrorResponse, commandResultResponse, invalidJsonResponse } from "@/features/tasks/server/http";
import { getTaskMutationCommands } from "@/features/tasks/server/task-mutation-commands";

const completeBody = z.object({
  expectedVersion: z.number().int().positive(),
  completionSummary: z.string(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = completeBody.safeParse(await request.json());
    if (!parsed.success) return invalidJsonResponse();
    const { id } = await context.params;
    const commands = await getTaskMutationCommands("task.complete", parsed.data.expectedVersion);
    return commandResultResponse(await commands.completeTask({
      taskId: id,
      expectedVersion: parsed.data.expectedVersion,
      completionSummary: parsed.data.completionSummary,
    }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
