import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { publish } from "../domain/task-transitions";
import { createSchema } from "@/db/schema";
import { seedDefaultProject } from "@/db/seed";
import { DEFAULT_PROJECT_ID } from "@/features/scope/domain/scope";
import { SqliteTaskRepository } from "./sqlite-task-repository";

const databases: Database.Database[] = [];

function setup() {
  const database = new Database(":memory:");
  databases.push(database);
  createSchema(database);
  seedDefaultProject(database);
  return { database, repository: new SqliteTaskRepository(database) };
}

afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
});

describe("SqliteTaskRepository", () => {
  it("creates a draft and commits a task change with exactly one event", async () => {
    const { repository } = setup();
    const draft = await repository.createDraft("user-fixed", DEFAULT_PROJECT_ID);

    expect(draft).toMatchObject({
      publicationState: "draft",
      workStatus: "open",
      projectId: DEFAULT_PROJECT_ID,
      version: 1,
    });

    await repository.runCommand(draft.id, 1, ({ task, appendEvent }) => {
      const next = publish(task, {
        title: "저장되는 작업",
        goal: "트랜잭션을 검증한다",
        workTypeId: "work-development",
        estimatedBlocks: 3,
        deadline: null,
      });
      appendEvent({
        eventType: "published",
        actorId: "user-fixed",
        fromState: "draft",
        toState: "published",
      });
      return next;
    });

    expect((await repository.findById(draft.id))?.version).toBe(2);
    expect(await repository.countEvents(draft.id)).toBe(2);
  });

  it("rolls back both the task and event when a command fails", async () => {
    const { repository } = setup();
    const draft = await repository.createDraft("user-fixed", DEFAULT_PROJECT_ID);

    await expect(
      repository.runCommand(draft.id, 1, ({ appendEvent }) => {
        appendEvent({
          eventType: "published",
          actorId: "user-fixed",
          fromState: "draft",
          toState: "published",
        });
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");

    expect((await repository.findById(draft.id))?.version).toBe(1);
    expect(await repository.countEvents(draft.id)).toBe(1);
  });

  it("rejects a stale version without adding an event", async () => {
    const { repository } = setup();
    const draft = await repository.createDraft("user-fixed", DEFAULT_PROJECT_ID);

    await expect(
      repository.runCommand(draft.id, 0, () => draft),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(await repository.countEvents(draft.id)).toBe(1);
  });

  it("shows a published task only while the actor has active scope", async () => {
    const { database, repository } = setup();
    const draft = await repository.createDraft("user-fixed", DEFAULT_PROJECT_ID);
    await repository.runCommand(draft.id, 1, ({ task, appendEvent }) => {
      const next = publish(task, {
        title: "범위 작업", goal: "범위가 있는 사람만 본다", workTypeId: "work-development",
        estimatedBlocks: 2, deadline: null,
      });
      appendEvent({ eventType: "published", actorId: "user-fixed", fromState: "draft", toState: "published" });
      return next;
    });

    expect((await repository.listPool("user-fixed")).map((task) => task.id)).toContain(draft.id);
    database.prepare("UPDATE member_work_scopes SET active = 0 WHERE work_type_id = 'work-development'").run();
    expect((await repository.listPool("user-fixed")).map((task) => task.id)).not.toContain(draft.id);
  });

  it("rejects publishing with a work type from another project", async () => {
    const { database, repository } = setup();
    database.prepare("INSERT INTO projects (id, name) VALUES ('other-project', '다른 프로젝트')").run();
    database.prepare("INSERT INTO work_types (id, project_id, name) VALUES ('other-work', 'other-project', '외부')").run();
    const draft = await repository.createDraft("user-fixed", DEFAULT_PROJECT_ID);

    await expect(repository.runCommand(draft.id, 1, ({ task, appendEvent }) => {
      const next = publish(task, {
        title: "잘못된 연결", goal: "다른 프로젝트 작업 종류", workTypeId: "other-work",
        estimatedBlocks: 1, deadline: null,
      });
      appendEvent({ eventType: "published", actorId: "user-fixed", fromState: "draft", toState: "published" });
      return next;
    })).rejects.toThrow();
  });
});
