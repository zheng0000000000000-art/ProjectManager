import { getTaskRepository } from "@/db/client";
import { TaskCard } from "@/features/tasks/components/task-card";
import { takeTaskAction } from "@/features/tasks/server/actions";
import { getCurrentActor } from "@/features/actors/server/current-actor";

export const dynamic = "force-dynamic";

export default async function TaskPoolPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await getCurrentActor();
  const tasks = await getTaskRepository().listPool(actor);
  const { error } = await searchParams;
  return <main className="page">
    <header className="page-header"><div><p className="eyebrow">함께할 일</p><h1>작업 풀</h1><p>지금 기여할 수 있는 작업을 골라 가져가세요.</p></div></header>
    {error && <p className="banner banner--error" role="alert">{error}</p>}
    <section className="task-list" aria-label="가져갈 수 있는 작업">
      {tasks.length ? tasks.map((task) => <TaskCard key={task.id} task={task}>
        <form action={takeTaskAction}>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="expectedVersion" value={task.version} />
          <button className="button button--primary">가져가기</button>
        </form>
      </TaskCard>) : <div className="empty-state">지금 가져갈 수 있는 작업이 없습니다.</div>}
    </section>
  </main>;
}
