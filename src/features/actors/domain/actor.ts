export type ActorType = "human" | "ai";

export interface ActorContext {
  userId: string;
  projectId: string;
  actorType: ActorType;
}

export const HUMAN_USER_ID = "user-fixed";
export const CODEX_USER_ID = "user-codex";
export const CODEX_MEMBER_ID = "member-codex";
