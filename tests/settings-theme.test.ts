import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { AppDatabase } from "../src/main/database";

const workspaces: string[] = [];
const openDatabases: AppDatabase[] = [];

afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close();
  await Promise.all(
    workspaces
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function databasePath(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "osu-theme-settings-test-"));
  workspaces.push(workspace);
  return join(workspace, "index.sqlite");
}

function open(path: string): AppDatabase {
  const database = new AppDatabase(path);
  openDatabases.push(database);
  return database;
}

function close(database: AppDatabase): void {
  database.close();
  openDatabases.splice(openDatabases.indexOf(database), 1);
}

function seedLegacySettings(path: string, theme: string): void {
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    INSERT INTO schema_migrations(version, applied_at)
    VALUES (1, CURRENT_TIMESTAMP), (2, CURRENT_TIMESTAMP), (3, CURRENT_TIMESTAMP);
  `);
  legacy
    .prepare("INSERT INTO settings(key, value) VALUES ('theme', ?)")
    .run(JSON.stringify(theme));
  legacy.close();
}

function writeStoredTheme(path: string, value: string): void {
  const raw = new DatabaseSync(path);
  raw.prepare("UPDATE settings SET value = ? WHERE key = 'theme'").run(value);
  raw.close();
}

describe("persistent theme settings", () => {
  it("uses light for a fresh install", async () => {
    const path = await databasePath();
    const database = open(path);

    expect(database.getSettings().theme).toBe("light");

    const inspection = new DatabaseSync(path, { readOnly: true });
    expect(
      inspection
        .prepare("SELECT version FROM schema_migrations WHERE version = 4")
        .get(),
    ).toEqual({ version: 4 });
    inspection.close();
  });

  it("migrates the legacy dormant dark seed to light exactly once", async () => {
    const path = await databasePath();
    seedLegacySettings(path, "dark");

    let database = open(path);
    expect(database.getSettings().theme).toBe("light");

    expect(database.updateSettings({ theme: "dark" }).theme).toBe("dark");
    close(database);
    database = open(path);

    expect(database.getSettings().theme).toBe("dark");
  });

  it.each(["light", "dark", "system"] as const)(
    "persists an explicit %s preference after migration",
    async (theme) => {
      const path = await databasePath();
      let database = open(path);
      expect(database.updateSettings({ theme }).theme).toBe(theme);
      close(database);

      database = open(path);
      expect(database.getSettings().theme).toBe(theme);
    },
  );

  it("ignores an invalid theme received across the settings boundary", async () => {
    const path = await databasePath();
    const database = open(path);

    database.updateSettings({
      theme: "neon" as unknown as "light",
    });

    expect(database.getSettings().theme).toBe("light");
  });

  it.each([JSON.stringify("neon"), "{"])(
    "repairs an invalid persisted theme (%s)",
    async (storedValue) => {
      const path = await databasePath();
      let database = open(path);
      close(database);
      writeStoredTheme(path, storedValue);

      database = open(path);
      expect(database.getSettings().theme).toBe("light");
      close(database);

      const inspection = new DatabaseSync(path, { readOnly: true });
      expect(
        inspection
          .prepare("SELECT value FROM settings WHERE key = 'theme'")
          .get(),
      ).toEqual({ value: JSON.stringify("light") });
      inspection.close();
    },
  );
});
