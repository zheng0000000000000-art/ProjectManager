import { apiErrorResponse, commandResultResponse, invalidJsonResponse } from "@/features/tasks/server/http";
import { getTaskMutationRequest } from "@/features/tasks/server/task-mutation-commands";
import {
  completeTaskBodySchema,
  parseTaskMutationJson,
} from "@/features/tasks/server/task-request-validation";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const mutation = await getTaskMutationRequest("task.complete");
    const { id } = await context.params;
    const parsed = await parseTaskMutationJson(request, completeTaskBodySchema, "task.complete");
    if (!parsed.ok) {
      await mutation.recordValidationFailure({
        taskId: id,
        expectedVersion: parsed.expectedVersion,
        fieldNames: parsed.fieldNames,
      });
      return invalidJsonResponse();
    }
    const commands = await mutation.getCommands(parsed.data.expectedVersion);
    return commandResultResponse(await commands.completeTask({
      taskId: id,
      expectedVersion: parsed.data.expectedVersion,
      completionSummary: parsed.data.completionSummary,
    }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
