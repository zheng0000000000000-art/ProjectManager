import type { ActorContext } from "../domain/actor";

export interface ActorRepository {
  findActiveProjectActor(userId: string, projectId: string): Promise<ActorContext | null>;
}
