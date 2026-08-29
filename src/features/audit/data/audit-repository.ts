import type { AuditEntryInput } from "../domain/audit-entry";

export interface AuditRepository {
  appendFailure(input: AuditEntryInput): Promise<void>;
}
