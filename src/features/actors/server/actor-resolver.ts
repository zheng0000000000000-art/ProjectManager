import type { ActorRepository } from "../data/actor-repository";
import type { ActorContext } from "../domain/actor";
import { HUMAN_USER_ID } from "../domain/actor";
import { DEFAULT_PROJECT_ID } from "@/features/scope/domain/scope";

export const ACTOR_COOKIE_NAME = "project-actor";
export const ACTOR_HEADER_NAME = "x-project-actor";

export class ActorResolutionError extends Error {
  constructor(
    public readonly code: "ACTOR_NOT_ALLOWED",
    message: string,
  ) {
    super(message);
    this.name = "ActorResolutionError";
  }
}

export type ActorResolutionInput = {
  cookieActorId?: string | null;
  headerActorId?: string | null;
};

export function createActorResolver(repository: ActorRepository) {
  return async ({ headerActorId }: ActorResolutionInput): Promise<ActorContext> => {
    if (headerActorId) {
      const actor = await repository.findActiveProjectActor(headerActorId, DEFAULT_PROJECT_ID);
      if (!actor) throw new ActorResolutionError("ACTOR_NOT_ALLOWED", "허용된 프로젝트 작업자가 아닙니다.");
      return actor;
    }

    const fallback = await repository.findActiveProjectActor(HUMAN_USER_ID, DEFAULT_PROJECT_ID);
    if (!fallback) throw new ActorResolutionError("ACTOR_NOT_ALLOWED", "기본 작업자를 찾을 수 없습니다.");
    return fallback;
  };
}
