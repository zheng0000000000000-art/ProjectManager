import type { MemberWorkScopeRecord, WorkTypeRecord } from "../domain/scope";

export interface ScopeRepository {
  listWorkTypes(projectId: string): Promise<WorkTypeRecord[]>;
  grantScope(memberId: string, workTypeId: string): Promise<MemberWorkScopeRecord>;
  revokeScope(memberId: string, workTypeId: string): Promise<void>;
  canTake(userId: string, taskId: string): Promise<boolean>;
}
