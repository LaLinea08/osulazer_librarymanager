import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from "node:path";
import { promisify } from "node:util";
import Realm from "realm";
import type {
  BeatmapDifficulty,
  BeatmapStatus,
  GameMode,
  LibraryCandidate,
  LibraryCapabilities,
  ScanProgress,
} from "../shared/contracts";

const executeFile = promisify(execFile);
export const VERIFIED_SCHEMA_VERSION = 51;
const REQUIRED_SCHEMA: Record<string, string[]> = {
  BeatmapSet: [
    "ID",
    "OnlineID",
    "DateAdded",
    "Beatmaps",
    "Files",
    "DeletePending",
    "Protected",
  ],
  Beatmap: [
    "ID",
    "DifficultyName",
    "Ruleset",
    "Difficulty",
    "Metadata",
    "BeatmapSet",
    "OnlineID",
    "Length",
    "BPM",
    "Hash",
    "StarRating",
    "LastPlayed",
    "Hidden",
  ],
  File: ["Hash"],
  RealmNamedFileUsage: ["File", "Filename"],
  Score: ["BeatmapInfo", "BeatmapHash"],
};

const protectedWriteCapabilities: LibraryCapabilities = {
  adapter: `osu!lazer Realm schema ${VERIFIED_SCHEMA_VERSION}`,
  readMetadata: true,
  readCollections: true,
  readPlayHistory: true,
  accurateStorage: true,
  writeLibrary: true,
  limitations: [
    "Protected writes are limited to osu!lazer’s whole-set DeletePending flag while the game is closed.",
    "Hashed resources are never deleted or moved directly; osu!lazer performs its normal reference-aware cleanup on its next start.",
    "Local score count is available, but osu!lazer does not persist every play attempt as a play counter.",
    "Storage values are logical set sizes; resources may be shared, so they are not deletion-recovery estimates.",
    "Star ratings reflect osu!lazer’s persisted base value and may be unavailable or differ under rulesets and mods.",
  ],
};

export const unavailableCapabilities: LibraryCapabilities = {
  adapter: "No verified library adapter",
  readMetadata: false,
  readCollections: false,
  readPlayHistory: false,
  accurateStorage: false,
  writeLibrary: false,
  limitations: [
    `Fresh indexing is enabled only for verified osu!lazer Realm schema ${VERIFIED_SCHEMA_VERSION}.`,
    "Cached library data remains available if a future osu!lazer version is not yet compatible.",
    "Deletion remains unavailable until a fresh scan verifies the supported schema and stable local set identifiers.",
  ],
};

export interface RealmScanResult {
  records: BeatmapDifficulty[];
  capabilities: LibraryCapabilities;
  schemaVersion: number;
  missingResources: number;
  collectionCount: number;
  sourceFingerprint: string;
}

type DynamicObject = Record<string, unknown>;

export class LibraryIntegrationError extends Error {
  public constructor(
    public readonly code:
      | "INVALID_LIBRARY"
      | "OSU_RUNNING"
      | "UNSUPPORTED_SCHEMA"
      | "SOURCE_CHANGED"
      | "SCAN_CANCELLED",
    message: string,
  ) {
    super(message);
    this.name = "LibraryIntegrationError";
  }
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new LibraryIntegrationError(
      "SCAN_CANCELLED",
      "The library scan was cancelled. Your previous index is unchanged.",
    );
  }
}

export function normalizedRoot(input: string): string {
  const candidate = normalize(resolve(input));
  return basename(candidate).toLowerCase() === "files"
    ? dirname(candidate)
    : candidate;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function inspectLibraryCandidate(
  input: string,
  source: LibraryCandidate["source"],
): Promise<LibraryCandidate> {
  const path = normalizedRoot(input);
  const hasRealmDatabase = await isFile(join(path, "client.realm"));
  const hasFileStore = await isDirectory(join(path, "files"));
  return {
    path,
    displayPath: path,
    source,
    hasRealmDatabase,
    hasFileStore,
    confidence:
      hasRealmDatabase && hasFileStore
        ? "high"
        : hasRealmDatabase || hasFileStore
          ? "medium"
          : "low",
  };
}

async function customStoragePath(defaultRoot: string): Promise<string | null> {
  try {
    const configuration = await readFile(
      join(defaultRoot, "storage.ini"),
      "utf8",
    );
    const match = configuration.match(/^FullPath\s*=\s*(.+?)\s*$/im);
    if (!match?.[1]) return null;
    const path = match[1].trim().replace(/^"|"$/g, "");
    return isAbsolute(path) ? path : resolve(defaultRoot, path);
  } catch {
    return null;
  }
}

export async function detectLibraryCandidates(): Promise<LibraryCandidate[]> {
  const candidates: string[] = [];
  const appData = process.env.APPDATA;
  const defaultRoot = appData
    ? join(appData, "osu")
    : join(homedir(), "AppData", "Roaming", "osu");
  const customRoot = await customStoragePath(defaultRoot);
  if (customRoot) candidates.push(customRoot);
  candidates.push(defaultRoot);

  const unique = [
    ...new Set(candidates.map((path) => normalizedRoot(path).toLowerCase())),
  ];
  const inspected = await Promise.all(
    unique.map(async (lowerPath) => {
      const original =
        candidates.find(
          (path) => normalizedRoot(path).toLowerCase() === lowerPath,
        ) ?? lowerPath;
      return inspectLibraryCandidate(original, "automatic");
    }),
  );
  return inspected.filter(
    (candidate) => candidate.hasRealmDatabase || candidate.hasFileStore,
  );
}

export async function isOsuRunningStrict(): Promise<boolean> {
  if (platform() === "win32") {
    const { stdout } = await executeFile("tasklist.exe", ["/FO", "CSV", "/NH"]);
    return stdout
      .split(/\r?\n/)
      .some((line) => /^"(?:osu!|osu|osulazer)\.exe"/i.test(line.trim()));
  }
  const { stdout } = await executeFile("ps", ["-A", "-o", "comm="]);
  return stdout
    .split(/\r?\n/)
    .some((name) => /^(osu!|osu|osulazer)$/i.test(name.trim()));
}

export async function isOsuRunning(): Promise<boolean> {
  try {
    return await isOsuRunningStrict();
  } catch {
    // Read-only status surfaces may treat an unavailable process list as
    // "unknown/offline". Protected writes use isOsuRunningStrict instead.
    return false;
  }
}

function list(value: unknown): DynamicObject[] {
  if (!value || typeof value !== "object" || !(Symbol.iterator in value))
    return [];
  return Array.from(value as Iterable<unknown>).filter(
    (item): item is DynamicObject => item !== null && typeof item === "object",
  );
}

function strings(value: unknown): string[] {
  if (!value || typeof value !== "object" || !(Symbol.iterator in value))
    return [];
  return Array.from(value as Iterable<unknown>).map(String);
}

function object(value: unknown): DynamicObject | null {
  return value !== null && typeof value === "object"
    ? (value as DynamicObject)
    : null;
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveOnlineId(value: unknown): number | null {
  const id = number(value, -1);
  return id > 0 ? Math.trunc(id) : null;
}

function date(value: unknown): string | null {
  return value instanceof Date && Number.isFinite(value.getTime())
    ? value.toISOString()
    : null;
}

export function realmIdentifier(value: unknown, fallback = ""): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value && typeof value === "object" && "toHexString" in value) {
    const method = (value as { toHexString?: unknown }).toHexString;
    if (typeof method === "function") {
      const result: unknown = method.call(value);
      if (typeof result === "string") return result;
    }
  }
  return fallback;
}

function modeFromRuleset(ruleset: DynamicObject | null): GameMode {
  const shortName = string(ruleset?.ShortName).toLowerCase();
  if (shortName === "osu") return "osu";
  if (shortName === "taiko") return "taiko";
  if (shortName === "fruits" || shortName === "catch") return "catch";
  if (shortName === "mania") return "mania";
  return "unknown";
}

function statusFromNumber(value: unknown): BeatmapStatus {
  const status = number(value, -3);
  if (status === -2) return "graveyard";
  if (status === -1) return "wip";
  if (status === 0) return "pending";
  if (status === 1) return "ranked";
  if (status === 2) return "approved";
  if (status === 3) return "qualified";
  if (status === 4) return "loved";
  return "unknown";
}

export function hashPath(fileStore: string, hash: string): string {
  return join(fileStore, hash.slice(0, 1), hash.slice(0, 2), hash);
}

export async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) digest.update(chunk as Buffer);
  return digest.digest("hex");
}

async function collectResourceSizes(
  fileStore: string,
  hashes: Set<string>,
  signal: AbortSignal,
  onProgress: (progress: ScanProgress) => void,
): Promise<{ sizes: Map<string, number>; missing: number }> {
  const values = [...hashes];
  const sizes = new Map<string, number>();
  let cursor = 0;
  let missing = 0;

  const worker = async (): Promise<void> => {
    while (cursor < values.length) {
      abortIfNeeded(signal);
      const index = cursor;
      cursor += 1;
      const hash = values[index];
      if (!hash) continue;
      try {
        sizes.set(hash, (await stat(hashPath(fileStore, hash))).size);
      } catch {
        sizes.set(hash, 0);
        missing += 1;
      }
      if (index % 500 === 0) {
        onProgress({
          phase: "parsing",
          processed: index,
          discovered: values.length,
          imported: 0,
          skipped: missing,
          message: `Checking ${values.length.toLocaleString()} referenced resources…`,
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(24, Math.max(1, values.length)) }, () =>
      worker(),
    ),
  );
  return { sizes, missing };
}

export function validateSchema(realm: Realm, schemaVersion: number): void {
  if (schemaVersion !== VERIFIED_SCHEMA_VERSION) {
    throw new LibraryIntegrationError(
      "UNSUPPORTED_SCHEMA",
      `This osu!lazer library uses Realm schema ${schemaVersion}; only verified schema ${VERIFIED_SCHEMA_VERSION} can be freshly indexed. The previous cache has been preserved.`,
    );
  }

  const schemaByName = new Map(
    realm.schema.map((schema) => [schema.name, schema]),
  );
  for (const [name, requiredProperties] of Object.entries(REQUIRED_SCHEMA)) {
    const schema = schemaByName.get(name);
    if (!schema) {
      throw new LibraryIntegrationError(
        "UNSUPPORTED_SCHEMA",
        `Required Realm object “${name}” is unavailable.`,
      );
    }
    const properties = new Set(Object.keys(schema.properties));
    const missing = requiredProperties.filter(
      (property) => !properties.has(property),
    );
    if (missing.length > 0) {
      throw new LibraryIntegrationError(
        "UNSUPPORTED_SCHEMA",
        `Realm object “${name}” is missing required properties: ${missing.join(", ")}.`,
      );
    }
  }
}

async function createSnapshot(
  libraryRoot: string,
  snapshotBase: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const source = join(libraryRoot, "client.realm");
  if (
    !(await isFile(source)) ||
    !(await isDirectory(join(libraryRoot, "files")))
  ) {
    throw new LibraryIntegrationError(
      "INVALID_LIBRARY",
      "Choose the osu!lazer data folder that contains both client.realm and files.",
    );
  }
  if (await isOsuRunning()) {
    throw new LibraryIntegrationError(
      "OSU_RUNNING",
      "Close osu!lazer before starting a fresh scan. Your last successful cached index remains available.",
    );
  }

  const before = await stat(source);
  const snapshotDirectory = join(snapshotBase, randomUUID());
  const snapshotPath = join(snapshotDirectory, "client.realm");
  await mkdir(snapshotDirectory, { recursive: true });
  await copyFile(source, snapshotPath);
  const after = await stat(source);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    (await isOsuRunning())
  ) {
    await rm(snapshotDirectory, { recursive: true, force: true });
    throw new LibraryIntegrationError(
      "SOURCE_CHANGED",
      "osu!lazer’s database changed while the safety snapshot was being created. Close osu!lazer and retry.",
    );
  }

  return {
    path: snapshotPath,
    cleanup: async () => {
      const base = resolve(snapshotBase);
      const target = resolve(snapshotDirectory);
      const inside = relative(base, target);
      if (inside && !inside.startsWith("..") && !isAbsolute(inside)) {
        await rm(target, { recursive: true, force: true });
      }
    },
  };
}

export async function scanRealmLibrary(
  libraryRootInput: string,
  snapshotBase: string,
  signal: AbortSignal,
  onProgress: (progress: ScanProgress) => void,
): Promise<RealmScanResult> {
  const libraryRoot = normalizedRoot(libraryRootInput);
  onProgress({
    phase: "discovering",
    processed: 0,
    discovered: 0,
    imported: 0,
    skipped: 0,
    message: "Creating a verified read-only database snapshot…",
  });
  abortIfNeeded(signal);
  const snapshot = await createSnapshot(libraryRoot, snapshotBase);

  try {
    abortIfNeeded(signal);
    const schemaVersion = Realm.schemaVersion(snapshot.path);
    const realm = await Realm.open({
      path: snapshot.path,
      readOnly: true,
      disableFormatUpgrade: true,
    });

    try {
      validateSchema(realm, schemaVersion);
      const scoreCounts = new Map<string, number>();
      for (const rawScore of realm.objects("Score")) {
        const score = rawScore as unknown as DynamicObject;
        const linkedBeatmap = object(score.BeatmapInfo);
        const linkedId = linkedBeatmap ? realmIdentifier(linkedBeatmap.ID) : "";
        const hash = string(score.BeatmapHash).toLowerCase();
        // Keep both identities. Some score rows have only one link populated,
        // and mixed historical data can otherwise hide set-level evidence.
        for (const key of new Set([linkedId, hash].filter(Boolean))) {
          scoreCounts.set(key, (scoreCounts.get(key) ?? 0) + 1);
        }
      }

      const draftRecords: Array<
        BeatmapDifficulty & { setKey: string; resourceHashes: string[] }
      > = [];
      const allResourceHashes = new Set<string>();
      const sets = realm.objects("BeatmapSet");

      for (let setIndex = 0; setIndex < sets.length; setIndex += 1) {
        abortIfNeeded(signal);
        const set = sets[setIndex] as unknown as DynamicObject;
        if (set.DeletePending) continue;
        const setKey = realmIdentifier(set.ID, randomUUID());
        const setBeatmaps = list(set.Beatmaps);
        const setDifficultyCount = setBeatmaps.length;
        const setHasRecordedPlay = setBeatmaps.some((beatmap) => {
          const id = realmIdentifier(beatmap.ID);
          const hash = string(beatmap.Hash).toLowerCase();
          return (
            (beatmap.LastPlayed !== null && beatmap.LastPlayed !== undefined) ||
            (id ? (scoreCounts.get(id) ?? 0) > 0 : false) ||
            (hash ? (scoreCounts.get(hash) ?? 0) > 0 : false)
          );
        });
        const resources = list(set.Files);
        const filenameToHash = new Map<string, string>();
        const resourceHashes = new Set<string>();
        let containsVideo = false;

        for (const usage of resources) {
          const file = object(usage.File);
          const hash = string(file?.Hash).toLowerCase();
          const filename = string(usage.Filename);
          if (!hash) continue;
          resourceHashes.add(hash);
          allResourceHashes.add(hash);
          if (filename) filenameToHash.set(filename.toLowerCase(), hash);
          if (/\.(?:avi|flv|m4v|mkv|mov|mp4|webm|wmv)$/i.test(filename))
            containsVideo = true;
        }

        for (const rawBeatmap of setBeatmaps) {
          const beatmap = rawBeatmap;
          if (beatmap.Hidden) continue;
          const metadata = object(beatmap.Metadata);
          const difficulty = object(beatmap.Difficulty);
          const author = object(metadata?.Author);
          const hash = string(beatmap.Hash).toLowerCase();
          const id = realmIdentifier(
            beatmap.ID,
            `${setKey}:${hash || randomUUID()}`,
          );
          const background = string(metadata?.BackgroundFile);
          const userTags = strings(metadata?.UserTags);
          const rawStarRating = number(beatmap.StarRating, -1);
          const scoreKey = realmIdentifier(beatmap.ID);
          const scoreHashKey = hash;

          draftRecords.push({
            id,
            beatmapId: positiveOnlineId(beatmap.OnlineID),
            beatmapSetId: positiveOnlineId(set.OnlineID),
            beatmapSetLocalId: setKey,
            setProtected: Boolean(set.Protected),
            setDifficultyCount,
            setHasRecordedPlay,
            artist: string(metadata?.Artist, "Unknown artist"),
            title: string(metadata?.Title, "Unknown title"),
            difficultyName: string(
              beatmap.DifficultyName,
              "Unnamed difficulty",
            ),
            mapper: string(
              author?.Username,
              string(author?.Name, "Unknown mapper"),
            ),
            mode: modeFromRuleset(object(beatmap.Ruleset)),
            status: statusFromNumber(beatmap.Status ?? set.Status),
            bpm: number(beatmap.BPM) > 0 ? number(beatmap.BPM) : null,
            durationSeconds:
              number(beatmap.Length) > 0 ? number(beatmap.Length) / 1000 : null,
            starRating: rawStarRating >= 0 ? rawStarRating : null,
            approachRate: difficulty ? number(difficulty.ApproachRate) : null,
            overallDifficulty: difficulty
              ? number(difficulty.OverallDifficulty)
              : null,
            circleSize: difficulty ? number(difficulty.CircleSize) : null,
            hpDrain: difficulty ? number(difficulty.DrainRate) : null,
            source: string(metadata?.Source),
            tags: [string(metadata?.Tags), ...userTags]
              .filter(Boolean)
              .join(" "),
            audioFilename: string(metadata?.AudioFile) || null,
            hasBackground: background
              ? filenameToHash.has(background.toLowerCase())
              : false,
            hasVideo: containsVideo,
            rankedAt: date(set.DateRanked),
            importedAt: date(set.DateAdded),
            lastPlayedAt: date(beatmap.LastPlayed),
            localPlayCount: null,
            localScoreCount: Math.max(
              scoreCounts.get(scoreKey) ?? 0,
              scoreCounts.get(scoreHashKey) ?? 0,
            ),
            storageBytes: null,
            contentHash: hash,
            setKey,
            resourceHashes: [...resourceHashes],
          });
        }

        if (setIndex % 100 === 0) {
          onProgress({
            phase: "parsing",
            processed: setIndex,
            discovered: sets.length,
            imported: draftRecords.length,
            skipped: 0,
            message: `Reading metadata from ${sets.length.toLocaleString()} beatmap sets…`,
          });
          await new Promise<void>((resolvePromise) =>
            setImmediate(resolvePromise),
          );
        }
      }

      const collectionCount = realm.objects("BeatmapCollection").length;
      realm.close();

      onProgress({
        phase: "parsing",
        processed: draftRecords.length,
        discovered: draftRecords.length,
        imported: draftRecords.length,
        skipped: 0,
        message: "Fingerprinting the verified Realm snapshot…",
      });
      const sourceFingerprint = await sha256File(snapshot.path);
      abortIfNeeded(signal);

      const { sizes, missing } = await collectResourceSizes(
        join(libraryRoot, "files"),
        allResourceHashes,
        signal,
        onProgress,
      );
      const setSizes = new Map<string, number>();
      for (const record of draftRecords) {
        if (setSizes.has(record.setKey)) continue;
        const size = record.resourceHashes.reduce(
          (sum, hash) => sum + (sizes.get(hash) ?? 0),
          0,
        );
        setSizes.set(record.setKey, size);
      }

      const records: BeatmapDifficulty[] = draftRecords.map(
        ({ setKey, resourceHashes, ...record }) => {
          void resourceHashes;
          return { ...record, storageBytes: setSizes.get(setKey) ?? 0 };
        },
      );

      onProgress({
        phase: "indexing",
        processed: records.length,
        discovered: records.length,
        imported: records.length,
        skipped: missing,
        message: "Committing the new index atomically…",
      });

      return {
        records,
        capabilities: protectedWriteCapabilities,
        schemaVersion,
        missingResources: missing,
        collectionCount,
        sourceFingerprint,
      };
    } finally {
      if (!realm.isClosed) realm.close();
    }
  } finally {
    await snapshot.cleanup();
  }
}
