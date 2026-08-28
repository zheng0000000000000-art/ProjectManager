import type Database from "better-sqlite3";
import { DEFAULT_PROJECT_ID, FIXED_MEMBER_ID, FIXED_USER_ID } from "@/features/scope/domain/scope";

const DEFAULT_WORK_TYPES = [
  ["work-planning", "기획"],
  ["work-development", "개발"],
  ["work-qa", "검수"],
] as const;

export function seedDefaultProject(database: Database.Database) {
  database.transaction(() => {
    database.prepare("INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)").run(FIXED_USER_ID, "나");
    database.prepare("INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)").run(DEFAULT_PROJECT_ID, "현재 프로젝트");
    database.prepare(`INSERT OR IGNORE INTO project_members
      (id, project_id, user_id, is_admin, active) VALUES (?, ?, ?, 1, 1)`).run(
      FIXED_MEMBER_ID, DEFAULT_PROJECT_ID, FIXED_USER_ID,
    );
    for (const [id, name] of DEFAULT_WORK_TYPES) {
      database.prepare(`INSERT INTO work_types (id, project_id, name) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, name = excluded.name`).run(
        id, DEFAULT_PROJECT_ID, name,
      );
      database.prepare(`INSERT INTO member_work_scopes
        (id, project_id, member_id, work_type_id, active) VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(member_id, work_type_id) DO UPDATE SET active = 1`).run(
        `scope-${id}`, DEFAULT_PROJECT_ID, FIXED_MEMBER_ID, id,
      );
    }
    database.prepare("UPDATE tasks SET project_id = ? WHERE project_id IS NULL").run(DEFAULT_PROJECT_ID);
  })();
}
