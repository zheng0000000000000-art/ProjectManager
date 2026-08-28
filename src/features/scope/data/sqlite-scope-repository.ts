import type Database from "better-sqlite3";
import type { MemberWorkScopeRecord, WorkTypeRecord } from "../domain/scope";
import type { ScopeRepository } from "./scope-repository";

type ScopeRow = {
  id: string; project_id: string; member_id: string; work_type_id: string; active: number;
};

const toScope = (row: ScopeRow): MemberWorkScopeRecord => ({
  id: row.id,
  projectId: row.project_id,
  memberId: row.member_id,
  workTypeId: row.work_type_id,
  active: row.active === 1,
});

export class SqliteScopeRepository implements ScopeRepository {
  constructor(private readonly database: Database.Database) {}

  async listWorkTypes(projectId: string): Promise<WorkTypeRecord[]> {
    const rows = this.database.prepare(
      "SELECT id, project_id, name FROM work_types WHERE project_id = ? ORDER BY name",
    ).all(projectId) as { id: string; project_id: string; name: string }[];
    return rows.map((row) => ({ id: row.id, projectId: row.project_id, name: row.name }));
  }

  async grantScope(memberId: string, workTypeId: string): Promise<MemberWorkScopeRecord> {
    const relation = this.database.prepare(`SELECT m.project_id
      FROM project_members m JOIN work_types w ON w.project_id = m.project_id
      WHERE m.id = ? AND w.id = ?`).get(memberId, workTypeId) as { project_id: string } | undefined;
    if (!relation) throw new Error("멤버와 작업 종류가 같은 프로젝트에 속하지 않습니다.");
    const existing = this.database.prepare(
      "SELECT id FROM member_work_scopes WHERE member_id = ? AND work_type_id = ?",
    ).get(memberId, workTypeId) as { id: string } | undefined;
    const id = existing?.id ?? crypto.randomUUID();
    this.database.prepare(`INSERT INTO member_work_scopes
      (id, project_id, member_id, work_type_id, active) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(member_id, work_type_id) DO UPDATE SET active = 1`).run(
      id, relation.project_id, memberId, workTypeId,
    );
    const row = this.database.prepare("SELECT * FROM member_work_scopes WHERE id = ?").get(id) as ScopeRow;
    return toScope(row);
  }

  async revokeScope(memberId: string, workTypeId: string): Promise<void> {
    this.database.prepare(
      "UPDATE member_work_scopes SET active = 0 WHERE member_id = ? AND work_type_id = ?",
    ).run(memberId, workTypeId);
  }

  async canTake(userId: string, taskId: string): Promise<boolean> {
    const row = this.database.prepare(`SELECT 1 allowed
      FROM tasks t
      JOIN project_members m ON m.project_id = t.project_id AND m.user_id = ? AND m.active = 1
      JOIN member_work_scopes s ON s.project_id = t.project_id
        AND s.member_id = m.id AND s.work_type_id = t.work_type_id AND s.active = 1
      WHERE t.id = ?`).get(userId, taskId);
    return Boolean(row);
  }
}
