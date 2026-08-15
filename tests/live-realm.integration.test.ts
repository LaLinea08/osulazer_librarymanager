import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMPTY_FILTER_GROUP } from "../src/shared/contracts";
import { AppDatabase } from "../src/main/database";
import { scanRealmLibrary } from "../src/main/library-integration";

const liveRoot = process.env.OSU_LAZER_TEST_ROOT;

describe.runIf(Boolean(liveRoot))("live osu!lazer Realm integration", () => {
  let temporaryDirectory = "";

  beforeAll(async () => {
    temporaryDirectory = await mkdtemp(
      join(tmpdir(), "osu-library-manager-test-"),
    );
  });

  afterAll(async () => {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("indexes an immutable schema-51 snapshot and queries the app-owned cache", async () => {
    const root = liveRoot!;
    const sourcePath = join(root, "client.realm");
    const before = await stat(sourcePath);
    const snapshots = join(temporaryDirectory, "snapshots");
    const result = await scanRealmLibrary(
      root,
      snapshots,
      new AbortController().signal,
      () => undefined,
    );
    const after = await stat(sourcePath);

    expect(result.schemaVersion).toBe(51);
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records.every((record) => record.id.length > 0)).toBe(true);
    expect(
      result.records.every((record) => record.beatmapSetLocalId.length > 0),
    ).toBe(true);
    expect(result.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.capabilities.writeLibrary).toBe(true);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await readdir(snapshots)).toEqual([]);

    const database = new AppDatabase(
      join(temporaryDirectory, "integration.sqlite"),
    );
    try {
      database.replaceBeatmaps(result.records, root, result.sourceFingerprint);
      const query = database.query({
        text: "",
        filters: EMPTY_FILTER_GROUP,
        sort: { field: "artist", direction: "asc" },
        offset: 0,
        limit: 25,
      });
      expect(query.totalDifficulties).toBe(result.records.length);
      expect(query.items.length).toBeGreaterThan(0);
      expect(
        database.getStatistics(EMPTY_FILTER_GROUP).totalSets,
      ).toBeGreaterThan(0);
    } finally {
      database.close();
    }
  }, 180_000);
});
