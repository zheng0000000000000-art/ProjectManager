import { redirect } from "next/navigation";
import { getTaskMutationCommands } from "@/features/tasks/server/task-mutation-commands";

export const dynamic = "force-dynamic";

export default async function NewTaskPage() {
  const result = await (await getTaskMutationCommands("task.create")).createDraft();
  if (!result.ok) redirect(`/my-work?error=${encodeURIComponent(result.message)}`);
  redirect(`/tasks/${result.data.taskId}`);
}
