import Link from "next/link";
import type { ReactNode } from "react";
import type { TaskListItem } from "../data/task-repository";

const statusLabel = { open: "열림", taken: "가져감", in_progress: "진행 중" };

function formatStartTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

export function TaskCard({ task, children }: { task: TaskListItem; children?: ReactNode }) {
  return <article className="task-card" aria-label={task.title}>
    <div className="task-card__body">
      <div className="task-card__heading">
        <Link href={`/tasks/${task.id}`}><h3>{task.title}</h3></Link>
        <span className={`status status--${task.workStatus}`}>{statusLabel[task.workStatus]}</span>
      </div>
      <p>{task.goal}</p>
      <div className="task-meta">
        {task.workTypeName && <span>{task.workTypeName}</span>}
        {task.estimatedBlocks && <span>{task.estimatedBlocks} 블록</span>}
        {task.deadline && <span>마감 {task.deadline}</span>}
        {task.workStatus === "in_progress" && task.startedAt && <span>시작 {formatStartTime(task.startedAt)}</span>}
      </div>
    </div>
    {children && <div className="task-card__action">{children}</div>}
  </article>;
}
