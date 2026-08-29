import { apiErrorResponse, commandResultResponse } from "@/features/tasks/server/http";
import { getTaskMutationCommands } from "@/features/tasks/server/task-mutation-commands";

export async function POST() {
  try {
    const result = await (await getTaskMutationCommands("task.create")).createDraft();
    return commandResultResponse(result, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
