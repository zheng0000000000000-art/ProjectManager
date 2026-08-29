"use client";

import { useActionState } from "react";
import { completeTaskAction, type CompleteState } from "@/features/tasks/server/actions";

export function CompleteTaskForm({ taskId, expectedVersion }: { taskId: string; expectedVersion: number }) {
  const [state, action, pending] = useActionState(completeTaskAction, {} as CompleteState);

  return <form action={action} className="completion-form">
    <input type="hidden" name="taskId" value={taskId} />
    <input type="hidden" name="expectedVersion" value={expectedVersion} />
    <label>
      완료 결과
      <textarea name="completionSummary" rows={5} required />
    </label>
    {state.fieldErrors?.completionSummary?.map((error) => <p role="alert" key={error}>{error}</p>)}
    {state.message && <p className="form-message" role="alert">{state.message}</p>}
    <button type="submit" className="button button--primary" disabled={pending}>
      {pending ? "완료 중…" : "작업 완료"}
    </button>
  </form>;
}
