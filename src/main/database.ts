import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AppSettings,
  BeatmapDifficulty,
  FilterGroup,
  LibraryQuery,
  LibraryQueryResult,
  LibraryStatistics,
  OperationRecord,
  SavedSearch,
} from "../shared/contracts";
import type { SerializableSelection } from "../shared/contracts";
import { compileWhere, sortColumns, type SqlValue } from "./query-compiler";

type DatabaseRow = Record<string, string | number | null>;

const defaultSettings: AppSettings = {
  libraryPath: null,
  theme: "dark",
  density: "comfortable",
  scanOnStartup: false,
  readOnlyMode: true,
};

export class AppDatabase {
  private readonly database: DatabaseSync;

  public constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.migrate();
  }

  private migrate(): void {
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS beatmaps (
        id TEXT PRIMARY KEY,
        beatmap_id INTEGER,
        beatmap_set_id INTEGER,
        artist TEXT NOT NULL,
        title TEXT NOT NULL,
        difficulty_name TEXT NOT NULL,
        mapper TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        bpm REAL,
        duration_seconds REAL,
        star_rating REAL,
        approach_rate REAL,
        overall_difficulty REAL,
        circle_size REAL,
        hp_drain REAL,
        source TEXT NOT NULL,
        tags TEXT NOT NULL,
        audio_filename TEXT,
        has_background INTEGER,
        has_video INTEGER,
        ranked_at TEXT,
        imported_at TEXT,
        last_played_at TEXT,
        local_play_count INTEGER,
        local_score_count INTEGER,
        storage_bytes INTEGER,
        content_hash TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS beatmaps_artist_idx ON beatmaps(artist COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS beatmaps_set_idx ON beatmaps(beatmap_set_id);
      CREATE INDEX IF NOT EXISTS beatmaps_mode_idx ON beatmaps(mode);
      CREATE INDEX IF NOT EXISTS beatmaps_status_idx ON beatmaps(status);
      CREATE INDEX IF NOT EXISTS beatmaps_stars_idx ON beatmaps(star_rating);
      CREATE INDEX IF NOT EXISTS beatmaps_bpm_idx ON beatmaps(bpm);
      CREATE INDEX IF NOT EXISTS beatmaps_imported_idx ON beatmaps(imported_at);
      CREATE INDEX IF NOT EXISTS beatmaps_played_idx ON beatmaps(last_played_at);

      CREATE TABLE IF NOT EXISTS saved_searches (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        query_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        summary TEXT NOT NULL,
        affected_difficulties INTEGER NOT NULL,
        affected_sets INTEGER NOT NULL,
        status TEXT NOT NULL,
        details TEXT
      ) STRICT;

      INSERT OR IGNORE INTO schema_migrations(version, applied_at)
      VALUES (1, CURRENT_TIMESTAMP);
    `);

    const insertSetting = this.database.prepare(
      "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)",
    );
    for (const [key, value] of Object.entries(defaultSettings)) {
      insertSetting.run(key, JSON.stringify(value));
    }
  }

  public close(): void {
    this.database.close();
  }

  public getMeta(key: string): string | null {
    const row = this.database
      .prepare("SELECT value FROM app_meta WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  public setMeta(key: string, value: string): void {
    this.database
      .prepare(
        "INSERT INTO app_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  public replaceBeatmaps(
    records: BeatmapDifficulty[],
    libraryPath: string,
  ): void {
    const insert = this.database.prepare(`
      INSERT INTO beatmaps (
        id, beatmap_id, beatmap_set_id, artist, title, difficulty_name, mapper, mode, status,
        bpm, duration_seconds, star_rating, approach_rate, overall_difficulty, circle_size,
        hp_drain, source, tags, audio_filename, has_background, has_video, ranked_at,
        imported_at, last_played_at, local_play_count, local_score_count, storage_bytes, content_hash
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.exec("DELETE FROM beatmaps");
      for (const record of records) {
        insert.run(
          record.id,
          record.beatmapId,
          record.beatmapSetId,
          record.artist,
          record.title,
          record.difficultyName,
          record.mapper,
          record.mode,
          record.status,
          record.bpm,
          record.durationSeconds,
          record.starRating,
          record.approachRate,
          record.overallDifficulty,
          record.circleSize,
          record.hpDrain,
          record.source,
          record.tags,
          record.audioFilename,
          record.hasBackground === null ? null : Number(record.hasBackground),
          record.hasVideo === null ? null : Number(record.hasVideo),
          record.rankedAt,
          record.importedAt,
          record.lastPlayedAt,
          record.localPlayCount,
          record.localScoreCount,
          record.storageBytes,
          record.contentHash,
        );
      }
      const now = new Date().toISOString();
      this.setMeta("last_scan_at", now);
      this.setMeta("library_path", libraryPath);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private rowToBeatmap(row: DatabaseRow): BeatmapDifficulty {
    return {
      id: String(row.id),
      beatmapId: row.beatmap_id === null ? null : Number(row.beatmap_id),
      beatmapSetId:
        row.beatmap_set_id === null ? null : Number(row.beatmap_set_id),
      artist: String(row.artist),
      title: String(row.title),
      difficultyName: String(row.difficulty_name),
      mapper: String(row.mapper),
      mode: String(row.mode) as BeatmapDifficulty["mode"],
      status: String(row.status) as BeatmapDifficulty["status"],
      bpm: row.bpm === null ? null : Number(row.bpm),
      durationSeconds:
        row.duration_seconds === null ? null : Number(row.duration_seconds),
      starRating: row.star_rating === null ? null : Number(row.star_rating),
      approachRate:
        row.approach_rate === null ? null : Number(row.approach_rate),
      overallDifficulty:
        row.overall_difficulty === null ? null : Number(row.overall_difficulty),
      circleSize: row.circle_size === null ? null : Number(row.circle_size),
      hpDrain: row.hp_drain === null ? null : Number(row.hp_drain),
      source: String(row.source),
      tags: String(row.tags),
      audioFilename:
        row.audio_filename === null ? null : String(row.audio_filename),
      hasBackground:
        row.has_background === null ? null : Boolean(row.has_background),
      hasVideo: row.has_video === null ? null : Boolean(row.has_video),
      rankedAt: row.ranked_at === null ? null : String(row.ranked_at),
      importedAt: row.imported_at === null ? null : String(row.imported_at),
      lastPlayedAt:
        row.last_played_at === null ? null : String(row.last_played_at),
      localPlayCount:
        row.local_play_count === null ? null : Number(row.local_play_count),
      localScoreCount:
        row.local_score_count === null ? null : Number(row.local_score_count),
      storageBytes:
        row.storage_bytes === null ? null : Number(row.storage_bytes),
      contentHash: String(row.content_hash),
    };
  }

  public query(query: LibraryQuery): LibraryQueryResult {
    const { sql: where, params } = compileWhere(query.filters, query.text);
    const sortColumn = sortColumns[query.sort.field];
    const direction = query.sort.direction === "desc" ? "DESC" : "ASC";
    const limit = Math.min(500, Math.max(1, Math.trunc(query.limit)));
    const offset = Math.max(0, Math.trunc(query.offset));
    const rows = this.database
      .prepare(
        `SELECT * FROM beatmaps ${where}
         ORDER BY ${sortColumn} IS NULL, ${sortColumn} ${direction}, id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as DatabaseRow[];

    const filtered = this.database
      .prepare(
        `SELECT
          COUNT(*) AS difficulties,
          COUNT(DISTINCT COALESCE(CAST(beatmap_set_id AS TEXT), 'local:' || id)) AS sets
         FROM beatmaps ${where}`,
      )
      .get(...params) as DatabaseRow;
    const filteredStorage = this.database
      .prepare(
        `SELECT COALESCE(SUM(group_bytes), 0) AS bytes FROM (
          SELECT MAX(storage_bytes) AS group_bytes
          FROM beatmaps ${where}
          GROUP BY COALESCE(CAST(beatmap_set_id AS TEXT), 'local:' || id)
        )`,
      )
      .get(...params) as DatabaseRow;
    const total = this.database
      .prepare("SELECT COUNT(*) AS count FROM beatmaps")
      .get() as DatabaseRow;

    return {
      items: rows.map((row) => this.rowToBeatmap(row)),
      totalDifficulties: Number(total.count),
      filteredDifficulties: Number(filtered.difficulties),
      filteredSets: Number(filtered.sets),
      filteredBytes: Number(filteredStorage.bytes),
    };
  }

  public queryIds(query: LibraryQuery): string[] {
    const { sql: where, params } = compileWhere(query.filters, query.text);
    const sortColumn = sortColumns[query.sort.field];
    const direction = query.sort.direction === "desc" ? "DESC" : "ASC";
    const rows = this.database
      .prepare(
        `SELECT id FROM beatmaps ${where} ORDER BY ${sortColumn} IS NULL, ${sortColumn} ${direction}, id ASC`,
      )
      .all(...params) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  public selectionMetadata(
    query: LibraryQuery,
    selection: SerializableSelection,
  ): string[] {
    const { sql: where, params } = compileWhere(query.filters, query.text);
    const rows = this.database
      .prepare(
        `SELECT id, artist, title, difficulty_name, mapper, beatmap_id, beatmap_set_id FROM beatmaps ${where}`,
      )
      .all(...params) as DatabaseRow[];
    const included = new Set(selection.included);
    const excluded = new Set(selection.excluded);
    return rows
      .filter((row) =>
        selection.mode === "all-filtered"
          ? !excluded.has(String(row.id))
          : included.has(String(row.id)),
      )
      .map((row) => {
        const identity = `${String(row.artist)} – ${String(row.title)} [${String(row.difficulty_name)}] by ${String(row.mapper)}`;
        const ids = [
          row.beatmap_id === null ? "" : `beatmap:${String(row.beatmap_id)}`,
          row.beatmap_set_id === null
            ? ""
            : `set:${String(row.beatmap_set_id)}`,
        ].filter(Boolean);
        return ids.length > 0 ? `${identity} (${ids.join(", ")})` : identity;
      });
  }

  public getStatistics(filters: FilterGroup): LibraryStatistics {
    const { sql: where, params } = compileWhere(filters, "");
    const totals = this.database
      .prepare(
        `SELECT COUNT(*) AS difficulties,
          COUNT(DISTINCT COALESCE(CAST(beatmap_set_id AS TEXT), 'local:' || id)) AS sets,
          SUM(CASE WHEN local_play_count = 0 THEN 1 ELSE 0 END) AS never_played,
          SUM(CASE WHEN local_play_count IS NOT NULL THEN 1 ELSE 0 END) AS known_plays
         FROM beatmaps ${where}`,
      )
      .get(...params) as DatabaseRow;
    const storage = this.database
      .prepare(
        `SELECT COALESCE(SUM(group_bytes), 0) AS bytes FROM (
          SELECT MAX(storage_bytes) AS group_bytes
          FROM beatmaps ${where}
          GROUP BY COALESCE(CAST(beatmap_set_id AS TEXT), 'local:' || id)
        )`,
      )
      .get(...params) as DatabaseRow;

    const group = (column: string): Array<{ key: string; count: number }> => {
      return (
        this.database
          .prepare(
            `SELECT ${column} AS key, COUNT(*) AS count FROM beatmaps ${where} GROUP BY ${column} ORDER BY count DESC`,
          )
          .all(...params) as DatabaseRow[]
      ).map((row) => ({
        key: String(row.key ?? "unknown"),
        count: Number(row.count),
      }));
    };

    const ranges = (
      expression: string,
      order: string,
    ): Array<{ key: string; count: number }> => {
      return (
        this.database
          .prepare(
            `SELECT ${expression} AS key, COUNT(*) AS count FROM beatmaps ${where} GROUP BY key ORDER BY ${order}`,
          )
          .all(...params) as DatabaseRow[]
      ).map((row) => ({ key: String(row.key), count: Number(row.count) }));
    };

    const starExpression = `CASE
      WHEN star_rating IS NULL THEN 'Unavailable'
      WHEN star_rating < 2 THEN '0–2★'
      WHEN star_rating < 4 THEN '2–4★'
      WHEN star_rating < 6 THEN '4–6★'
      WHEN star_rating < 8 THEN '6–8★'
      ELSE '8★+'
    END`;
    const bpmExpression = `CASE
      WHEN bpm IS NULL THEN 'Unavailable'
      WHEN bpm < 120 THEN '<120'
      WHEN bpm < 160 THEN '120–160'
      WHEN bpm < 200 THEN '160–200'
      WHEN bpm < 240 THEN '200–240'
      ELSE '240+'
    END`;

    return {
      totalDifficulties: Number(totals.difficulties),
      totalSets: Number(totals.sets),
      knownStorageBytes: Number(storage.bytes),
      neverPlayed:
        Number(totals.known_plays) === 0 ? null : Number(totals.never_played),
      byMode: group("mode") as LibraryStatistics["byMode"],
      byStatus: group("status") as LibraryStatistics["byStatus"],
      byStarRange: ranges(starExpression, "MIN(COALESCE(star_rating, 999))"),
      byBpmRange: ranges(bpmExpression, "MIN(COALESCE(bpm, 99999))"),
    };
  }

  public getSettings(): AppSettings {
    const rows = this.database
      .prepare("SELECT key, value FROM settings")
      .all() as Array<{
      key: string;
      value: string;
    }>;
    const values = Object.fromEntries(
      rows.map((row) => [row.key, JSON.parse(row.value) as unknown]),
    );
    return { ...defaultSettings, ...values, readOnlyMode: true };
  }

  public updateSettings(patch: Partial<AppSettings>): AppSettings {
    const allowed = new Set<keyof AppSettings>([
      "libraryPath",
      "theme",
      "density",
      "scanOnStartup",
    ]);
    const statement = this.database.prepare(
      "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    for (const [key, value] of Object.entries(patch)) {
      if (allowed.has(key as keyof AppSettings))
        statement.run(key, JSON.stringify(value));
    }
    return this.getSettings();
  }

  public getSavedSearches(): SavedSearch[] {
    const rows = this.database
      .prepare("SELECT * FROM saved_searches ORDER BY name COLLATE NOCASE")
      .all() as DatabaseRow[];
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      query: JSON.parse(String(row.query_json)) as SavedSearch["query"],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  public saveSearch(name: string, query: SavedSearch["query"]): SavedSearch {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error("A saved search needs a name.");
    const existing = this.database
      .prepare(
        "SELECT id, created_at FROM saved_searches WHERE name = ? COLLATE NOCASE",
      )
      .get(trimmedName) as DatabaseRow | undefined;
    const now = new Date().toISOString();
    const saved: SavedSearch = {
      id: existing ? String(existing.id) : randomUUID(),
      name: trimmedName,
      query,
      createdAt: existing ? String(existing.created_at) : now,
      updatedAt: now,
    };
    this.database
      .prepare(
        `
        INSERT INTO saved_searches(id, name, query_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET query_json = excluded.query_json, updated_at = excluded.updated_at
      `,
      )
      .run(
        saved.id,
        saved.name,
        JSON.stringify(saved.query),
        saved.createdAt,
        saved.updatedAt,
      );
    return saved;
  }

  public deleteSavedSearch(id: string): void {
    this.database.prepare("DELETE FROM saved_searches WHERE id = ?").run(id);
  }

  public addOperation(
    operation: Omit<OperationRecord, "id" | "timestamp">,
  ): void {
    this.database
      .prepare(
        `
        INSERT INTO operations(id, timestamp, type, summary, affected_difficulties, affected_sets, status, details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        randomUUID(),
        new Date().toISOString(),
        operation.type,
        operation.summary,
        operation.affectedDifficulties,
        operation.affectedSets,
        operation.status,
        operation.details,
      );
  }

  public getOperationHistory(): OperationRecord[] {
    const rows = this.database
      .prepare("SELECT * FROM operations ORDER BY timestamp DESC LIMIT 500")
      .all() as DatabaseRow[];
    return rows.map((row) => ({
      id: String(row.id),
      timestamp: String(row.timestamp),
      type: String(row.type) as OperationRecord["type"],
      summary: String(row.summary),
      affectedDifficulties: Number(row.affected_difficulties),
      affectedSets: Number(row.affected_sets),
      status: String(row.status) as OperationRecord["status"],
      details: row.details === null ? null : String(row.details),
    }));
  }

  public getIndexedCount(): number {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM beatmaps")
      .get() as { count: number };
    return Number(row.count);
  }
}

export function isSqliteAvailable(): boolean {
  try {
    const database = new DatabaseSync(":memory:");
    database.close();
    return true;
  } catch {
    return false;
  }
}

export type { SqlValue };
