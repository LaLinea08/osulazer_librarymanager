import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import Realm from "realm";
import { ZipFile } from "yazl";
import { openPromise as openZip } from "yauzl";
import type {
  DeletionBackupManifest,
  DeletionBackupResource,
  DeletionBackupSet,
  DeletionPolicy,
  DeletionPreview,
  DeletionResult,
  LibraryQuery,
  QuarantineRecord,
  SerializableSelection,
} from "../shared/contracts";
import { BUILD_INFO } from "../shared/build-info.generated";
import type { AppDatabase, ResolvedDeletionSet } from "./database";
import {
  hashPath,
  isOsuRunningStrict,
  normalizedRoot,
  realmIdentifier,
  sha256File,
  validateSchema,
  VERIFIED_SCHEMA_VERSION,
} from "./library-integration";

const PREVIEW_LIFETIME_MS = 10 * 60 * 1000;
const DISK_SAFETY_MARGIN_BYTES = 256 * 1024 * 1024;
const MANIFEST_NAME = "manifest.json";

type DynamicObject = Record<string, unknown>;

interface DeletionPlan {
  preview: DeletionPreview;
  libraryPath: string;
  sets: ResolvedDeletionSet[];
  protectPlayedSets: boolean;
}

class SourceMutationError extends Error {
  public constructor(
    message: string,
    public readonly sourceState: "rolled-back" | "uncertain",
  ) {
    super(message);
    this.name = "SourceMutationError";
  }
}

export interface DeletionManagerOptions {
  database: () => AppDatabase;
  quarantineRoot: string;
  gameIsRunning?: () => Promise<boolean>;
}

function dynamicObject(value: unknown): DynamicObject | null {
  return value !== null && typeof value === "object"
    ? (value as DynamicObject)
    : null;
}

function dynamicList(value: unknown): DynamicObject[] {
  if (!value || typeof value !== "object" || !(Symbol.iterator in value)) {
    return [];
  }
  return Array.from(value as Iterable<unknown>).filter(
    (item): item is DynamicObject => item !== null && typeof item === "object",
  );
}

function hasRecordedPlayInTargets(
  realm: Realm,
  targets: DynamicObject[],
): boolean {
  const targetIds = new Set<string>();
  const targetHashes = new Set<string>();
  for (const set of targets) {
    for (const beatmap of dynamicList(set.Beatmaps)) {
      const id = realmIdentifier(beatmap.ID);
      const hash =
        typeof beatmap.Hash === "string" ? beatmap.Hash.toLowerCase() : "";
      if (beatmap.LastPlayed !== null && beatmap.LastPlayed !== undefined) {
        return true;
      }
      if (id) targetIds.add(id);
      if (hash) targetHashes.add(hash);
    }
  }

  for (const value of realm.objects("Score")) {
    const score = value as unknown as DynamicObject;
    const beatmap = dynamicObject(score.BeatmapInfo);
    const id = beatmap ? realmIdentifier(beatmap.ID) : "";
    const hash =
      typeof score.BeatmapHash === "string"
        ? score.BeatmapHash.toLowerCase()
        : "";
    if (
      (id !== "" && targetIds.has(id)) ||
      (hash !== "" && targetHashes.has(hash))
    ) {
      return true;
    }
  }
  return false;
}

function cleanError(error: unknown): string {
  return error instanceof Error ? error.message : "An unknown error occurred.";
}

function assertInside(baseInput: string, targetInput: string): void {
  const base = resolve(baseInput);
  const target = resolve(targetInput);
  const inside = relative(base, target);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) {
    throw new Error(
      "The safety-backup path escaped its application directory.",
    );
  }
}

function resourceRelativePath(hash: string): string {
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(
      `A referenced resource has an invalid SHA-256 key: ${hash}`,
    );
  }
  return join("blobs", hash.slice(0, 1), hash.slice(0, 2), hash);
}

function archiveFilename(filename: string): string {
  const normalized = filename.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.endsWith("/") ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => part === "..") ||
    Buffer.byteLength(normalized, "utf8") > 0xffff
  ) {
    throw new Error(
      `A selected set contains an unsafe archive filename: ${filename || "(empty)"}`,
    );
  }
  return normalized;
}

async function hashReadable(
  stream: NodeJS.ReadableStream,
): Promise<{ hash: string; size: number }> {
  const digest = createHash("sha256");
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    digest.update(buffer);
    size += buffer.length;
  }
  return { hash: digest.digest("hex"), size };
}

function toRecord(
  manifest: DeletionBackupManifest,
  backupPath: string,
): QuarantineRecord {
  const queued = manifest.status === "queued";
  return {
    operationId: manifest.operationId,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    libraryPath: manifest.libraryPath,
    status: manifest.status,
    summary:
      manifest.status === "restored"
        ? `Restored ${manifest.affectedSets.toLocaleString()} queued set${manifest.affectedSets === 1 ? "" : "s"}`
        : `Safety backup for ${manifest.affectedSets.toLocaleString()} set${manifest.affectedSets === 1 ? "" : "s"}`,
    affectedDifficulties: manifest.affectedDifficulties,
    affectedSets: manifest.affectedSets,
    logicalBytes: manifest.logicalBytes,
    uniqueBackupBytes: manifest.uniqueBackupBytes,
    backupPath,
    sourceFingerprint: manifest.sourceFingerprint,
    postMutationFingerprint: manifest.postMutationFingerprint,
    canRestore: queued,
    restoreBlockedReason: queued
      ? null
      : manifest.status === "finalized"
        ? "osu! has already finalized at least part of this deletion. The backup is retained for manual recovery."
        : "Only a queued deletion can be restored automatically.",
    details: manifest.details,
  };
}

export class DeletionManager {
  private readonly plans = new Map<string, DeletionPlan>();
  private readonly database: () => AppDatabase;
  private readonly quarantineRoot: string;
  private readonly gameIsRunning: () => Promise<boolean>;

  public constructor(options: DeletionManagerOptions) {
    this.database = options.database;
    this.quarantineRoot = resolve(options.quarantineRoot);
    this.gameIsRunning = options.gameIsRunning ?? isOsuRunningStrict;
  }

  public async previewDeletion(
    query: LibraryQuery,
    selection: SerializableSelection,
    policy?: DeletionPolicy,
  ): Promise<DeletionPreview> {
    this.expirePlans();
    const db = this.database();
    const protectPlayedSets = policy?.protectPlayedSets !== false;
    const resolution = db.resolveDeletionSelection(query, selection, {
      protectPlayedSets,
    });
    const settings = db.getSettings();
    const blockers = [...resolution.blockers];
    const libraryPath = settings.libraryPath
      ? normalizedRoot(settings.libraryPath)
      : null;
    let estimatedBackupBytes = resolution.logicalBytes * 2;

    if (!libraryPath) blockers.push("Choose an osu!lazer library first.");
    if (
      db.getMeta("realm_schema_version") !== String(VERIFIED_SCHEMA_VERSION)
    ) {
      blockers.push(
        `Run a fresh scan with verified Realm schema ${VERIFIED_SCHEMA_VERSION} before deleting.`,
      );
    }
    try {
      if (await this.gameIsRunning()) {
        blockers.push("Close osu!lazer before preparing a deletion.");
      }
    } catch {
      blockers.push(
        "The app could not verify that osu!lazer is closed. Protected writes are disabled until process detection works.",
      );
    }

    if (libraryPath && resolution.scanFingerprint) {
      try {
        estimatedBackupBytes += (await stat(join(libraryPath, "client.realm")))
          .size;
        await this.assertStableSource(
          join(libraryPath, "client.realm"),
          resolution.scanFingerprint,
        );
      } catch (error) {
        blockers.push(cleanError(error));
      }
    }

    const previewId = randomUUID();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + PREVIEW_LIFETIME_MS);
    const confirmationPhrase = `DELETE ${resolution.affectedSets} ${
      resolution.affectedSets === 1 ? "SET" : "SETS"
    }`;
    const preview: DeletionPreview = {
      previewId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      sourceFingerprint: resolution.scanFingerprint ?? "",
      selectedDifficulties: resolution.selectedDifficulties,
      affectedDifficulties: resolution.affectedDifficulties,
      affectedSets: resolution.affectedSets,
      logicalBytes: resolution.logicalBytes,
      // Exact de-duplication and archive compression are verified from the
      // safety copy; this is a conservative Realm + blobs + archives estimate.
      uniqueBackupBytes: estimatedBackupBytes,
      protectedSets: resolution.protectedSets,
      playedSetsSkipped: resolution.playedSetsSkipped,
      playedDifficultiesSkipped: resolution.playedDifficultiesSkipped,
      examples: resolution.sets.slice(0, 8).map((set) => ({
        beatmapSetId: set.beatmapSetId,
        artist: set.artist,
        title: set.title,
        mapper: set.mapper,
        difficultyCount: set.difficultyCount,
        logicalBytes: set.logicalBytes,
      })),
      blockers: [...new Set(blockers)],
      confirmationPhrase,
      canExecute:
        blockers.length === 0 &&
        resolution.affectedSets > 0 &&
        Boolean(libraryPath && resolution.scanFingerprint),
    };

    if (preview.canExecute && libraryPath) {
      this.plans.set(previewId, {
        preview,
        libraryPath,
        sets: resolution.sets,
        protectPlayedSets,
      });
    }
    return preview;
  }

  public async executeDeletion(
    previewId: string,
    confirmationPhrase: string,
  ): Promise<DeletionResult> {
    this.expirePlans();
    const plan = this.plans.get(previewId);
    if (!plan) {
      throw new Error(
        "This deletion preview expired or is no longer valid. Review the selection again.",
      );
    }
    if (confirmationPhrase !== plan.preview.confirmationPhrase) {
      throw new Error(
        `Type ${plan.preview.confirmationPhrase} exactly to continue.`,
      );
    }
    this.plans.delete(previewId);

    const operationId = randomUUID();
    const operationPath = join(this.quarantineRoot, operationId);
    assertInside(this.quarantineRoot, operationPath);
    await mkdir(operationPath, { recursive: true });

    const now = new Date().toISOString();
    let manifest: DeletionBackupManifest = {
      version: 1,
      appVersion: BUILD_INFO.version,
      realmSchemaVersion: VERIFIED_SCHEMA_VERSION,
      operationId,
      createdAt: now,
      updatedAt: now,
      status: "preparing",
      libraryPath: plan.libraryPath,
      sourceFingerprint: plan.preview.sourceFingerprint,
      postMutationFingerprint: null,
      realmBackupRelativePath: "client.realm",
      affectedDifficulties: plan.preview.affectedDifficulties,
      affectedSets: plan.preview.affectedSets,
      logicalBytes: plan.preview.logicalBytes,
      uniqueBackupBytes: 0,
      sets: plan.sets.map((set, index) => ({
        beatmapSetLocalId: set.beatmapSetLocalId,
        beatmapSetId: set.beatmapSetId,
        artist: set.artist,
        title: set.title,
        mapper: set.mapper,
        difficultyIds: [],
        resources: [],
        archiveRelativePath: join(
          "archives",
          `set-${String(index + 1).padStart(5, "0")}.olz`,
        ),
        archiveSha256: null,
        archiveSize: 0,
      })),
      details:
        "Preparing a verified Realm and resource backup before any source write.",
    };
    await this.saveManifest(operationPath, manifest);
    this.database().saveQuarantineRecord(toRecord(manifest, operationPath));

    let sourceMutationVerified = false;
    try {
      manifest = await this.prepareBackup(plan, operationPath, manifest);
      const gameRemainedClosed = await this.queuePendingDeletion(
        plan,
        manifest,
      );
      sourceMutationVerified = true;

      manifest = {
        ...manifest,
        status: gameRemainedClosed ? "queued" : "finalized",
        updatedAt: new Date().toISOString(),
        details: gameRemainedClosed
          ? "All target sets were queued with osu!lazer’s DeletePending flag. No hashed source resource was moved or deleted."
          : "All flags verified, but osu!lazer opened or its process state became unknown immediately afterward. Automatic restore is disabled and recovery archives are retained.",
      };
      await this.saveManifest(operationPath, manifest);
      this.database().saveQuarantineRecord(toRecord(manifest, operationPath));

      try {
        manifest = {
          ...manifest,
          postMutationFingerprint: await sha256File(
            join(plan.libraryPath, "client.realm"),
          ),
          updatedAt: new Date().toISOString(),
        };
        await this.saveManifest(operationPath, manifest);
        this.database().saveQuarantineRecord(toRecord(manifest, operationPath));
      } catch {
        // The durable manifest already records the successful source mutation.
      }

      this.database().addOperation({
        type: "delete",
        summary: `${manifest.status === "queued" ? "Queued" : "Committed"} ${manifest.affectedSets.toLocaleString()} beatmap set${manifest.affectedSets === 1 ? "" : "s"} for deletion`,
        affectedDifficulties: manifest.affectedDifficulties,
        affectedSets: manifest.affectedSets,
        status: "success",
        details: `Verified recovery backup: ${operationPath}`,
      });
      return this.resultFromManifest(manifest, operationPath, false);
    } catch (error) {
      if (sourceMutationVerified) {
        const warning =
          "The DeletePending flags were committed and verified, but the operation journal could not be fully updated. Do not retry this deletion; the app will reconcile the retained recovery backup on its next start.";
        manifest = {
          ...manifest,
          status: manifest.status === "finalized" ? "finalized" : "queued",
          updatedAt: new Date().toISOString(),
          details: `${manifest.details ?? "The source mutation was verified."} ${warning}`,
        };
        await this.saveManifest(operationPath, manifest).catch(() => undefined);
        try {
          this.database().saveQuarantineRecord(
            toRecord(manifest, operationPath),
          );
        } catch {
          // The manifest and startup reconciliation remain the durable fallback.
        }
        try {
          this.database().addOperation({
            type: "delete",
            summary: "Deletion committed with an incomplete journal update",
            affectedDifficulties: manifest.affectedDifficulties,
            affectedSets: manifest.affectedSets,
            status: "partial",
            details: `${cleanError(error)} Recovery backup: ${operationPath}`,
          });
        } catch {
          // Operation history is informational and must not rewrite source state.
        }
        const result = this.resultFromManifest(manifest, operationPath, false);
        return { ...result, message: `${result.message} ${warning}` };
      }

      const sourceStateUncertain =
        error instanceof SourceMutationError &&
        error.sourceState === "uncertain";
      manifest = {
        ...manifest,
        status: sourceStateUncertain ? "ready" : "failed",
        updatedAt: new Date().toISOString(),
        details: cleanError(error),
      };
      await this.saveManifest(operationPath, manifest).catch(() => undefined);
      try {
        this.database().saveQuarantineRecord(toRecord(manifest, operationPath));
      } catch {
        // Startup reconciliation can rebuild the SQLite record from manifest.
      }
      try {
        this.database().addOperation({
          type: "delete",
          summary: sourceStateUncertain
            ? "Deletion state requires safety reconciliation"
            : "Deletion stopped by the safety layer",
          affectedDifficulties: sourceStateUncertain
            ? manifest.affectedDifficulties
            : 0,
          affectedSets: sourceStateUncertain ? manifest.affectedSets : 0,
          status: sourceStateUncertain ? "partial" : "blocked",
          details: cleanError(error),
        });
      } catch {
        // Operation history is informational and must not mask the root error.
      }
      throw error;
    }
  }

  public getQuarantineRecords(): QuarantineRecord[] {
    return this.database().getQuarantineRecords();
  }

  public async restoreQuarantine(operationId: string): Promise<DeletionResult> {
    const db = this.database();
    const record = db.getQuarantineRecord(operationId);
    if (!record) throw new Error("That quarantine record no longer exists.");
    if (record.status !== "queued" || !record.canRestore) {
      throw new Error(
        record.restoreBlockedReason ??
          "This deletion can no longer be restored automatically.",
      );
    }
    if (await this.gameIsRunning()) {
      throw new Error("Close osu!lazer before restoring queued sets.");
    }

    const manifest = await this.readManifest(record.backupPath);
    if (
      record.operationId !== operationId ||
      manifest.operationId !== operationId
    ) {
      throw new Error("The quarantine record does not match its manifest.");
    }
    const configured = db.getSettings().libraryPath;
    if (!configured || normalizedRoot(configured) !== manifest.libraryPath) {
      throw new Error(
        "The configured osu!lazer library does not match this safety backup.",
      );
    }

    const source = join(manifest.libraryPath, "client.realm");
    const beforeRestoreFingerprint = await sha256File(source);
    const restoreBackupName = `pre-restore-${randomUUID()}.realm`;
    const restoreBackupPath = join(record.backupPath, restoreBackupName);
    assertInside(record.backupPath, restoreBackupPath);
    await copyFile(source, restoreBackupPath);
    if ((await sha256File(restoreBackupPath)) !== beforeRestoreFingerprint) {
      throw new Error(
        "The pre-restore Realm backup did not verify; nothing was changed.",
      );
    }
    if (await this.gameIsRunning()) {
      throw new Error(
        "osu!lazer opened while the pre-restore backup was being created; nothing was changed.",
      );
    }

    const targetIds = new Set(
      manifest.sets.map((set) => set.beatmapSetLocalId),
    );
    const realm = await Realm.open({
      path: source,
      disableFormatUpgrade: true,
    });
    try {
      validateSchema(realm, Realm.schemaVersion(source));
      const targets = Array.from(realm.objects("BeatmapSet"))
        .map((value) => value as unknown as DynamicObject)
        .filter((set) => targetIds.has(realmIdentifier(set.ID)));
      if (targets.length !== targetIds.size) {
        const updatedManifest: DeletionBackupManifest = {
          ...manifest,
          status: "finalized",
          updatedAt: new Date().toISOString(),
          details:
            "At least one queued set no longer exists in Realm. osu! likely finalized cleanup; automatic restore was not attempted.",
        };
        await this.saveManifest(record.backupPath, updatedManifest);
        db.saveQuarantineRecord(toRecord(updatedManifest, record.backupPath));
        return this.resultFromManifest(
          updatedManifest,
          record.backupPath,
          false,
        );
      }
      if (targets.some((set) => set.DeletePending !== true)) {
        throw new Error(
          "Not every target set is still pending deletion. Nothing was changed; restart the manager with osu!lazer closed so the safety journal can reconcile the current Realm state.",
        );
      }
      if (await this.gameIsRunning()) {
        throw new Error(
          "osu!lazer opened before restore; nothing was changed.",
        );
      }
      realm.write(() => {
        for (const set of targets) set.DeletePending = false;
      });
      if (targets.some((set) => set.DeletePending !== false)) {
        throw new Error("Realm did not persist every restore flag.");
      }
    } finally {
      if (!realm.isClosed) realm.close();
    }

    const restoredManifest: DeletionBackupManifest = {
      ...manifest,
      status: "restored",
      updatedAt: new Date().toISOString(),
      postMutationFingerprint: await sha256File(source),
      details: `DeletePending was cleared for every target set. Pre-restore Realm copy: ${restoreBackupName}`,
    };
    await this.saveManifest(record.backupPath, restoredManifest);
    db.saveQuarantineRecord(toRecord(restoredManifest, record.backupPath));
    db.addOperation({
      type: "restore",
      summary: `Restored ${restoredManifest.affectedSets.toLocaleString()} queued beatmap set${restoredManifest.affectedSets === 1 ? "" : "s"}`,
      affectedDifficulties: restoredManifest.affectedDifficulties,
      affectedSets: restoredManifest.affectedSets,
      status: "success",
      details: `Safety backup retained at ${record.backupPath}`,
    });
    return this.resultFromManifest(restoredManifest, record.backupPath, false);
  }

  public async reconcileManifests(): Promise<void> {
    await mkdir(this.quarantineRoot, { recursive: true });
    const entries = await readdir(this.quarantineRoot, { withFileTypes: true });
    const gameRunning = await this.gameIsRunning().catch(() => true);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const operationPath = join(this.quarantineRoot, entry.name);
      try {
        let manifest = await this.readManifest(operationPath);
        if (manifest.operationId !== entry.name) continue;
        if (manifest.status === "preparing") {
          manifest = {
            ...manifest,
            status: "failed",
            updatedAt: new Date().toISOString(),
            details:
              "The application stopped before the recovery backup was complete. No source write was allowed in this state.",
          };
          await this.saveManifest(operationPath, manifest);
        } else if (
          !gameRunning &&
          (manifest.status === "ready" || manifest.status === "queued")
        ) {
          const reconciled = await this.reconcileManifestState(manifest);
          if (reconciled !== manifest) {
            manifest = reconciled;
            await this.saveManifest(operationPath, manifest);
          }
        }
        this.database().saveQuarantineRecord(toRecord(manifest, operationPath));
      } catch {
        // Ignore unrelated or incomplete directories. They remain on disk.
      }
    }
  }

  private async reconcileManifestState(
    manifest: DeletionBackupManifest,
  ): Promise<DeletionBackupManifest> {
    const ids = new Set(manifest.sets.map((set) => set.beatmapSetLocalId));
    if (ids.size === 0) {
      return {
        ...manifest,
        status: "failed",
        updatedAt: new Date().toISOString(),
        details: "The recovery manifest contains no target sets.",
      };
    }
    const source = join(normalizedRoot(manifest.libraryPath), "client.realm");
    const realm = await Realm.open({
      path: source,
      readOnly: true,
      disableFormatUpgrade: true,
    });
    try {
      validateSchema(realm, Realm.schemaVersion(source));
      const states = Array.from(realm.objects("BeatmapSet"))
        .map((value) => value as unknown as DynamicObject)
        .filter((set) => ids.has(realmIdentifier(set.ID)))
        .map((set) => Boolean(set.DeletePending));
      if (states.length !== ids.size) {
        return {
          ...manifest,
          status: "finalized",
          updatedAt: new Date().toISOString(),
          details:
            "At least one target Realm row no longer exists. Automatic restore is disabled; verified .olz archives are retained for re-import.",
        };
      }
      const pendingCount = states.filter(Boolean).length;
      if (pendingCount === states.length) {
        if (manifest.status === "queued") return manifest;
        return {
          ...manifest,
          status: "queued",
          updatedAt: new Date().toISOString(),
          details:
            "Recovered an interrupted operation journal: every target DeletePending flag is committed and the verified backup is complete.",
        };
      }
      if (pendingCount === 0) {
        return {
          ...manifest,
          status: manifest.status === "queued" ? "restored" : "failed",
          updatedAt: new Date().toISOString(),
          details:
            manifest.status === "queued"
              ? "No target DeletePending flags remain; the queued operation was restored outside this journal session."
              : "The verified backup completed, but no DeletePending flag was committed before the application stopped.",
        };
      }
      return {
        ...manifest,
        status: "failed",
        updatedAt: new Date().toISOString(),
        details:
          "Only part of the target set group is pending. Keep osu!lazer closed and use the verified recovery files; automatic restore is disabled.",
      };
    } finally {
      if (!realm.isClosed) realm.close();
    }
  }

  private expirePlans(): void {
    const now = Date.now();
    for (const [id, plan] of this.plans) {
      if (Date.parse(plan.preview.expiresAt) <= now) this.plans.delete(id);
    }
  }

  private async assertStableSource(
    source: string,
    expectedFingerprint: string,
  ): Promise<void> {
    if (await this.gameIsRunning()) {
      throw new Error("Close osu!lazer before continuing.");
    }
    const before = await stat(source);
    const fingerprint = await sha256File(source);
    const after = await stat(source);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      fingerprint !== expectedFingerprint
    ) {
      throw new Error(
        "The osu!lazer database changed after the last verified scan. Rescan before deleting.",
      );
    }
    if (await this.gameIsRunning()) {
      throw new Error(
        "osu!lazer opened while the database was being verified. Close it and retry.",
      );
    }
  }

  private async prepareBackup(
    plan: DeletionPlan,
    operationPath: string,
    initialManifest: DeletionBackupManifest,
  ): Promise<DeletionBackupManifest> {
    const sourceRealm = join(plan.libraryPath, "client.realm");
    await this.assertStableSource(sourceRealm, plan.preview.sourceFingerprint);

    let gameAppeared = false;
    let pollActive = false;
    const poll = setInterval(() => {
      if (pollActive) return;
      pollActive = true;
      void this.gameIsRunning()
        .then((running) => {
          if (running) gameAppeared = true;
        })
        .catch(() => {
          // Unknown process state is treated exactly like a detected game for
          // the duration of a protected backup/write workflow.
          gameAppeared = true;
        })
        .finally(() => {
          pollActive = false;
        });
    }, 1000);

    try {
      const realmBackup = join(
        operationPath,
        initialManifest.realmBackupRelativePath,
      );
      assertInside(operationPath, realmBackup);
      await copyFile(sourceRealm, realmBackup);
      const [sourceStat, backupStat] = await Promise.all([
        stat(sourceRealm),
        stat(realmBackup),
      ]);
      if (
        sourceStat.size !== backupStat.size ||
        (await sha256File(realmBackup)) !== plan.preview.sourceFingerprint
      ) {
        throw new Error(
          "The copied Realm fingerprint does not match the verified scan; nothing was changed.",
        );
      }
      if (gameAppeared) {
        throw new Error(
          "osu!lazer opened while the safety backup was being prepared; nothing was changed.",
        );
      }

      const extracted = await this.extractBackupSets(
        realmBackup,
        initialManifest.sets,
      );
      const resources = new Map<string, { source: string; size: number }>();
      for (const set of extracted) {
        for (const resource of set.resources) {
          if (resources.has(resource.hash)) continue;
          const source = hashPath(
            join(plan.libraryPath, "files"),
            resource.hash,
          );
          const sourceStat = await stat(source).catch(() => null);
          if (!sourceStat?.isFile()) {
            throw new Error(
              `Referenced resource ${resource.hash} is missing; nothing was changed.`,
            );
          }
          resources.set(resource.hash, { source, size: sourceStat.size });
        }
      }
      const uniqueBlobBytes = [...resources.values()].reduce(
        (total, resource) => total + resource.size,
        0,
      );
      const disk = await statfs(operationPath);
      const available = Number(disk.bavail) * Number(disk.bsize);
      const requiredFreeBytes = uniqueBlobBytes * 2 + DISK_SAFETY_MARGIN_BYTES;
      if (available < requiredFreeBytes) {
        throw new Error(
          `The verified blob copies and importable .olz archives need at least ${requiredFreeBytes.toLocaleString()} free bytes; nothing was changed.`,
        );
      }

      const values = [...resources.entries()];
      let cursor = 0;
      const copyWorker = async (): Promise<void> => {
        while (cursor < values.length) {
          const index = cursor;
          cursor += 1;
          const item = values[index];
          if (!item) continue;
          const [hash, resource] = item;
          const relativePath = resourceRelativePath(hash);
          const target = join(operationPath, relativePath);
          assertInside(operationPath, target);
          await mkdir(dirname(target), { recursive: true });
          await copyFile(resource.source, target);
          if ((await sha256File(target)) !== hash) {
            throw new Error(
              `Safety-copy verification failed for resource ${hash}; nothing was changed.`,
            );
          }
          if (gameAppeared) {
            throw new Error(
              "osu!lazer opened while resources were being backed up; nothing was changed.",
            );
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(4, Math.max(1, values.length)) }, () =>
          copyWorker(),
        ),
      );

      const sizes = new Map(
        [...resources.entries()].map(([hash, resource]) => [
          hash,
          resource.size,
        ]),
      );
      const completedSets = extracted.map((set) => ({
        ...set,
        resources: set.resources.map((resource) => ({
          ...resource,
          size: sizes.get(resource.hash) ?? 0,
        })),
      }));
      const archivedSets = await this.createAndVerifyArchives(
        operationPath,
        completedSets,
      );
      const actualBackupBytes =
        (await stat(realmBackup)).size +
        uniqueBlobBytes +
        archivedSets.reduce((total, set) => total + set.archiveSize, 0);
      await this.assertStableSource(
        sourceRealm,
        plan.preview.sourceFingerprint,
      );
      if (gameAppeared) {
        throw new Error(
          "osu!lazer opened during backup verification; nothing was changed.",
        );
      }

      const ready: DeletionBackupManifest = {
        ...initialManifest,
        status: "ready",
        updatedAt: new Date().toISOString(),
        uniqueBackupBytes: actualBackupBytes,
        sets: archivedSets,
        details:
          "The Realm copy, every unique target resource, and every importable .olz archive passed content verification. No source write has occurred yet.",
      };
      await this.saveManifest(operationPath, ready);
      this.database().saveQuarantineRecord(toRecord(ready, operationPath));
      return ready;
    } finally {
      clearInterval(poll);
    }
  }

  private async extractBackupSets(
    realmBackup: string,
    plannedSets: DeletionBackupSet[],
  ): Promise<DeletionBackupSet[]> {
    const targetIds = new Set(plannedSets.map((set) => set.beatmapSetLocalId));
    const metadata = new Map(
      plannedSets.map((set) => [set.beatmapSetLocalId, set]),
    );
    const extracted = new Map<string, DeletionBackupSet>();
    const realm = await Realm.open({
      path: realmBackup,
      readOnly: true,
      disableFormatUpgrade: true,
    });
    try {
      validateSchema(realm, Realm.schemaVersion(realmBackup));
      for (const value of realm.objects("BeatmapSet")) {
        const set = value as unknown as DynamicObject;
        const id = realmIdentifier(set.ID);
        if (!targetIds.has(id)) continue;
        if (set.Protected) {
          throw new Error(
            "A target set is protected by osu!lazer; nothing was changed.",
          );
        }
        if (set.DeletePending) {
          throw new Error(
            "A target set is already pending deletion. Rescan before trying again.",
          );
        }
        const base = metadata.get(id);
        if (!base) continue;
        const resources = new Map<string, DeletionBackupResource>();
        for (const usage of dynamicList(set.Files)) {
          const file = dynamicObject(usage.File);
          const hash =
            typeof file?.Hash === "string" ? file.Hash.toLowerCase() : "";
          const filename =
            typeof usage.Filename === "string" ? usage.Filename : "";
          const normalizedFilename = archiveFilename(filename);
          if (resources.has(normalizedFilename)) {
            throw new Error(
              `The set “${base.artist} – ${base.title}” contains a duplicate archive filename; nothing was changed.`,
            );
          }
          const backupRelativePath = resourceRelativePath(hash);
          resources.set(normalizedFilename, {
            hash,
            filename,
            size: 0,
            backupRelativePath,
          });
        }
        extracted.set(id, {
          ...base,
          difficultyIds: dynamicList(set.Beatmaps)
            .map((beatmap) => realmIdentifier(beatmap.ID))
            .filter(Boolean),
          resources: [...resources.values()],
        });
      }
    } finally {
      if (!realm.isClosed) realm.close();
    }
    if (extracted.size !== targetIds.size) {
      throw new Error(
        "The verified Realm copy no longer contains every selected local set. Rescan before deleting.",
      );
    }
    return plannedSets.map((set) => extracted.get(set.beatmapSetLocalId)!);
  }

  private async createAndVerifyArchives(
    operationPath: string,
    sets: DeletionBackupSet[],
  ): Promise<DeletionBackupSet[]> {
    const completed: DeletionBackupSet[] = [];
    for (const set of sets) {
      const expected = new Map<
        string,
        { hash: string; size: number; source: string }
      >();
      for (const resource of set.resources) {
        const filename = archiveFilename(resource.filename);
        if (expected.has(filename)) {
          throw new Error(
            `The set “${set.artist} – ${set.title}” contains the duplicate archive filename “${filename}”; nothing was changed.`,
          );
        }
        const source = join(operationPath, resource.backupRelativePath);
        assertInside(operationPath, source);
        expected.set(filename, {
          hash: resource.hash,
          size: resource.size,
          source,
        });
      }
      if (
        ![...expected.keys()].some(
          (filename) => !filename.includes("/") && /\.osu$/i.test(filename),
        )
      ) {
        throw new Error(
          `The set “${set.artist} – ${set.title}” has no top-level .osu file and cannot be backed up as an importable .olz; nothing was changed.`,
        );
      }

      const archivePath = join(operationPath, set.archiveRelativePath);
      const partialPath = `${archivePath}.partial`;
      assertInside(operationPath, archivePath);
      assertInside(operationPath, partialPath);
      await mkdir(dirname(archivePath), { recursive: true });
      const archive = new ZipFile();
      for (const [filename, resource] of expected) {
        archive.addFile(resource.source, filename, {
          compress: true,
          compressionLevel: 6,
        });
      }
      const output = createWriteStream(partialPath, { flags: "wx" });
      const writing = pipeline(archive.outputStream, output);
      archive.end();
      await writing;

      const opened = await openZip(partialPath, {
        autoClose: false,
        decodeStrings: true,
        lazyEntries: false,
        strictFileNames: true,
        validateEntrySizes: true,
      });
      const seen = new Set<string>();
      try {
        for await (const entry of opened.eachEntry()) {
          if (entry.fileName.endsWith("/")) {
            throw new Error(
              "The recovery archive contains an unexpected directory entry.",
            );
          }
          const wanted = expected.get(entry.fileName);
          if (!wanted || seen.has(entry.fileName)) {
            throw new Error(
              `The recovery archive contains an unexpected or duplicate entry: ${entry.fileName}`,
            );
          }
          const stream = await opened.openReadStreamPromise(entry);
          const actual = await hashReadable(stream);
          if (actual.hash !== wanted.hash || actual.size !== wanted.size) {
            throw new Error(
              `The recovery archive failed content verification for ${entry.fileName}.`,
            );
          }
          seen.add(entry.fileName);
        }
      } finally {
        opened.close();
      }
      if (seen.size !== expected.size) {
        throw new Error(
          `The recovery archive for “${set.artist} – ${set.title}” is incomplete.`,
        );
      }
      await rename(partialPath, archivePath);
      const archiveStat = await stat(archivePath);
      completed.push({
        ...set,
        archiveSha256: await sha256File(archivePath),
        archiveSize: archiveStat.size,
      });
    }
    return completed;
  }

  private async queuePendingDeletion(
    plan: DeletionPlan,
    manifest: DeletionBackupManifest,
  ): Promise<boolean> {
    const source = join(plan.libraryPath, "client.realm");
    await this.assertStableSource(source, plan.preview.sourceFingerprint);
    const ids = new Set(manifest.sets.map((set) => set.beatmapSetLocalId));
    const manifestSets = new Map(
      manifest.sets.map((set) => [set.beatmapSetLocalId, set]),
    );
    const realm = await Realm.open({
      path: source,
      disableFormatUpgrade: true,
    });
    let wrote = false;
    let targets: DynamicObject[] = [];
    try {
      validateSchema(realm, Realm.schemaVersion(source));
      targets = Array.from(realm.objects("BeatmapSet"))
        .map((value) => value as unknown as DynamicObject)
        .filter((set) => ids.has(realmIdentifier(set.ID)));
      if (targets.length !== ids.size) {
        throw new Error(
          "The live Realm no longer contains every selected set; nothing was changed.",
        );
      }
      if (targets.some((set) => Boolean(set.Protected))) {
        throw new Error("A selected set is protected; nothing was changed.");
      }
      if (targets.some((set) => Boolean(set.DeletePending))) {
        throw new Error(
          "A selected set is already pending deletion; nothing was changed.",
        );
      }
      for (const set of targets) {
        const expectedSet = manifestSets.get(realmIdentifier(set.ID));
        if (!expectedSet) {
          throw new Error(
            "A selected set is missing from the verified manifest.",
          );
        }
        const expectedFiles = new Map(
          expectedSet.resources.map((resource) => [
            archiveFilename(resource.filename),
            resource.hash,
          ]),
        );
        const liveFiles = new Map<string, string>();
        for (const usage of dynamicList(set.Files)) {
          const file = dynamicObject(usage.File);
          const filename = archiveFilename(
            typeof usage.Filename === "string" ? usage.Filename : "",
          );
          const hash =
            typeof file?.Hash === "string" ? file.Hash.toLowerCase() : "";
          if (liveFiles.has(filename)) {
            throw new Error("A live target set contains a duplicate filename.");
          }
          liveFiles.set(filename, hash);
        }
        if (
          liveFiles.size !== expectedFiles.size ||
          [...expectedFiles].some(
            ([filename, hash]) => liveFiles.get(filename) !== hash,
          )
        ) {
          throw new Error(
            "A selected set’s file references changed after backup; nothing was changed.",
          );
        }
      }
      // This covers hidden difficulties and score rows, and makes a stale or
      // incomplete cached index fail closed before any source mutation.
      if (plan.protectPlayedSets && hasRecordedPlayInTargets(realm, targets)) {
        throw new Error(
          "A selected set now has a recorded play or score. Nothing was changed; rescan and review the skipped sets.",
        );
      }
      // Keep the strict process check adjacent to the transaction: walking a
      // large Score table above must not widen the game-open race window.
      if (await this.gameIsRunning()) {
        throw new Error(
          "osu!lazer opened before the Realm write; nothing was changed.",
        );
      }
      realm.write(() => {
        for (const set of targets) set.DeletePending = true;
      });
      wrote = true;
      if (targets.some((set) => !set.DeletePending)) {
        throw new Error("Realm did not persist every DeletePending flag.");
      }
    } catch (error) {
      if (!wrote) throw error;

      let gameRunning: boolean;
      try {
        gameRunning = await this.gameIsRunning();
      } catch (processError) {
        throw new SourceMutationError(
          `The DeletePending write could not be verified, and the app could not confirm that osu!lazer stayed closed. The flags may remain committed. Keep the game closed and restart this manager to reconcile the verified backup. Write error: ${cleanError(error)} Process check: ${cleanError(processError)}`,
          "uncertain",
        );
      }
      if (gameRunning) {
        throw new SourceMutationError(
          `osu!lazer opened before the DeletePending write could be verified. The flags may remain committed, so no rollback was attempted against the live game. Keep the recovery backup. Write error: ${cleanError(error)}`,
          "uncertain",
        );
      }

      try {
        realm.write(() => {
          for (const set of targets) set.DeletePending = false;
        });
        if (targets.some((set) => set.DeletePending !== false)) {
          throw new Error("Realm did not persist every rollback flag.", {
            cause: error,
          });
        }
      } catch (rollbackError) {
        throw new SourceMutationError(
          `The DeletePending write could not be verified or rolled back. Keep osu!lazer closed and restart this manager to reconcile the verified backup. Write error: ${cleanError(error)} Rollback error: ${cleanError(rollbackError)}`,
          "uncertain",
        );
      }
      throw new SourceMutationError(
        `The DeletePending write failed verification and was rolled back safely. ${cleanError(error)}`,
        "rolled-back",
      );
    } finally {
      if (!realm.isClosed) realm.close();
    }

    try {
      const verification = await Realm.open({
        path: source,
        readOnly: true,
        disableFormatUpgrade: true,
      });
      try {
        validateSchema(verification, Realm.schemaVersion(source));
        const pending = Array.from(verification.objects("BeatmapSet"))
          .map((value) => value as unknown as DynamicObject)
          .filter((set) => ids.has(realmIdentifier(set.ID)));
        if (
          pending.length !== ids.size ||
          pending.some((set) => !set.DeletePending)
        ) {
          throw new Error(
            "The committed DeletePending flags did not pass reopen verification.",
          );
        }
      } finally {
        if (!verification.isClosed) verification.close();
      }
    } catch (error) {
      let gameRunning: boolean;
      try {
        gameRunning = await this.gameIsRunning();
      } catch (processError) {
        throw new SourceMutationError(
          `The committed DeletePending flags could not pass reopen verification, and the app could not confirm that osu!lazer stayed closed. Keep the game closed and restart this manager to reconcile the verified backup. Verification error: ${cleanError(error)} Process check: ${cleanError(processError)}`,
          "uncertain",
        );
      }
      if (gameRunning) {
        throw new SourceMutationError(
          `osu!lazer opened before the committed DeletePending flags could pass reopen verification. No rollback was attempted against the live game. Keep the recovery backup. Verification error: ${cleanError(error)}`,
          "uncertain",
        );
      }
      try {
        await this.clearPendingFlags(source, ids);
      } catch (rollbackError) {
        throw new SourceMutationError(
          `The committed DeletePending flags could not pass reopen verification or be rolled back. Keep osu!lazer closed and restart this manager to reconcile the verified backup. Verification error: ${cleanError(error)} Rollback error: ${cleanError(rollbackError)}`,
          "uncertain",
        );
      }
      throw new SourceMutationError(
        `The committed DeletePending flags failed reopen verification and were rolled back safely. ${cleanError(error)}`,
        "rolled-back",
      );
    }
    try {
      return !(await this.gameIsRunning());
    } catch {
      // The source commit is already verified. Treat an unknown process state
      // as potentially live and disable automatic restore conservatively.
      return false;
    }
  }

  private async clearPendingFlags(
    source: string,
    ids: Set<string>,
  ): Promise<void> {
    const realm = await Realm.open({
      path: source,
      disableFormatUpgrade: true,
    });
    try {
      validateSchema(realm, Realm.schemaVersion(source));
      const targets = Array.from(realm.objects("BeatmapSet"))
        .map((value) => value as unknown as DynamicObject)
        .filter((set) => ids.has(realmIdentifier(set.ID)));
      if (targets.length !== ids.size) {
        throw new Error("Not every queued set remains available for rollback.");
      }
      realm.write(() => {
        for (const set of targets) set.DeletePending = false;
      });
      if (targets.some((set) => set.DeletePending !== false)) {
        throw new Error("Realm did not persist every rollback flag.");
      }
    } finally {
      if (!realm.isClosed) realm.close();
    }
  }

  private async saveManifest(
    operationPath: string,
    manifest: DeletionBackupManifest,
  ): Promise<void> {
    assertInside(this.quarantineRoot, operationPath);
    await mkdir(operationPath, { recursive: true });
    const manifestPath = join(operationPath, MANIFEST_NAME);
    const partialPath = join(
      operationPath,
      `${MANIFEST_NAME}.${randomUUID()}.partial`,
    );
    assertInside(operationPath, manifestPath);
    assertInside(operationPath, partialPath);
    await writeFile(partialPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(partialPath, manifestPath);
  }

  private async readManifest(
    operationPath: string,
  ): Promise<DeletionBackupManifest> {
    assertInside(this.quarantineRoot, operationPath);
    const parsed = JSON.parse(
      await readFile(join(operationPath, MANIFEST_NAME), "utf8"),
    ) as Partial<DeletionBackupManifest>;
    if (
      parsed.version !== 1 ||
      parsed.realmSchemaVersion !== VERIFIED_SCHEMA_VERSION ||
      typeof parsed.appVersion !== "string" ||
      typeof parsed.operationId !== "string" ||
      !Array.isArray(parsed.sets) ||
      typeof parsed.libraryPath !== "string"
    ) {
      throw new Error("The quarantine manifest is invalid.");
    }
    return parsed as DeletionBackupManifest;
  }

  private resultFromManifest(
    manifest: DeletionBackupManifest,
    backupPath: string,
    indexRefreshed: boolean,
  ): DeletionResult {
    const canRestore = manifest.status === "queued";
    return {
      operationId: manifest.operationId,
      status: manifest.status,
      affectedDifficulties: manifest.affectedDifficulties,
      affectedSets: manifest.affectedSets,
      logicalBytes: manifest.logicalBytes,
      uniqueBackupBytes: manifest.uniqueBackupBytes,
      backupPath,
      indexRefreshed,
      canRestore,
      restoreBlockedReason: canRestore
        ? null
        : manifest.status === "finalized"
          ? "osu! already finalized cleanup; automatic restore is unavailable."
          : "Only a queued deletion can be restored automatically.",
      message:
        manifest.status === "queued"
          ? "Deletion queued safely. Start osu!lazer to let it perform its own reference-aware cleanup, or restore before opening the game."
          : manifest.status === "restored"
            ? "Queued deletion restored. The verified safety backup was retained."
            : manifest.status === "finalized"
              ? "osu! has already finalized this deletion. The safety backup was retained for manual recovery."
              : (manifest.details ?? "The deletion did not complete."),
    };
  }
}
