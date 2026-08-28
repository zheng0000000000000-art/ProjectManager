import { notFound } from "next/navigation";
import { getScopeRepository, getTaskRepository } from "@/db/client";
import { TaskCard } from "@/features/tasks/components/task-card";
import { returnTaskAction, startTaskAction, takeTaskAction } from "@/features/tasks/server/actions";
import { EditTaskForm } from "./edit-task-form";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await getTaskRepository().findById(id);
  if (!task) notFound();
  const workTypes = await getScopeRepository().listWorkTypes(task.projectId);
  if (task.publicationState === "draft") {
    return <main className="page page--narrow"><header className="page-header"><div><p className="eyebrow">새로운 제안</p><h1>작업 초안</h1><p>목표와 범위를 적고 준비되면 작업 풀에 공개하세요.</p></div></header><EditTaskForm task={task} workTypes={workTypes} /></main>;
  }
  const item = { ...task, workTypeName: workTypes.find((type) => type.id === task.workTypeId)?.name ?? null };
  return <main className="page page--narrow"><header className="page-header"><div><p className="eyebrow">작업 상세</p><h1>{task.title}</h1></div></header>
    <TaskCard task={item}>
      {task.workStatus === "open" && <form action={takeTaskAction}><input type="hidden" name="taskId" value={task.id}/><input type="hidden" name="expectedVersion" value={task.version}/><button className="button button--primary">가져가기</button></form>}
      {task.workStatus === "taken" && task.assigneeId === "user-fixed" && <div className="action-group">
        <form action={startTaskAction}><input type="hidden" name="taskId" value={task.id}/><input type="hidden" name="expectedVersion" value={task.version}/><button className="button button--primary">작업 시작</button></form>
        <form action={returnTaskAction}><input type="hidden" name="taskId" value={task.id}/><input type="hidden" name="expectedVersion" value={task.version}/><button className="button">돌려놓기</button></form>
      </div>}
    </TaskCard>
  </main>;
}
