export type GameMode = "osu" | "taiko" | "catch" | "mania" | "unknown";

export type BeatmapStatus =
  | "ranked"
  | "approved"
  | "qualified"
  | "loved"
  | "pending"
  | "wip"
  | "graveyard"
  | "unknown";

export interface BeatmapDifficulty {
  id: string;
  beatmapId: number | null;
  beatmapSetId: number | null;
  beatmapSetLocalId: string;
  setProtected: boolean;
  /** Includes hidden difficulties because deletion always operates on a set. */
  setDifficultyCount: number;
  /** True when any difficulty in the set has recorded play/score evidence. */
  setHasRecordedPlay: boolean;
  artist: string;
  title: string;
  difficultyName: string;
  mapper: string;
  mode: GameMode;
  status: BeatmapStatus;
  bpm: number | null;
  durationSeconds: number | null;
  starRating: number | null;
  approachRate: number | null;
  overallDifficulty: number | null;
  circleSize: number | null;
  hpDrain: number | null;
  source: string;
  tags: string;
  audioFilename: string | null;
  hasBackground: boolean | null;
  hasVideo: boolean | null;
  rankedAt: string | null;
  importedAt: string | null;
  lastPlayedAt: string | null;
  localPlayCount: number | null;
  localScoreCount: number | null;
  storageBytes: number | null;
  contentHash: string;
}

export interface LibraryCandidate {
  path: string;
  displayPath: string;
  source: "automatic" | "manual";
  hasRealmDatabase: boolean;
  hasFileStore: boolean;
  confidence: "high" | "medium" | "low";
}

export interface LibraryCapabilities {
  adapter: string;
  readMetadata: boolean;
  readCollections: boolean;
  readPlayHistory: boolean;
  accurateStorage: boolean;
  writeLibrary: boolean;
  limitations: string[];
}

export interface LibraryStatus {
  configuredPath: string | null;
  detectedCandidates: LibraryCandidate[];
  capabilities: LibraryCapabilities;
  osuIsRunning: boolean;
  lastScanAt: string | null;
  indexedDifficulties: number;
  scanInProgress: boolean;
}

export interface ScanProgress {
  phase: "discovering" | "parsing" | "indexing" | "complete" | "failed";
  processed: number;
  discovered: number;
  imported: number;
  skipped: number;
  message: string;
}

export type FilterField =
  | "artist"
  | "title"
  | "difficultyName"
  | "mapper"
  | "mode"
  | "status"
  | "bpm"
  | "durationSeconds"
  | "starRating"
  | "approachRate"
  | "overallDifficulty"
  | "circleSize"
  | "hpDrain"
  | "source"
  | "tags"
  | "beatmapId"
  | "beatmapSetId"
  | "importedAt"
  | "lastPlayedAt"
  | "localPlayCount"
  | "localScoreCount"
  | "storageBytes"
  | "hasVideo"
  | "hasBackground";

export type FilterOperator =
  | "contains"
  | "notContains"
  | "equals"
  | "notEquals"
  | "beginsWith"
  | "endsWith"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "between"
  | "in"
  | "isTrue"
  | "isFalse"
  | "isEmpty"
  | "isNotEmpty"
  | "beforeRelativeDays"
  | "afterRelativeDays";

export interface FilterCondition {
  kind: "condition";
  id: string;
  field: FilterField;
  operator: FilterOperator;
  value?: string | number | boolean | string[] | number[];
  valueTo?: string | number;
  label?: string;
  enabled: boolean;
}

export interface FilterGroup {
  kind: "group";
  id: string;
  conjunction: "and" | "or";
  negated: boolean;
  enabled: boolean;
  children: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

export type SortField =
  | "artist"
  | "title"
  | "difficultyName"
  | "mapper"
  | "mode"
  | "starRating"
  | "bpm"
  | "durationSeconds"
  | "status"
  | "importedAt"
  | "lastPlayedAt"
  | "localPlayCount"
  | "storageBytes";

export interface LibraryQuery {
  text: string;
  filters: FilterGroup;
  sort: { field: SortField; direction: "asc" | "desc" };
  offset: number;
  limit: number;
}

export interface LibraryQueryResult {
  items: BeatmapDifficulty[];
  totalDifficulties: number;
  filteredDifficulties: number;
  filteredSets: number;
  filteredBytes: number;
}

export interface LibraryStatistics {
  totalDifficulties: number;
  totalSets: number;
  knownStorageBytes: number;
  neverPlayed: number | null;
  byMode: Array<{ key: GameMode; count: number }>;
  byStatus: Array<{ key: BeatmapStatus; count: number }>;
  byStarRange: Array<{ key: string; count: number }>;
  byBpmRange: Array<{ key: string; count: number }>;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: Omit<LibraryQuery, "offset" | "limit">;
  createdAt: string;
  updatedAt: string;
}

export interface OperationRecord {
  id: string;
  timestamp: string;
  type: "scan" | "export" | "collection" | "delete" | "restore";
  summary: string;
  affectedDifficulties: number;
  affectedSets: number;
  status: "success" | "partial" | "failed" | "blocked";
  details: string | null;
}

export type AppTheme = "dark" | "light" | "system";

export const DEFAULT_APP_THEME: AppTheme = "light";

export interface AppSettings {
  libraryPath: string | null;
  theme: AppTheme;
  density: "compact" | "comfortable";
  scanOnStartup: boolean;
  protectedWriteMode: true;
}

export interface AppBuildInfo {
  version: string;
  commit: string;
  channel: "development" | "release";
  builtAt: string;
}

export interface SerializableSelection {
  mode: "explicit" | "all-filtered";
  included: string[];
  excluded: string[];
}

export interface DeletionPolicy {
  /**
   * Skip a complete beatmap set when any of its difficulties has recorded
   * play or score evidence. Missing or malformed IPC input is treated as true.
   */
  protectPlayedSets: boolean;
}

export const DEFAULT_DELETION_POLICY: DeletionPolicy = {
  protectPlayedSets: true,
};

export interface DeletionPreviewExample {
  beatmapSetId: number | null;
  artist: string;
  title: string;
  mapper: string;
  difficultyCount: number;
  logicalBytes: number;
}

export interface DeletionPreview {
  previewId: string;
  createdAt: string;
  expiresAt: string;
  sourceFingerprint: string;
  selectedDifficulties: number;
  affectedDifficulties: number;
  affectedSets: number;
  logicalBytes: number;
  uniqueBackupBytes: number;
  protectedSets: number;
  playedSetsSkipped: number;
  /** All difficulties in skipped sets, including unplayed siblings. */
  playedDifficultiesSkipped: number;
  examples: DeletionPreviewExample[];
  blockers: string[];
  confirmationPhrase: string;
  canExecute: boolean;
}

export type QuarantineStatus =
  "preparing" | "ready" | "queued" | "restored" | "finalized" | "failed";

export interface DeletionBackupResource {
  hash: string;
  filename: string;
  size: number;
  backupRelativePath: string;
}

export interface DeletionBackupSet {
  beatmapSetLocalId: string;
  beatmapSetId: number | null;
  artist: string;
  title: string;
  mapper: string;
  difficultyIds: string[];
  resources: DeletionBackupResource[];
  archiveRelativePath: string;
  archiveSha256: string | null;
  archiveSize: number;
}

export interface DeletionBackupManifest {
  version: 1;
  appVersion: string;
  realmSchemaVersion: number;
  operationId: string;
  createdAt: string;
  updatedAt: string;
  status: QuarantineStatus;
  libraryPath: string;
  sourceFingerprint: string;
  postMutationFingerprint: string | null;
  realmBackupRelativePath: string;
  affectedDifficulties: number;
  affectedSets: number;
  logicalBytes: number;
  uniqueBackupBytes: number;
  sets: DeletionBackupSet[];
  details: string | null;
}

export interface DeletionResult {
  operationId: string;
  status: QuarantineStatus;
  affectedDifficulties: number;
  affectedSets: number;
  logicalBytes: number;
  uniqueBackupBytes: number;
  backupPath: string;
  indexRefreshed: boolean;
  canRestore: boolean;
  restoreBlockedReason: string | null;
  message: string;
}

export interface QuarantineRecord {
  operationId: string;
  createdAt: string;
  updatedAt: string;
  libraryPath: string;
  status: QuarantineStatus;
  summary: string;
  affectedDifficulties: number;
  affectedSets: number;
  logicalBytes: number;
  uniqueBackupBytes: number;
  backupPath: string;
  sourceFingerprint: string;
  postMutationFingerprint: string | null;
  canRestore: boolean;
  restoreBlockedReason: string | null;
  details: string | null;
}

export interface AppApi {
  getBuildInfo: () => Promise<AppBuildInfo>;
  getLibraryStatus: () => Promise<LibraryStatus>;
  chooseLibrary: () => Promise<LibraryCandidate | null>;
  setLibraryPath: (path: string) => Promise<LibraryStatus>;
  startScan: () => Promise<void>;
  cancelScan: () => Promise<void>;
  onScanProgress: (listener: (progress: ScanProgress) => void) => () => void;
  queryLibrary: (query: LibraryQuery) => Promise<LibraryQueryResult>;
  queryLibraryIds: (query: LibraryQuery) => Promise<string[]>;
  getStatistics: (filters: FilterGroup) => Promise<LibraryStatistics>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  getSavedSearches: () => Promise<SavedSearch[]>;
  saveSearch: (
    name: string,
    query: Omit<LibraryQuery, "offset" | "limit">,
  ) => Promise<SavedSearch>;
  deleteSavedSearch: (id: string) => Promise<void>;
  getOperationHistory: () => Promise<OperationRecord[]>;
  copySelectionMetadata: (
    query: LibraryQuery,
    selection: SerializableSelection,
  ) => Promise<number>;
  previewDeletion: (
    query: LibraryQuery,
    selection: SerializableSelection,
    policy?: DeletionPolicy,
  ) => Promise<DeletionPreview>;
  executeDeletion: (
    previewId: string,
    confirmationPhrase: string,
  ) => Promise<DeletionResult>;
  getQuarantineRecords: () => Promise<QuarantineRecord[]>;
  restoreQuarantine: (operationId: string) => Promise<DeletionResult>;
  copyText: (text: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
}

export const EMPTY_FILTER_GROUP: FilterGroup = {
  kind: "group",
  id: "root",
  conjunction: "and",
  negated: false,
  enabled: true,
  children: [],
};

export const DEFAULT_QUERY: LibraryQuery = {
  text: "",
  filters: EMPTY_FILTER_GROUP,
  sort: { field: "artist", direction: "asc" },
  offset: 0,
  limit: 200,
};
