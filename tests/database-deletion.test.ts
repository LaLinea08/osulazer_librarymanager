import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  BeatmapDifficulty,
  LibraryQuery,
  QuarantineRecord,
  SerializableSelection,
} from "../src/shared/contracts";
import { EMPTY_FILTER_GROUP } from "../src/shared/contracts";
import { AppDatabase } from "../src/main/database";

function beatmap(
  id: string,
  beatmapSetLocalId: string,
  overrides: Partial<BeatmapDifficulty> = {},
): BeatmapDifficulty {
  return {
    id,
    beatmapId: null,
    beatmapSetId: null,
    beatmapSetLocalId,
    setProtected: false,
    artist: `Artist ${beatmapSetLocalId}`,
    title: `Title ${beatmapSetLocalId}`,
    difficultyName: id,
    mapper: "Mapper",
    mode: "osu",
    status: "ranked",
    bpm: 180,
    durationSeconds: 120,
    starRating: 5,
    approachRate: 9,
    overallDifficulty: 8,
    circleSize: 4,
    hpDrain: 6,
    source: "",
    tags: "",
    audioFilename: "audio.mp3",
    hasBackground: true,
    hasVideo: false,
    rankedAt: null,
    importedAt: "2026-01-01T00:00:00.000Z",
    lastPlayedAt: null,
    localPlayCount: null,
    localScoreCount: 0,
    storageBytes: 1_000,
    contentHash: id.padEnd(64, "0").slice(0, 64),
    ...overrides,
  };
}

const query: LibraryQuery = {
  text: "",
  filters: EMPTY_FILTER_GROUP,
  sort: { field: "artist", direction: "asc" },
  offset: 0,
  limit: 200,
};

const explicit = (...included: string[]): SerializableSelection => ({
  mode: "explicit",
  included,
  excluded: [],
});

describe("AppDatabase guarded deletion support", () => {
  let directory = "";
  let database: AppDatabase;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "osu-library-db-test-"));
    database = new AppDatabase(join(directory, "index.sqlite"));
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("expands one selected difficulty to its complete local set", () => {
    database.replaceBeatmaps(
      [
        beatmap("a-1", "set-a", { beatmapSetId: 50, storageBytes: 4_000 }),
        beatmap("a-2", "set-a", { beatmapSetId: 50, storageBytes: 4_000 }),
        beatmap("b-1", "set-b", { beatmapSetId: 50, storageBytes: 8_000 }),
      ],
      "C:\\osu",
      "sha256:indexed",
    );

    const resolution = database.resolveDeletionSelection(
      query,
      explicit("a-1"),
    );

    expect(resolution).toMatchObject({
      scanFingerprint: "sha256:indexed",
      selectedDifficulties: 1,
      affectedDifficulties: 2,
      affectedSets: 1,
      logicalBytes: 4_000,
      protectedSets: 0,
      blockers: [],
    });
    expect(resolution.selectedDifficultyIds).toEqual(["a-1"]);
    expect(resolution.sets).toEqual([
      expect.objectContaining({
        beatmapSetLocalId: "set-a",
        beatmapSetId: 50,
        difficultyCount: 2,
      }),
    ]);
  });

  it("migrates an existing index before accepting fresh set identities", () => {
    database.close();
    const path = join(directory, "index.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      DROP INDEX beatmaps_local_set_idx;
      ALTER TABLE beatmaps DROP COLUMN beatmap_set_local_id;
      ALTER TABLE beatmaps DROP COLUMN set_protected;
      DELETE FROM schema_migrations WHERE version = 2;
    `);
    legacy.close();

    database = new AppDatabase(path);
    database.replaceBeatmaps(
      [beatmap("migrated-1", "migrated-set")],
      "C:\\osu",
      "sha256:migrated",
    );

    expect(
      database.resolveDeletionSelection(query, explicit("migrated-1")),
    ).toMatchObject({
      scanFingerprint: "sha256:migrated",
      affectedSets: 1,
      affectedDifficulties: 1,
      blockers: [],
    });
  });

  it("uses local set identity for offline sets and duplicate online IDs", () => {
    database.replaceBeatmaps(
      [
        beatmap("a-1", "set-a", { beatmapSetId: 50 }),
        beatmap("a-2", "set-a", { beatmapSetId: 50 }),
        beatmap("b-1", "set-b", { beatmapSetId: 50 }),
        beatmap("c-1", "set-c"),
        beatmap("c-2", "set-c"),
        beatmap("d-1", "set-d"),
      ],
      "C:\\osu",
      "sha256:indexed",
    );

    expect(database.query(query).filteredSets).toBe(4);
    expect(database.getStatistics(EMPTY_FILTER_GROUP).totalSets).toBe(4);
    expect(
      database.resolveDeletionSelection(query, explicit("c-1")).sets[0],
    ).toMatchObject({ beatmapSetLocalId: "set-c", difficultyCount: 2 });
  });

  it("honors all-filtered exclusions before expanding selected sets", () => {
    database.replaceBeatmaps(
      [
        beatmap("a-1", "set-a"),
        beatmap("a-2", "set-a"),
        beatmap("b-1", "set-b"),
        beatmap("c-1", "set-c", { mode: "mania" }),
        beatmap("d-1", "set-d"),
      ],
      "C:\\osu",
      "sha256:indexed",
    );
    const modeQuery: LibraryQuery = {
      ...query,
      filters: {
        ...EMPTY_FILTER_GROUP,
        children: [
          {
            kind: "condition",
            id: "mode-osu",
            field: "mode",
            operator: "equals",
            value: "osu",
            enabled: true,
          },
        ],
      },
    };

    const resolution = database.resolveDeletionSelection(modeQuery, {
      mode: "all-filtered",
      included: [],
      excluded: ["b-1"],
    });

    expect(resolution.selectedDifficulties).toBe(3);
    expect(resolution.affectedDifficulties).toBe(3);
    expect(resolution.sets.map((set) => set.beatmapSetLocalId).sort()).toEqual([
      "set-a",
      "set-d",
    ]);
  });

  it("blocks protected sets and indexes without a source fingerprint", () => {
    database.replaceBeatmaps(
      [beatmap("protected-1", "protected-set", { setProtected: true })],
      "C:\\osu",
    );

    const resolution = database.resolveDeletionSelection(
      query,
      explicit("protected-1"),
    );

    expect(resolution.protectedSets).toBe(1);
    expect(resolution.blockers).toEqual([
      expect.stringContaining("no verified source fingerprint"),
      expect.stringContaining("protected by osu!lazer"),
    ]);
  });

  it("persists, lists, and updates quarantine recovery records", () => {
    const record: QuarantineRecord = {
      operationId: "operation-1",
      createdAt: "2026-08-15T12:00:00.000Z",
      updatedAt: "2026-08-15T12:00:00.000Z",
      libraryPath: "C:\\osu",
      status: "queued",
      summary: "Queued one set for deletion",
      affectedDifficulties: 3,
      affectedSets: 1,
      logicalBytes: 10_000,
      uniqueBackupBytes: 8_000,
      backupPath: "C:\\backup\\operation-1",
      sourceFingerprint: "sha256:before",
      postMutationFingerprint: "sha256:after",
      canRestore: true,
      restoreBlockedReason: null,
      details: null,
    };

    database.saveQuarantineRecord(record);
    expect(database.getQuarantineRecords()).toEqual([record]);

    const restored = database.updateQuarantineRecord("operation-1", {
      status: "restored",
      canRestore: false,
      restoreBlockedReason: "The deletion was restored.",
      details: "All pending flags were cleared.",
    });

    expect(restored).toMatchObject({
      operationId: "operation-1",
      createdAt: record.createdAt,
      status: "restored",
      canRestore: false,
      restoreBlockedReason: "The deletion was restored.",
    });
    expect(restored.updatedAt).not.toBe(record.updatedAt);
    expect(database.getQuarantineRecord("operation-1")).toEqual(restored);
    expect(() =>
      database.updateQuarantineRecord("missing", { status: "failed" }),
    ).toThrow("not found");
  });
});
