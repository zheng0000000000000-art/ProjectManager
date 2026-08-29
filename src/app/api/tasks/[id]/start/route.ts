import { z } from "zod";
import { apiErrorResponse, commandResultResponse, invalidJsonResponse } from "@/features/tasks/server/http";
import { getTaskMutationCommands } from "@/features/tasks/server/task-mutation-commands";

const versionedBody = z.object({ expectedVersion: z.number().int().positive() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = versionedBody.safeParse(await request.json());
    if (!parsed.success) return invalidJsonResponse();
    const { id } = await context.params;
    return commandResultResponse(await (await getTaskMutationCommands("task.start", parsed.data.expectedVersion)).startTask({
      taskId: id,
      expectedVersion: parsed.data.expectedVersion,
    }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
