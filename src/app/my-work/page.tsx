import Link from "next/link";
import { getTaskRepository } from "@/db/client";
import { TaskCard } from "@/features/tasks/components/task-card";
import { returnTaskAction, startTaskAction } from "@/features/tasks/server/actions";

export const dynamic = "force-dynamic";

export default async function MyWorkPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const tasks = await getTaskRepository().listForAssignee("user-fixed");
  const { error } = await searchParams;
  const progress = tasks.filter((task) => task.workStatus === "in_progress");
  const taken = tasks.filter((task) => task.workStatus === "taken");
  const render = (task: (typeof tasks)[number]) => <TaskCard key={task.id} task={task}>
    {task.workStatus === "taken" && <div className="action-group">
      <form action={startTaskAction}>
        <input type="hidden" name="taskId" value={task.id} />
        <input type="hidden" name="expectedVersion" value={task.version} />
        <button className="button button--primary">작업 시작</button>
      </form>
      <form action={returnTaskAction}>
        <input type="hidden" name="taskId" value={task.id} />
        <input type="hidden" name="expectedVersion" value={task.version} />
        <button className="button">돌려놓기</button>
      </form>
    </div>}
  </TaskCard>;
  return <main className="page">
    <header className="page-header"><div><p className="eyebrow">나의 집중 공간</p><h1>내 작업</h1><p>가져온 작업을 확인하고 바로 시작하세요.</p></div><Link className="button" href="/task-pool">작업 찾기</Link></header>
    {error && <p className="banner banner--error" role="alert">{error}</p>}
    {!tasks.length && <div className="empty-state">아직 가져간 작업이 없습니다.</div>}
    {!!progress.length && <section><h2>진행 중</h2><div className="task-list">{progress.map(render)}</div></section>}
    {!!taken.length && <section><h2>가져온 작업</h2><div className="task-list">{taken.map(render)}</div></section>}
  </main>;
}
