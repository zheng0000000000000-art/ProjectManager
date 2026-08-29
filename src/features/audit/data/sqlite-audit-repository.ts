import type Database from "better-sqlite3";
import {
  parseSafeAuditMetadata,
  serializeSafeAuditMetadata,
  type AuditEntryInput,
} from "../domain/audit-entry";
import type { AuditRepository } from "./audit-repository";

type AuditRow = {
  project_id: string;
  task_id: string | null;
  actor_id: string | null;
  action: AuditEntryInput["action"];
  outcome: AuditEntryInput["outcome"];
  error_code: string | null;
  from_state: string | null;
  to_state: string | null;
  request_id: string;
  metadata_json: string;
  created_at: string;
};

function toAuditEntry(row: AuditRow): AuditEntryInput {
  return {
    projectId: row.project_id,
    taskId: row.task_id,
    actorId: row.actor_id,
    action: row.action,
    outcome: row.outcome,
    errorCode: row.error_code,
    fromState: row.from_state,
    toState: row.to_state,
    requestId: row.request_id,
    metadata: parseSafeAuditMetadata(row.metadata_json),
    createdAt: row.created_at,
  };
}

export class SqliteAuditRepository implements AuditRepository {
  constructor(private readonly database: Database.Database) {}

  async appendFailure(input: AuditEntryInput): Promise<void> {
    if (input.outcome !== "failure") throw new Error("Audit repository only appends failures");
    const metadataJson = serializeSafeAuditMetadata(input.metadata);

    this.database.transaction(() => {
      this.database.prepare(`INSERT INTO audit_logs
        (id, project_id, task_id, actor_id, action, outcome, error_code, from_state, to_state, request_id, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        crypto.randomUUID(), input.projectId, input.taskId, input.actorId, input.action,
        input.outcome, input.errorCode, input.fromState, input.toState, input.requestId,
        metadataJson, input.createdAt,
      );
    }).immediate();
  }

  listByRequestIdForTest(requestId: string): AuditEntryInput[] {
    const rows = this.database.prepare(`SELECT project_id, task_id, actor_id, action, outcome,
      error_code, from_state, to_state, request_id, metadata_json, created_at
      FROM audit_logs WHERE request_id = ? ORDER BY created_at, id`).all(requestId) as AuditRow[];
    return rows.map(toAuditEntry);
  }
}
