import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Realm from "realm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BeatmapDifficulty } from "../src/shared/contracts";
import { EMPTY_FILTER_GROUP } from "../src/shared/contracts";
import { AppDatabase } from "../src/main/database";
import { DeletionManager } from "../src/main/deletion-manager";
import { hashPath, sha256File } from "../src/main/library-integration";

const schema: Realm.ObjectSchema[] = [
  {
    name: "File",
    primaryKey: "Hash",
    properties: { Hash: "string" },
  },
  {
    name: "RealmNamedFileUsage",
    embedded: true,
    properties: { File: "File", Filename: "string" },
  },
  {
    name: "BeatmapSet",
    primaryKey: "ID",
    properties: {
      ID: "string",
      OnlineID: "int?",
      DateAdded: "date?",
      Beatmaps: "Beatmap[]",
      Files: "RealmNamedFileUsage[]",
      DeletePending: { type: "bool", default: false },
      Protected: { type: "bool", default: false },
    },
  },
  {
    name: "Beatmap",
    primaryKey: "ID",
    properties: {
      ID: "string",
      DifficultyName: "string",
      Ruleset: "mixed?",
      Difficulty: "mixed?",
      Metadata: "mixed?",
      BeatmapSet: "BeatmapSet?",
      OnlineID: "int?",
      Length: "double?",
      BPM: "double?",
      Hash: "string",
      StarRating: "double?",
      LastPlayed: "date?",
      Hidden: { type: "bool", default: false },
    },
  },
];

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function hash(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

function record(
  id: string,
  difficultyName: string,
  setId: string,
  storageBytes: number,
  contentHash: string,
): BeatmapDifficulty {
  return {
    id,
    beatmapId: null,
    beatmapSetId: 42,
    beatmapSetLocalId: setId,
    setProtected: false,
    artist: "Safety Artist",
    title: "Recovery Set",
    difficultyName,
    mapper: "Fixture Mapper",
    mode: "osu",
    status: "ranked",
    bpm: 180,
    durationSeconds: 120,
    starRating: 4,
    approachRate: 9,
    overallDifficulty: 8,
    circleSize: 4,
    hpDrain: 6,
    source: "",
    tags: "fixture",
    audioFilename: "audio.mp3",
    hasBackground: false,
    hasVideo: false,
    rankedAt: null,
    importedAt: null,
    lastPlayedAt: null,
    localPlayCount: null,
    localScoreCount: 0,
    storageBytes,
    contentHash,
  };
}

async function createFixture(): Promise<{
  root: string;
  database: AppDatabase;
  manager: DeletionManager;
  setId: string;
  blobPaths: string[];
}> {
  const workspace = await mkdtemp(join(tmpdir(), "osu-delete-manager-test-"));
  workspaces.push(workspace);
  const root = join(workspace, "osu");
  const files = join(root, "files");
  await mkdir(files, { recursive: true });

  const osuContents = Buffer.from(
    "osu file format v14\n[General]\nAudioFilename: audio.mp3\n",
  );
  const audioContents = Buffer.from("synthetic audio bytes");
  const osuHash = hash(osuContents);
  const audioHash = hash(audioContents);
  const blobPaths = [hashPath(files, osuHash), hashPath(files, audioHash)];
  await Promise.all(
    blobPaths.map((path) => mkdir(dirname(path), { recursive: true })),
  );
  await writeFile(blobPaths[0]!, osuContents);
  await writeFile(blobPaths[1]!, audioContents);

  const realmPath = join(root, "client.realm");
  const realm = await Realm.open({
    path: realmPath,
    schema,
    schemaVersion: 51,
  });
  const setId = "set-local-1";
  realm.write(() => {
    const osuFile = realm.create("File", { Hash: osuHash });
    const audioFile = realm.create("File", { Hash: audioHash });
    const set = realm.create("BeatmapSet", {
      ID: setId,
      OnlineID: 42,
      DateAdded: new Date("2025-01-01T00:00:00.000Z"),
      Beatmaps: [],
      Files: [
        { File: osuFile, Filename: "map.osu" },
        { File: audioFile, Filename: "audio.mp3" },
      ],
      DeletePending: false,
      Protected: false,
    }) as unknown as { Beatmaps: { push: (value: unknown) => void } };
    for (const [id, name] of [
      ["difficulty-1", "Normal"],
      ["difficulty-2", "Hard"],
    ]) {
      const beatmap = realm.create("Beatmap", {
        ID: id,
        DifficultyName: name,
        Ruleset: null,
        Difficulty: null,
        Metadata: null,
        BeatmapSet: set,
        OnlineID: null,
        Length: 120_000,
        BPM: 180,
        Hash: osuHash,
        StarRating: 4,
        LastPlayed: null,
        Hidden: false,
      });
      set.Beatmaps.push(beatmap);
    }
  });
  realm.close();

  const database = new AppDatabase(join(workspace, "index.sqlite"));
  const storageBytes = osuContents.length + audioContents.length;
  const fingerprint = await sha256File(realmPath);
  database.updateSettings({ libraryPath: root });
  database.replaceBeatmaps(
    [
      record("difficulty-1", "Normal", setId, storageBytes, osuHash),
      record("difficulty-2", "Hard", setId, storageBytes, osuHash),
    ],
    root,
    fingerprint,
  );
  database.setMeta("realm_schema_version", "51");
  const manager = new DeletionManager({
    database: () => database,
    quarantineRoot: join(workspace, "quarantine"),
    gameIsRunning: () => Promise.resolve(false),
  });
  return { root, database, manager, setId, blobPaths };
}

async function pending(realmPath: string, setId: string): Promise<boolean> {
  const realm = await Realm.open({
    path: realmPath,
    readOnly: true,
    disableFormatUpgrade: true,
  });
  try {
    const set = Array.from(realm.objects("BeatmapSet")).find(
      (value) => String((value as unknown as { ID: unknown }).ID) === setId,
    ) as unknown as { DeletePending: boolean } | undefined;
    return set?.DeletePending ?? false;
  } finally {
    realm.close();
  }
}

async function setPending(
  realmPath: string,
  setId: string,
  value: boolean,
): Promise<void> {
  const realm = await Realm.open({
    path: realmPath,
    disableFormatUpgrade: true,
  });
  try {
    const set = Array.from(realm.objects("BeatmapSet")).find(
      (item) => String((item as unknown as { ID: unknown }).ID) === setId,
    ) as unknown as { DeletePending: boolean } | undefined;
    if (!set) throw new Error("Fixture set was not found.");
    realm.write(() => {
      set.DeletePending = value;
    });
  } finally {
    realm.close();
  }
}

function previewSingleSet(manager: DeletionManager) {
  return manager.previewDeletion(
    {
      text: "",
      filters: EMPTY_FILTER_GROUP,
      sort: { field: "artist", direction: "asc" },
      offset: 0,
      limit: 200,
    },
    { mode: "explicit", included: ["difficulty-1"], excluded: [] },
  );
}

describe("DeletionManager", () => {
  it("backs up full sets and only toggles DeletePending, with undo", async () => {
    const fixture = await createFixture();
    const realmPath = join(fixture.root, "client.realm");
    const blobBefore = await Promise.all(
      fixture.blobPaths.map((path) => readFile(path)),
    );
    const preview = await fixture.manager.previewDeletion(
      {
        text: "",
        filters: EMPTY_FILTER_GROUP,
        sort: { field: "artist", direction: "asc" },
        offset: 0,
        limit: 200,
      },
      { mode: "explicit", included: ["difficulty-1"], excluded: [] },
    );

    expect(preview.canExecute).toBe(true);
    expect(preview.selectedDifficulties).toBe(1);
    expect(preview.affectedDifficulties).toBe(2);
    expect(preview.affectedSets).toBe(1);
    expect(preview.confirmationPhrase).toBe("DELETE 1 SET");

    const result = await fixture.manager.executeDeletion(
      preview.previewId,
      preview.confirmationPhrase,
    );
    expect(result.status).toBe("queued");
    expect(result.canRestore).toBe(true);
    expect(await pending(realmPath, fixture.setId)).toBe(true);
    expect(
      await Promise.all(fixture.blobPaths.map((path) => readFile(path))),
    ).toEqual(blobBefore);

    const manifestPath = join(result.backupPath, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      status: string;
      updatedAt: string;
      sets: Array<{ archiveRelativePath: string; archiveSha256: string }>;
    };
    expect(manifest.sets).toHaveLength(1);
    const archivePath = join(
      result.backupPath,
      manifest.sets[0]!.archiveRelativePath,
    );
    expect((await stat(archivePath)).size).toBeGreaterThan(0);
    expect(await sha256File(archivePath)).toBe(manifest.sets[0]!.archiveSha256);

    // Simulate a crash after the Realm transaction but before the journal was
    // advanced from ready to queued. Startup reconciliation must recover it.
    manifest.status = "ready";
    manifest.updatedAt = new Date().toISOString();
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await fixture.manager.reconcileManifests();
    expect(
      fixture.database.getQuarantineRecord(result.operationId)?.status,
    ).toBe("queued");

    const restored = await fixture.manager.restoreQuarantine(
      result.operationId,
    );
    expect(restored.status).toBe("restored");
    expect(await pending(realmPath, fixture.setId)).toBe(false);
    expect(
      fixture.database.getQuarantineRecord(result.operationId)?.status,
    ).toBe("restored");
    fixture.database.close();
  }, 30_000);

  it("invalidates a preview when the Realm no longer matches the scan", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.root, "client.realm"), Buffer.from("changed"));
    const preview = await fixture.manager.previewDeletion(
      {
        text: "",
        filters: EMPTY_FILTER_GROUP,
        sort: { field: "artist", direction: "asc" },
        offset: 0,
        limit: 200,
      },
      { mode: "explicit", included: ["difficulty-1"], excluded: [] },
    );
    expect(preview.canExecute).toBe(false);
    expect(preview.blockers.join(" ")).toContain(
      "changed after the last verified scan",
    );
    fixture.database.close();
  });

  it("blocks protected writes when the osu process state is unknown", async () => {
    const fixture = await createFixture();
    const manager = new DeletionManager({
      database: () => fixture.database,
      quarantineRoot: join(fixture.root, "unknown-process-quarantine"),
      gameIsRunning: () =>
        Promise.reject(new Error("process enumeration unavailable")),
    });

    const preview = await previewSingleSet(manager);
    expect(preview.canExecute).toBe(false);
    expect(preview.blockers.join(" ")).toContain(
      "could not verify that osu!lazer is closed",
    );
    expect(
      await pending(join(fixture.root, "client.realm"), fixture.setId),
    ).toBe(false);
    fixture.database.close();
  });

  it("does not downgrade a verified source commit when SQLite journaling fails", async () => {
    const fixture = await createFixture();
    const originalSave = fixture.database.saveQuarantineRecord.bind(
      fixture.database,
    );
    let saveCount = 0;
    const saveSpy = vi
      .spyOn(fixture.database, "saveQuarantineRecord")
      .mockImplementation((record) => {
        saveCount += 1;
        if (saveCount === 3) {
          throw new Error("simulated SQLite journal failure");
        }
        originalSave(record);
      });

    const preview = await previewSingleSet(fixture.manager);
    const result = await fixture.manager.executeDeletion(
      preview.previewId,
      preview.confirmationPhrase,
    );

    expect(result.status).toBe("queued");
    expect(result.message).toContain("Do not retry this deletion");
    expect(
      await pending(join(fixture.root, "client.realm"), fixture.setId),
    ).toBe(true);
    const manifest = JSON.parse(
      await readFile(join(result.backupPath, "manifest.json"), "utf8"),
    ) as { status: string };
    expect(manifest.status).toBe("queued");
    expect(
      fixture.database.getQuarantineRecord(result.operationId)?.status,
    ).toBe("queued");
    saveSpy.mockRestore();
    fixture.database.close();
  }, 30_000);

  it("keeps an ambiguous committed write ready for startup reconciliation", async () => {
    const fixture = await createFixture();
    const realmPath = join(fixture.root, "client.realm");
    const originalOpen = Realm.open.bind(Realm);
    let liveWritableOpens = 0;
    const openSpy = vi.spyOn(Realm, "open").mockImplementation((config) => {
      if (typeof config !== "string" && config.path === realmPath) {
        if (config.readOnly) {
          return Promise.reject(
            new Error("simulated reopen verification failure"),
          ) as ReturnType<typeof Realm.open>;
        }
        liveWritableOpens += 1;
        if (liveWritableOpens > 1) {
          return Promise.reject(
            new Error("simulated rollback open failure"),
          ) as ReturnType<typeof Realm.open>;
        }
      }
      return originalOpen(config);
    });

    const preview = await previewSingleSet(fixture.manager);
    await expect(
      fixture.manager.executeDeletion(
        preview.previewId,
        preview.confirmationPhrase,
      ),
    ).rejects.toThrow("could not pass reopen verification or be rolled back");
    openSpy.mockRestore();

    expect(await pending(realmPath, fixture.setId)).toBe(true);
    const [record] = fixture.database.getQuarantineRecords();
    expect(record?.status).toBe("ready");
    const manifest = JSON.parse(
      await readFile(join(record!.backupPath, "manifest.json"), "utf8"),
    ) as { status: string };
    expect(manifest.status).toBe("ready");
    fixture.database.close();
  }, 30_000);

  it("refuses restore when the manifest belongs to another operation", async () => {
    const fixture = await createFixture();
    const preview = await previewSingleSet(fixture.manager);
    const result = await fixture.manager.executeDeletion(
      preview.previewId,
      preview.confirmationPhrase,
    );
    const manifestPath = join(result.backupPath, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      operationId: string;
    };
    manifest.operationId = "different-operation";
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    await expect(
      fixture.manager.restoreQuarantine(result.operationId),
    ).rejects.toThrow("does not match its manifest");
    expect(
      await pending(join(fixture.root, "client.realm"), fixture.setId),
    ).toBe(true);
    fixture.database.close();
  }, 30_000);

  it("refuses restore unless every target remains DeletePending", async () => {
    const fixture = await createFixture();
    const realmPath = join(fixture.root, "client.realm");
    const preview = await previewSingleSet(fixture.manager);
    const result = await fixture.manager.executeDeletion(
      preview.previewId,
      preview.confirmationPhrase,
    );
    await setPending(realmPath, fixture.setId, false);

    await expect(
      fixture.manager.restoreQuarantine(result.operationId),
    ).rejects.toThrow("Not every target set is still pending deletion");
    expect(await pending(realmPath, fixture.setId)).toBe(false);
    fixture.database.close();
  }, 30_000);
});
