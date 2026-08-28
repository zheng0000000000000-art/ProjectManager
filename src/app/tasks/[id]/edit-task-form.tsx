"use client";

import { useActionState } from "react";
import type { TaskRecord } from "@/features/tasks/domain/task";
import { publishTaskAction, type PublishState } from "@/features/tasks/server/actions";

export function EditTaskForm({ task, workTypes }: { task: TaskRecord; workTypes: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(publishTaskAction, {} as PublishState);
  return <form action={action} className="edit-form">
    <input type="hidden" name="taskId" value={task.id} />
    <input type="hidden" name="expectedVersion" value={task.version} />
    <label>작업명<input name="title" defaultValue={task.title} /></label>
    {state.fieldErrors?.title?.map((error) => <p role="alert" key={error}>{error}</p>)}
    <label>목표<textarea name="goal" defaultValue={task.goal} rows={5} /></label>
    {state.fieldErrors?.goal?.map((error) => <p role="alert" key={error}>{error}</p>)}
    <div className="form-grid">
      <div><label>작업 종류<select name="workTypeId" defaultValue={task.workTypeId ?? ""}>
          <option value="">선택해 주세요</option>
          {workTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
        </select></label>
        {state.fieldErrors?.workTypeId?.map((error) => <p role="alert" key={error}>{error}</p>)}
      </div>
      <div><label>예상 작업량<input name="estimatedBlocks" type="number" min="1" defaultValue={task.estimatedBlocks ?? 1} /></label>
        {state.fieldErrors?.estimatedBlocks?.map((error) => <p role="alert" key={error}>{error}</p>)}
      </div>
      <label>마감일<input name="deadline" type="date" defaultValue={task.deadline ?? ""} /></label>
    </div>
    {state.message && <p className="form-message" role="alert">{state.message}</p>}
    <button className="button button--primary" disabled={pending}>{pending ? "공개 중…" : "작업 풀에 공개"}</button>
  </form>;
}
