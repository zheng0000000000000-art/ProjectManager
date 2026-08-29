import type { ActorContext } from "@/features/actors/domain/actor";
import type { ActorResolutionInput } from "@/features/actors/server/actor-resolver";
import { DEFAULT_PROJECT_ID } from "@/features/scope/domain/scope";
import type { AuditRepository } from "../data/audit-repository";
import type { SafeAuditMetadata, TaskAuditAction } from "../domain/audit-entry";

type ActorResolver = (input: ActorResolutionInput) => Promise<ActorContext>;

export type AuditedActorContext = {
  requestId: string;
  clock: () => string;
};

export type ResolveActorForMutationInput = ActorResolutionInput & {
  action: TaskAuditAction;
  expectedVersion?: number;
};

function isActorResolutionError(error: unknown): error is { code: "ACTOR_NOT_ALLOWED"; message: string } {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "ACTOR_NOT_ALLOWED" && typeof candidate.message === "string";
}

export class AuditedActorResolver {
  constructor(
    private readonly resolveActor: ActorResolver,
    private readonly auditRepository: AuditRepository,
    private readonly context: AuditedActorContext,
  ) {}

  async resolveActorForMutation({
    action,
    expectedVersion,
    cookieActorId,
    headerActorId,
  }: ResolveActorForMutationInput): Promise<ActorContext> {
    try {
      return await this.resolveActor({ cookieActorId, headerActorId });
    } catch (error) {
      if (!isActorResolutionError(error)) throw error;

      const metadata: SafeAuditMetadata = {};
      if (expectedVersion !== undefined) metadata.expectedVersion = expectedVersion;

      try {
        await this.auditRepository.appendFailure({
          projectId: DEFAULT_PROJECT_ID,
          taskId: null,
          actorId: null,
          action,
          outcome: "failure",
          errorCode: "ACTOR_REJECTED",
          fromState: null,
          toState: null,
          requestId: this.context.requestId,
          metadata,
          createdAt: this.context.clock(),
        });
      } catch (auditError) {
        console.error("Audit persistence failed", auditError);
      }

      throw error;
    }
  }
}

export function createAuditedActorResolver(
  resolveActor: ActorResolver,
  auditRepository: AuditRepository,
  context: AuditedActorContext,
) {
  return new AuditedActorResolver(resolveActor, auditRepository, context);
}
