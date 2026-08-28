"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTaskRepository } from "@/db/client";
import { createTaskCommands } from "./task-commands";

const commands = () => createTaskCommands(getTaskRepository());
const toNumber = (value: FormDataEntryValue | null) => Number(value ?? 0);
const refresh = () => { revalidatePath("/task-pool"); revalidatePath("/my-work"); };

export async function createDraftAndRedirect() {
  const result = await commands().createDraft();
  if (!result.ok) redirect(`/my-work?error=${encodeURIComponent(result.message)}`);
  redirect(`/tasks/${result.data.taskId}`);
}

export type PublishState = { message?: string; fieldErrors?: Record<string, string[]> };

export async function publishTaskAction(_: PublishState, formData: FormData): Promise<PublishState> {
  const result = await commands().publishTask({
    taskId: String(formData.get("taskId")), expectedVersion: toNumber(formData.get("expectedVersion")),
    title: String(formData.get("title") ?? ""), goal: String(formData.get("goal") ?? ""),
    workTypeId: String(formData.get("workTypeId") ?? ""),
    estimatedBlocks: toNumber(formData.get("estimatedBlocks")),
    deadline: String(formData.get("deadline") ?? "") || null,
  });
  if (!result.ok) return { message: result.message, fieldErrors: result.fieldErrors };
  refresh(); redirect("/task-pool");
}

export async function takeTaskAction(formData: FormData) {
  const result = await commands().takeTask({ taskId: String(formData.get("taskId")), expectedVersion: toNumber(formData.get("expectedVersion")) });
  refresh();
  if (result.ok) redirect("/my-work");
  redirect(`/task-pool?error=${encodeURIComponent(result.message)}`);
}

export async function startTaskAction(formData: FormData) {
  const result = await commands().startTask({ taskId: String(formData.get("taskId")), expectedVersion: toNumber(formData.get("expectedVersion")) });
  refresh();
  if (result.ok) redirect("/my-work");
  redirect(`/my-work?error=${encodeURIComponent(result.message)}`);
}

export async function returnTaskAction(formData: FormData) {
  const result = await commands().returnTask({
    taskId: String(formData.get("taskId")),
    expectedVersion: toNumber(formData.get("expectedVersion")),
  });
  refresh();
  if (result.ok) redirect("/task-pool");
  redirect(`/my-work?error=${encodeURIComponent(result.message)}`);
}
