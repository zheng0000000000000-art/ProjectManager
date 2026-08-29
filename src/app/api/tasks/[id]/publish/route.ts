import { apiErrorResponse, commandResultResponse, invalidJsonResponse } from "@/features/tasks/server/http";
import { getTaskMutationRequest } from "@/features/tasks/server/task-mutation-commands";
import {
  parseTaskMutationJson,
  publishTaskBodySchema,
} from "@/features/tasks/server/task-request-validation";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const mutation = await getTaskMutationRequest("task.publish");
    const { id } = await context.params;
    const parsed = await parseTaskMutationJson(request, publishTaskBodySchema, "task.publish");
    if (!parsed.ok) {
      await mutation.recordValidationFailure({
        taskId: id,
        expectedVersion: parsed.expectedVersion,
        fieldNames: parsed.fieldNames,
      });
      return invalidJsonResponse();
    }
    const commands = await mutation.getCommands(parsed.data.expectedVersion);
    const result = await commands.publishTask({
      taskId: id,
      ...parsed.data,
      deadline: parsed.data.deadline ?? null,
    });
    return commandResultResponse(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
