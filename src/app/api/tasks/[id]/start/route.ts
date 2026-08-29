import { apiErrorResponse, commandResultResponse, invalidJsonResponse } from "@/features/tasks/server/http";
import { getTaskMutationRequest } from "@/features/tasks/server/task-mutation-commands";
import {
  parseTaskMutationJson,
  versionedTaskBodySchema,
} from "@/features/tasks/server/task-request-validation";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const mutation = await getTaskMutationRequest("task.start");
    const { id } = await context.params;
    const parsed = await parseTaskMutationJson(request, versionedTaskBodySchema, "task.start");
    if (!parsed.ok) {
      await mutation.recordValidationFailure({
        taskId: id,
        expectedVersion: parsed.expectedVersion,
        fieldNames: parsed.fieldNames,
      });
      return invalidJsonResponse();
    }
    const commands = await mutation.getCommands(parsed.data.expectedVersion);
    return commandResultResponse(await commands.startTask({
      taskId: id,
      expectedVersion: parsed.data.expectedVersion,
    }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
