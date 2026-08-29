import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema";
import { seedDefaultProject } from "../../src/db/seed";

const filename = path.join(process.cwd(), "data", "browser-test.db");

function initializeDatabase(databaseFilename: string, recreate: boolean) {
  fs.mkdirSync(path.dirname(databaseFilename), { recursive: true });
  if (recreate) fs.rmSync(databaseFilename, { force: true });
  const database = new Database(databaseFilename);
  try {
    createSchema(database);
    seedDefaultProject(database);
  } finally {
    database.close();
  }
}

export function recreateBrowserTestDatabase(databaseFilename = filename) {
  initializeDatabase(databaseFilename, true);
}

export default function globalSetup() {
  initializeDatabase(filename, false);
}

if (path.basename(process.argv[1] ?? "") === "global-setup.ts") {
  recreateBrowserTestDatabase();
}
