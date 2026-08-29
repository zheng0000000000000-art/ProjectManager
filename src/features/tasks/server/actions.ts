"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTaskMutationCommands } from "./task-mutation-commands";

const toNumber = (value: FormDataEntryValue | null) => Number(value ?? 0);
const refresh = (taskId?: string) => {
  revalidatePath("/task-pool");
  revalidatePath("/my-work");
  if (taskId) revalidatePath(`/tasks/${taskId}`);
};

export async function createDraftAndRedirect() {
  const result = await (await getTaskMutationCommands("task.create")).createDraft();
  if (!result.ok) redirect(`/my-work?error=${encodeURIComponent(result.message)}`);
  redirect(`/tasks/${result.data.taskId}`);
}

export type PublishState = { message?: string; fieldErrors?: Record<string, string[]> };

export async function publishTaskAction(_: PublishState, formData: FormData): Promise<PublishState> {
  const taskId = String(formData.get("taskId"));
  const expectedVersion = toNumber(formData.get("expectedVersion"));
  const result = await (await getTaskMutationCommands("task.publish", expectedVersion)).publishTask({
    taskId, expectedVersion,
    title: String(formData.get("title") ?? ""), goal: String(formData.get("goal") ?? ""),
    workTypeId: String(formData.get("workTypeId") ?? ""),
    estimatedBlocks: toNumber(formData.get("estimatedBlocks")),
    deadline: String(formData.get("deadline") ?? "") || null,
  });
  if (!result.ok) return { message: result.message, fieldErrors: result.fieldErrors };
  refresh(); redirect("/task-pool");
}

export async function takeTaskAction(formData: FormData) {
  const expectedVersion = toNumber(formData.get("expectedVersion"));
  const result = await (await getTaskMutationCommands("task.take", expectedVersion)).takeTask({ taskId: String(formData.get("taskId")), expectedVersion });
  refresh();
  if (result.ok) redirect("/my-work");
  redirect(`/task-pool?error=${encodeURIComponent(result.message)}`);
}

export async function startTaskAction(formData: FormData) {
  const expectedVersion = toNumber(formData.get("expectedVersion"));
  const result = await (await getTaskMutationCommands("task.start", expectedVersion)).startTask({ taskId: String(formData.get("taskId")), expectedVersion });
  refresh();
  if (result.ok) redirect("/my-work");
  redirect(`/my-work?error=${encodeURIComponent(result.message)}`);
}

export async function returnTaskAction(formData: FormData) {
  const expectedVersion = toNumber(formData.get("expectedVersion"));
  const result = await (await getTaskMutationCommands("task.return", expectedVersion)).returnTask({
    taskId: String(formData.get("taskId")), expectedVersion,
  });
  refresh();
  if (result.ok) redirect("/task-pool");
  redirect(`/my-work?error=${encodeURIComponent(result.message)}`);
}

export type CompleteState = { message?: string; fieldErrors?: Record<string, string[]> };

export async function completeTaskAction(_: CompleteState, formData: FormData): Promise<CompleteState> {
  const taskId = String(formData.get("taskId"));
  const expectedVersion = toNumber(formData.get("expectedVersion"));
  const result = await (await getTaskMutationCommands("task.complete", expectedVersion)).completeTask({
    taskId,
    expectedVersion,
    completionSummary: String(formData.get("completionSummary") ?? ""),
  });
  if (!result.ok) return { message: result.message, fieldErrors: result.fieldErrors };
  refresh(taskId);
  return {};
}
