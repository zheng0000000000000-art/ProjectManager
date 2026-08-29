import type Database from "better-sqlite3";
import type { ActorContext } from "@/features/actors/domain/actor";
import type { TaskRecord } from "../domain/task";
import {
  TaskRepositoryError,
  type CommandContext,
  type TaskEventInput,
  type TaskListItem,
  type TaskRepository,
} from "./task-repository";

type TaskRow = {
  id: string; project_id: string; title: string; goal: string; work_type_id: string | null;
  estimated_blocks: number | null; deadline: string | null;
  publication_state: TaskRecord["publicationState"];
  work_status: TaskRecord["workStatus"]; assignee_id: string | null; version: number;
  started_at: string | null;
  work_type_name?: string | null;
};

function toTask(row: TaskRow): TaskRecord {
  return {
    id: row.id, projectId: row.project_id, title: row.title, goal: row.goal, workTypeId: row.work_type_id,
    estimatedBlocks: row.estimated_blocks, deadline: row.deadline,
    publicationState: row.publication_state, workStatus: row.work_status,
    assigneeId: row.assignee_id, startedAt: row.started_at, version: row.version,
  };
}

export class SqliteTaskRepository implements TaskRepository {
  constructor(private readonly database: Database.Database) {}

  async createDraft(actorId: string, projectId: string) {
    return this.database.transaction(() => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      this.database.prepare(`INSERT INTO tasks
        (id, project_id, creator_id, publication_state, work_status, version, created_at, updated_at)
        VALUES (?, ?, ?, 'draft', 'open', 1, ?, ?)`).run(id, projectId, actorId, now, now);
      this.database.prepare(`INSERT INTO task_events
        (id, task_id, event_type, actor_id, from_state, to_state, created_at)
        VALUES (?, ?, 'created', ?, NULL, 'draft', ?)`)
        .run(crypto.randomUUID(), id, actorId, now);
      return toTask(this.getRow(id)!);
    }).immediate();
  }

  async findById(id: string) {
    const row = this.getRow(id);
    return row ? toTask(row) : null;
  }

  async listPool(actor: ActorContext) {
    return this.listWhere(`t.publication_state = 'published' AND t.work_status = 'open'
      AND t.assignee_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM task_prerequisites p
        WHERE p.task_id = t.id AND p.resolved_at IS NULL
      )
      AND EXISTS (
        SELECT 1 FROM project_members m
        JOIN member_work_scopes s ON s.project_id = m.project_id AND s.member_id = m.id
          AND s.work_type_id = t.work_type_id AND s.active = 1
        WHERE m.project_id = t.project_id AND m.user_id = ? AND m.active = 1
      ) AND t.project_id = ?`, [actor.userId, actor.projectId]);
  }

  async listForAssignee(actor: ActorContext) {
    return this.listWhere("t.assignee_id = ? AND t.project_id = ?", [actor.userId, actor.projectId]);
  }

  async countEvents(taskId: string) {
    const row = this.database.prepare("SELECT COUNT(*) count FROM task_events WHERE task_id = ?").get(taskId) as { count: number };
    return row.count;
  }

  async runCommand(taskId: string, expectedVersion: number, command: (context: CommandContext) => TaskRecord) {
    return this.database.transaction(() => {
      const row = this.getRow(taskId);
      if (!row) throw new TaskRepositoryError("NOT_FOUND", "작업을 찾을 수 없습니다.");
      const task = toTask(row);
      if (task.version !== expectedVersion) {
        throw new TaskRepositoryError("VERSION_CONFLICT", "다른 변경 사항이 반영되었습니다. 최신 내용을 불러와 다시 시도해 주세요.");
      }
      const events: TaskEventInput[] = [];
      const next = command({
        task,
        appendEvent: (event) => events.push(event),
        requireTakeEligibility: (actor: ActorContext) => {
          const unresolved = this.database.prepare(`SELECT 1 blocked
            FROM task_prerequisites
            WHERE task_id = ? AND resolved_at IS NULL LIMIT 1`).get(task.id);
          if (unresolved) {
            throw new TaskRepositoryError(
              "PREREQUISITE_UNRESOLVED",
              "완료되지 않은 선행 작업이 있어 가져갈 수 없습니다.",
            );
          }
          const allowed = this.database.prepare(`SELECT 1 allowed
            FROM project_members m
            JOIN member_work_scopes s ON s.project_id = m.project_id AND s.member_id = m.id
              AND s.work_type_id = ? AND s.active = 1
            WHERE m.project_id = ? AND m.user_id = ? AND m.active = 1`).get(
            task.workTypeId, task.projectId, actor.userId,
          );
          if (!allowed || actor.projectId !== task.projectId) {
            throw new TaskRepositoryError(
              "SCOPE_REQUIRED",
              "이 작업 종류를 가져갈 수 있는 활성 작업 범위가 없습니다.",
            );
          }
        },
      });
      if (events.length !== 1) throw new TaskRepositoryError("INVALID_EVENT_COUNT", "명령은 이력 하나를 기록해야 합니다.");
      const result = this.database.prepare(`UPDATE tasks SET title=?, goal=?, work_type_id=?, estimated_blocks=?,
        deadline=?, publication_state=?, work_status=?, assignee_id=?, started_at=?, version=?, updated_at=?
        WHERE id=? AND version=?`).run(
        next.title, next.goal, next.workTypeId, next.estimatedBlocks, next.deadline,
        next.publicationState, next.workStatus, next.assigneeId, next.startedAt, next.version,
        new Date().toISOString(), taskId, expectedVersion,
      );
      if (result.changes !== 1) throw new TaskRepositoryError("VERSION_CONFLICT", "다른 변경 사항이 반영되었습니다. 최신 내용을 불러와 다시 시도해 주세요.");
      const event = events[0];
      this.database.prepare(`INSERT INTO task_events
        (id, task_id, event_type, actor_id, from_state, to_state, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        crypto.randomUUID(), taskId, event.eventType, event.actorId,
        event.fromState, event.toState, event.createdAt,
      );
      return next;
    }).immediate();
  }

  private getRow(id: string) {
    return this.database.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
  }

  private listWhere(where: string, params: unknown[]): TaskListItem[] {
    const rows = this.database.prepare(`SELECT t.*, w.name work_type_name FROM tasks t
      LEFT JOIN work_types w ON w.id=t.work_type_id WHERE ${where}
      ORDER BY t.updated_at DESC`).all(...params) as TaskRow[];
    return rows.map((row) => ({ ...toTask(row), workTypeName: row.work_type_name ?? null }));
  }
}
