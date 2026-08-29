import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createSchema } from "./schema";
import { seedDefaultProject } from "./seed";
import { SqliteTaskRepository } from "@/features/tasks/data/sqlite-task-repository";
import { SqliteScopeRepository } from "@/features/scope/data/sqlite-scope-repository";
import { SqliteActorRepository } from "@/features/actors/data/sqlite-actor-repository";
import { SqliteAuditRepository } from "@/features/audit/data/sqlite-audit-repository";
import type { AuditRepository } from "@/features/audit/data/audit-repository";

const shared = globalThis as typeof globalThis & {
  taskDatabase?: Database.Database;
  taskRepository?: SqliteTaskRepository;
  scopeRepository?: SqliteScopeRepository;
  actorRepository?: SqliteActorRepository;
  auditRepository?: AuditRepository;
};

export function getDatabase() {
  if (!shared.taskDatabase) {
    const filename = process.env.DATABASE_URL ?? "./data/app.db";
    fs.mkdirSync(path.dirname(path.resolve(/* turbopackIgnore: true */ filename)), { recursive: true });
    shared.taskDatabase = new Database(filename);
    createSchema(shared.taskDatabase);
    seedDefaultProject(shared.taskDatabase);
  }
  return shared.taskDatabase;
}

export function getTaskRepository() {
  shared.taskRepository ??= new SqliteTaskRepository(getDatabase());
  return shared.taskRepository;
}

export function getScopeRepository() {
  shared.scopeRepository ??= new SqliteScopeRepository(getDatabase());
  return shared.scopeRepository;
}

export function getActorRepository() {
  shared.actorRepository ??= new SqliteActorRepository(getDatabase());
  return shared.actorRepository;
}

export function getAuditRepository(): AuditRepository {
  shared.auditRepository ??= new SqliteAuditRepository(getDatabase());
  return shared.auditRepository;
}
