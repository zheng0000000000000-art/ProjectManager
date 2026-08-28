import { redirect } from "next/navigation";
import { getTaskRepository } from "@/db/client";
import { createTaskCommands } from "@/features/tasks/server/task-commands";

export const dynamic = "force-dynamic";

export default async function NewTaskPage() {
  const result = await createTaskCommands(getTaskRepository()).createDraft();
  if (!result.ok) redirect(`/my-work?error=${encodeURIComponent(result.message)}`);
  redirect(`/tasks/${result.data.taskId}`);
}
