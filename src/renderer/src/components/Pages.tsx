import { useState } from "react";
import {
  ArchiveRestore,
  CheckCircle2,
  CircleSlash2,
  CopyCheck,
  Database,
  ExternalLink,
  Film,
  HardDrive,
  History,
  Info,
  Library,
  LoaderCircle,
  RefreshCw,
  SearchCheck,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type {
  AppBuildInfo,
  AppSettings,
  DeletionResult,
  LibraryStatistics,
  LibraryStatus,
  OperationRecord,
  QuarantineRecord,
} from "../../../shared/contracts";
import { formatBytes, formatDate, titleCase } from "../lib/format";

interface StoragePageProps {
  statistics: LibraryStatistics | null;
  onBrowseLargest: () => void;
  onShowVideos: () => void;
}

export function StoragePage({
  statistics,
  onBrowseLargest,
  onShowVideos,
}: StoragePageProps): React.JSX.Element {
  return (
    <div className="page-scroll content-page">
      <div className="page-intro">
        <div>
          <span className="eyebrow">Storage</span>
          <h1>Storage analysis</h1>
          <p>
            Logical resource sizes from osu!lazer’s content-addressed file
            store.
          </p>
        </div>
      </div>
      <section className="storage-hero">
        <div className="storage-donut">
          <div>
            <HardDrive size={23} />
            <strong>{formatBytes(statistics?.knownStorageBytes)}</strong>
            <span>logical size</span>
          </div>
        </div>
        <div className="storage-copy">
          <span className="eyebrow">Indexed resources</span>
          <h2>{statistics?.totalSets.toLocaleString() ?? "—"} beatmap sets</h2>
          <p>
            Each set counts its unique referenced blobs once. Shared resources
            mean this is not an estimate of safely recoverable space.
          </p>
          <div className="button-row">
            <button
              className="primary-button"
              onClick={onBrowseLargest}
              type="button"
            >
              Browse largest sets
            </button>
            <button
              className="secondary-button"
              onClick={onShowVideos}
              type="button"
            >
              <Film size={15} /> Find videos
            </button>
          </div>
        </div>
      </section>
      <div className="analysis-grid">
        <section className="dashboard-card explanation-card">
          <Database size={21} />
          <div>
            <h3>Included in the total</h3>
            <p>
              Every distinct SHA-256 blob referenced by a beatmap set, including
              charts, audio, backgrounds, video, and storyboard resources.
            </p>
          </div>
        </section>
        <section className="dashboard-card explanation-card">
          <ShieldAlert size={21} />
          <div>
            <h3>Not a reclaim estimate</h3>
            <p>
              Reclaimable space. A blob can be shared across sets or referenced
              by scores, skins, and other osu!lazer models.
            </p>
          </div>
        </section>
      </div>
      <div className="safety-banner">
        <ShieldCheck size={19} />
        <div>
          <strong>Source blobs remain under osu!lazer&apos;s control</strong>
          <span>
            Recovery copies are app-owned. Source hashes are never moved or
            removed directly; deletion is queued through DeletePending.
          </span>
        </div>
      </div>
    </div>
  );
}

interface CleanupPageProps {
  onPreset: (preset: "never" | "old" | "easy" | "large" | "video") => void;
}

export function CleanupPage({ onPreset }: CleanupPageProps): React.JSX.Element {
  const presets = [
    {
      id: "never" as const,
      title: "No play timestamp",
      description: "Maps with no recorded LastPlayed value",
      icon: CircleSlash2,
      color: "violet",
    },
    {
      id: "old" as const,
      title: "Not played in 2 years",
      description: "Last played more than 730 days ago",
      icon: History,
      color: "amber",
    },
    {
      id: "easy" as const,
      title: "Low star rating",
      description: "Persisted base star rating below 2★",
      icon: SearchCheck,
      color: "cyan",
    },
    {
      id: "large" as const,
      title: "Huge beatmap sets",
      description: "Logical set resources larger than 100 MB",
      icon: HardDrive,
      color: "pink",
    },
    {
      id: "video" as const,
      title: "Contains video",
      description: "Sets with at least one video resource",
      icon: Film,
      color: "green",
    },
  ];
  return (
    <div className="page-scroll content-page">
      <div className="page-intro">
        <div>
          <span className="eyebrow">Filters</span>
          <h1>Cleanup presets</h1>
          <p>Open a filtered library view for review. Nothing is deleted.</p>
        </div>
      </div>
      <div className="preset-grid">
        {presets.map((preset) => {
          const Icon = preset.icon;
          return (
            <button
              className="preset-card"
              key={preset.id}
              onClick={() => onPreset(preset.id)}
              type="button"
            >
              <span className={`preset-icon ${preset.color}`}>
                <Icon size={20} />
              </span>
              <div>
                <strong>{preset.title}</strong>
                <p>{preset.description}</p>
              </div>
              <span className="review-link">Review matches →</span>
            </button>
          );
        })}
      </div>
      <div className="safety-banner">
        <Trash2 size={19} />
        <div>
          <strong>Deletion remains a separate review</strong>
          <span>
            A preset only selects candidates. Deletion still requires a fresh
            whole-set preview, verified backup, and exact confirmation phrase.
          </span>
        </div>
      </div>
    </div>
  );
}

interface QuarantinePageProps {
  records: QuarantineRecord[];
  osuIsRunning: boolean;
  onRefresh: () => Promise<void>;
  onRestore: (operationId: string) => Promise<DeletionResult>;
}

export function QuarantinePage({
  records,
  osuIsRunning,
  onRefresh,
  onRestore,
}: QuarantinePageProps): React.JSX.Element {
  const [busyOperation, setBusyOperation] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    setError(null);
    try {
      await onRefresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Recovery records could not be refreshed.",
      );
    } finally {
      setRefreshing(false);
    }
  };

  const restore = async (operationId: string): Promise<void> => {
    setBusyOperation(operationId);
    setError(null);
    setNotice(null);
    try {
      const result = await onRestore(operationId);
      setNotice(result.message);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Restore could not run.",
      );
    } finally {
      setBusyOperation(null);
    }
  };

  return (
    <div className="page-scroll content-page quarantine-page">
      <div className="page-intro">
        <div>
          <span className="eyebrow">Recovery</span>
          <h1>Quarantine &amp; restore</h1>
          <p>
            Review verified backups and restore queued sets before osu!lazer
            processes them.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={refreshing}
          onClick={() => void refresh()}
          type="button"
        >
          <RefreshCw className={refreshing ? "spin" : ""} size={15} />
          Refresh
        </button>
      </div>

      <div className="quarantine-warning">
        <ShieldAlert size={21} />
        <div>
          <strong>Restore before opening osu!lazer</strong>
          <span>
            Restore before osu!lazer starts and processes{" "}
            <code>DeletePending</code>. After osu!lazer removes its Realm rows,
            this app keeps the recovery backup but cannot safely recreate those
            rows automatically.
          </span>
        </div>
      </div>

      {osuIsRunning && (
        <div className="inline-warning quarantine-running" role="status">
          Close osu!lazer before restoring. The restore buttons remain locked
          while the game is running.
        </div>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="quarantine-notice" role="status">
          <CheckCircle2 size={17} /> {notice}
        </div>
      )}

      <section className="quarantine-list" aria-label="Recovery backups">
        {records.length === 0 ? (
          <div className="empty-feature">
            <ArchiveRestore size={27} />
            <strong>No recovery backups yet</strong>
            <span>
              A protected deletion creates a verified backup before queuing any
              set in osu!lazer.
            </span>
          </div>
        ) : (
          records.map((record) => {
            const restoring = busyOperation === record.operationId;
            return (
              <article className="quarantine-record" key={record.operationId}>
                <header>
                  <div>
                    <span
                      className={"quarantine-status status-" + record.status}
                    >
                      {titleCase(record.status)}
                    </span>
                    <strong>{record.summary}</strong>
                    <small>{formatDate(record.createdAt)}</small>
                  </div>
                  <button
                    className="secondary-button"
                    disabled={
                      !record.canRestore ||
                      osuIsRunning ||
                      Boolean(busyOperation)
                    }
                    onClick={() => void restore(record.operationId)}
                    title={
                      record.canRestore
                        ? "Undo this queued deletion"
                        : (record.restoreBlockedReason ?? "Restore unavailable")
                    }
                    type="button"
                  >
                    {restoring ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <ArchiveRestore size={15} />
                    )}
                    Restore queued sets
                  </button>
                </header>
                <div className="quarantine-metrics">
                  <div>
                    <span>Sets</span>
                    <strong>{record.affectedSets.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span>Difficulties</span>
                    <strong>
                      {record.affectedDifficulties.toLocaleString()}
                    </strong>
                  </div>
                  <div>
                    <span>Logical resources</span>
                    <strong>{formatBytes(record.logicalBytes)}</strong>
                  </div>
                  <div>
                    <span>Backup size</span>
                    <strong>{formatBytes(record.uniqueBackupBytes)}</strong>
                  </div>
                </div>
                <div className="quarantine-path">
                  <code title={record.backupPath}>{record.backupPath}</code>
                  <button
                    aria-label="Copy recovery path"
                    className="icon-button subtle"
                    onClick={() =>
                      void window.libraryManager.copyText(record.backupPath)
                    }
                    title="Copy recovery path"
                    type="button"
                  >
                    <CopyCheck size={14} />
                  </button>
                </div>
                {(record.restoreBlockedReason || record.details) && (
                  <p
                    className={
                      record.restoreBlockedReason
                        ? "quarantine-blocked"
                        : undefined
                    }
                  >
                    {record.restoreBlockedReason ?? record.details}
                  </p>
                )}
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}

export function HistoryPage({
  operations,
}: {
  operations: OperationRecord[];
}): React.JSX.Element {
  return (
    <div className="page-scroll content-page">
      <div className="page-intro">
        <div>
          <span className="eyebrow">Local log</span>
          <h1>Operation history</h1>
          <p>Scans, deletions, restores, and failures stored by this app.</p>
        </div>
      </div>
      <section className="history-list">
        {operations.length === 0 ? (
          <div className="empty-feature">
            <History size={25} />
            <strong>No operations yet</strong>
            <span>Your first successful or failed scan will appear here.</span>
          </div>
        ) : (
          operations.map((operation) => (
            <article className="history-row" key={operation.id}>
              <span className={`history-status ${operation.status}`}>
                {operation.status === "success" ? (
                  <CheckCircle2 size={16} />
                ) : (
                  <Info size={16} />
                )}
              </span>
              <div>
                <strong>{operation.summary}</strong>
                <p>{operation.details ?? "No additional details."}</p>
              </div>
              <div className="history-meta">
                <span>{formatDate(operation.timestamp)}</span>
                <small>{titleCase(operation.status)}</small>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

interface SettingsPageProps {
  settings: AppSettings;
  status: LibraryStatus;
  build: AppBuildInfo;
  onUpdate: (patch: Partial<AppSettings>) => Promise<void>;
  onChooseLibrary: () => Promise<void>;
  onScan: () => Promise<void>;
  onOpenDocs: () => void;
}

export function SettingsPage({
  settings,
  status,
  build,
  onUpdate,
  onChooseLibrary,
  onScan,
  onOpenDocs,
}: SettingsPageProps): React.JSX.Element {
  return (
    <div className="page-scroll content-page settings-page">
      <div className="page-intro">
        <div>
          <span className="eyebrow">Preferences</span>
          <h1>Settings</h1>
          <p>Configure the indexed library and interface.</p>
        </div>
      </div>
      <section className="settings-section">
        <header>
          <Library size={19} />
          <div>
            <h2>osu!lazer library</h2>
            <p>The data root containing client.realm and files.</p>
          </div>
        </header>
        <div className="setting-row">
          <div>
            <strong>Data location</strong>
            <code>{settings.libraryPath ?? "Not configured"}</code>
          </div>
          <button
            className="secondary-button"
            onClick={() => void onChooseLibrary()}
            type="button"
          >
            Change…
          </button>
        </div>
        <div className="setting-row">
          <div>
            <strong>Last successful scan</strong>
            <span>
              {status.lastScanAt ? formatDate(status.lastScanAt) : "Never"}
            </span>
          </div>
          <button
            className="secondary-button"
            disabled={status.osuIsRunning || status.scanInProgress}
            onClick={() => void onScan()}
            type="button"
          >
            <RefreshCw size={15} /> Rescan
          </button>
        </div>
      </section>
      <section className="settings-section">
        <header>
          <HardDrive size={19} />
          <div>
            <h2>Interface</h2>
            <p>Application theme and table spacing.</p>
          </div>
        </header>
        <div className="setting-row">
          <div>
            <strong>Theme</strong>
            <span>Applied across the application.</span>
          </div>
          <fieldset className="segmented-control theme-selector">
            <legend className="sr-only">Application theme</legend>
            {(["light", "dark", "system"] as const).map((theme) => (
              <label
                className={`segment-option${settings.theme === theme ? " selected" : ""}`}
                key={theme}
              >
                <input
                  checked={settings.theme === theme}
                  name="application-theme"
                  onChange={() => void onUpdate({ theme })}
                  type="radio"
                  value={theme}
                />
                <span>{titleCase(theme)}</span>
              </label>
            ))}
          </fieldset>
        </div>
        <div className="setting-row">
          <div>
            <strong>Table density</strong>
            <span>Controls virtual row height.</span>
          </div>
          <select
            value={settings.density}
            onChange={(event) =>
              void onUpdate({
                density: event.target.value as AppSettings["density"],
              })
            }
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>Scan on startup</strong>
            <span>Only runs when osu!lazer is closed.</span>
          </div>
          <label className="switch">
            <input
              checked={settings.scanOnStartup}
              onChange={(event) =>
                void onUpdate({ scanOnStartup: event.target.checked })
              }
              type="checkbox"
            />
            <span />
          </label>
        </div>
      </section>
      <section className="settings-section safety-settings">
        <header>
          <ShieldCheck size={19} />
          <div>
            <h2>Safety</h2>
            <p>Actions available for the current library adapter.</p>
          </div>
        </header>
        <div className="capability-list">
          <span>
            <CheckCircle2 size={15} /> Realm metadata snapshot
          </span>
          <span>
            <CheckCircle2 size={15} /> App-owned SQLite index
          </span>
          <span className={status.capabilities.writeLibrary ? "" : "blocked"}>
            {status.capabilities.writeLibrary ? (
              <ShieldCheck size={15} />
            ) : (
              <CircleSlash2 size={15} />
            )}
            Whole-set DeletePending writes{" "}
            {status.capabilities.writeLibrary ? "verified" : "locked"}
          </span>
          <span>
            <CheckCircle2 size={15} /> Recovery backup before every write
          </span>
        </div>
      </section>
      <section className="settings-section about-section">
        <header>
          <Info size={19} />
          <div>
            <h2>About</h2>
            <p>Version details for bug reports.</p>
          </div>
        </header>
        <div className="about-build">
          <span className="product-monogram" aria-hidden="true">
            <span>o</span>
            <b>!</b>
          </span>
          <div>
            <strong
              aria-label="osu!lazer Library Manager"
              className="product-wordmark"
            >
              <span aria-hidden="true" className="product-wordmark-core">
                osu!lazer
              </span>
              <span aria-hidden="true" className="product-wordmark-label">
                library manager
              </span>
            </strong>
            <code>Version {build.version}</code>
            <span>
              Commit {build.commit} · Built {formatDate(build.builtAt)}
            </span>
          </div>
        </div>
        <button className="text-button" onClick={onOpenDocs} type="button">
          Project on GitHub <ExternalLink size={13} />
        </button>
      </section>
    </div>
  );
}

export function FeaturePlaceholder({
  type,
}: {
  type: "collections" | "duplicates";
}): React.JSX.Element {
  const content = {
    collections: {
      icon: Library,
      eyebrow: "Collections",
      title: "Collection tools unavailable",
      body: "The library reader can see collection membership, but this version does not provide collection comparison or editing.",
    },
    duplicates: {
      icon: CopyCheck,
      eyebrow: "Duplicate finder",
      title: "Duplicate analysis unavailable",
      body: "This version does not compare hashes, online IDs, and metadata for duplicate review.",
    },
  }[type];
  const Icon = content.icon;
  return (
    <div className="page-scroll content-page feature-placeholder">
      <div className="feature-orbit">
        <Icon size={31} />
      </div>
      <span className="eyebrow">{content.eyebrow}</span>
      <h1>{content.title}</h1>
      <p>{content.body}</p>
      <div className="safety-note">
        <ShieldCheck size={18} />
        <div>
          <strong>Unavailable features stay disabled</strong>
          <span>
            The application reports capability limits and does not modify this
            data.
          </span>
        </div>
      </div>
    </div>
  );
}
