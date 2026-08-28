import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { seedDefaultProject } from "./seed";

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe("seedDefaultProject", () => {
  it("creates one reusable loginless project context when run repeatedly", () => {
    const database = new Database(":memory:");
    databases.push(database);
    createSchema(database);

    seedDefaultProject(database);
    seedDefaultProject(database);

    expect(database.prepare("SELECT COUNT(*) count FROM projects").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) count FROM project_members").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) count FROM work_types").get()).toEqual({ count: 3 });
    expect(database.prepare("SELECT COUNT(*) count FROM member_work_scopes WHERE active = 1").get()).toEqual({ count: 3 });
  });
});
