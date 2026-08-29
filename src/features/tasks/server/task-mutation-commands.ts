import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { getActorRepository, getAuditRepository, getTaskRepository } from "@/db/client";
import { ACTOR_COOKIE_NAME, ACTOR_HEADER_NAME, createActorResolver } from "@/features/actors/server/actor-resolver";
import { createAuditedActorResolver } from "@/features/audit/server/audited-actor-resolver";
import type { TaskAuditAction } from "@/features/audit/domain/audit-entry";
import { createTaskCommands, isValidExpectedVersion, type TaskCommandContext } from "./task-commands";

export async function getTaskMutationCommands(action: TaskAuditAction, expectedVersion?: number) {
  const context: TaskCommandContext = {
    requestId: randomUUID(),
    clock: () => new Date().toISOString(),
  };
  const auditRepository = getAuditRepository();
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const actor = await createAuditedActorResolver(
    createActorResolver(getActorRepository()),
    auditRepository,
    context,
  ).resolveActorForMutation({
    action,
    expectedVersion: isValidExpectedVersion(expectedVersion) ? expectedVersion : undefined,
    cookieActorId: cookieStore.get(ACTOR_COOKIE_NAME)?.value,
    headerActorId: headerStore.get(ACTOR_HEADER_NAME),
  });

  return createTaskCommands(getTaskRepository(), auditRepository, actor, context);
}
