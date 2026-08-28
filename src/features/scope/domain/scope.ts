export const DEFAULT_PROJECT_ID = "project-default";
export const FIXED_USER_ID = "user-fixed";
export const FIXED_MEMBER_ID = "member-fixed";

export interface WorkTypeRecord {
  id: string;
  projectId: string;
  name: string;
}

export interface MemberWorkScopeRecord {
  id: string;
  projectId: string;
  memberId: string;
  workTypeId: string;
  active: boolean;
}
