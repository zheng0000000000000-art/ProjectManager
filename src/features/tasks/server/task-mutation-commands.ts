import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { getActorRepository, getAuditRepository, getTaskRepository } from "@/db/client";
import { ACTOR_COOKIE_NAME, ACTOR_HEADER_NAME, createActorResolver } from "@/features/actors/server/actor-resolver";
import { createAuditedActorResolver } from "@/features/audit/server/audited-actor-resolver";
import type { TaskAuditAction } from "@/features/audit/domain/audit-entry";
import { createTaskCommands, type TaskCommandContext } from "./task-commands";
import { TaskFailureAuditor } from "./task-failure-auditor";
import { isValidExpectedVersion } from "./task-mutation-validation";

export async function getTaskMutationRequest(action: TaskAuditAction) {
  const context: TaskCommandContext = {
    requestId: randomUUID(),
    clock: () => new Date().toISOString(),
  };
  const auditRepository = getAuditRepository();
  const taskRepository = getTaskRepository();
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const actorResolver = createAuditedActorResolver(
    createActorResolver(getActorRepository()),
    auditRepository,
    context,
  );
  const actorInput = {
    cookieActorId: cookieStore.get(ACTOR_COOKIE_NAME)?.value,
    headerActorId: headerStore.get(ACTOR_HEADER_NAME),
  };
  const failureAuditor = new TaskFailureAuditor(
    taskRepository,
    auditRepository,
    context.requestId,
  );

  return {
    async recordValidationFailure(input: {
      taskId: string | null;
      expectedVersion?: unknown;
      fieldNames: readonly unknown[];
    }) {
      await failureAuditor.append({
        action,
        taskId: input.taskId,
        errorCode: "VALIDATION_ERROR",
        expectedVersion: input.expectedVersion,
        fieldNames: input.fieldNames,
        createdAt: context.clock(),
      });
    },

    async getCommands(expectedVersion?: number) {
      const actor = await actorResolver.resolveActorForMutation({
        action,
        expectedVersion: isValidExpectedVersion(expectedVersion) ? expectedVersion : undefined,
        ...actorInput,
      });

      return createTaskCommands(taskRepository, auditRepository, actor, context);
    },
  };
}

export async function getTaskMutationCommands(action: TaskAuditAction, expectedVersion?: number) {
  return (await getTaskMutationRequest(action)).getCommands(expectedVersion);
}
