import type Database from "better-sqlite3";
import type { ActorType } from "../domain/actor";
import type { ActorRepository } from "./actor-repository";

type ActorRow = {
  user_id: string;
  project_id: string;
  actor_type: ActorType;
};

export class SqliteActorRepository implements ActorRepository {
  constructor(private readonly database: Database.Database) {}

  async findActiveProjectActor(userId: string, projectId: string) {
    const row = this.database.prepare(`SELECT u.id user_id, m.project_id, u.actor_type
      FROM users u
      JOIN project_members m ON m.user_id = u.id
      WHERE u.id = ? AND m.project_id = ? AND m.active = 1`).get(userId, projectId) as ActorRow | undefined;
    return row ? { userId: row.user_id, projectId: row.project_id, actorType: row.actor_type } : null;
  }
}
