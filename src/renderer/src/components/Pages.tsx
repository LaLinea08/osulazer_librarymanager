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
  RefreshCw,
  SearchCheck,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type {
  AppBuildInfo,
  AppSettings,
  LibraryStatistics,
  LibraryStatus,
  OperationRecord,
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
          <span className="eyebrow">Analysis</span>
          <h1>Storage analyzer</h1>
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
            <h3>What is counted</h3>
            <p>
              Every distinct SHA-256 blob referenced by a beatmap set, including
              charts, audio, backgrounds, video, and storyboard resources.
            </p>
          </div>
        </section>
        <section className="dashboard-card explanation-card">
          <ShieldAlert size={21} />
          <div>
            <h3>What is not claimed</h3>
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
          <strong>Analysis only</strong>
          <span>
            The manager does not rename, move, quarantine, or delete hashed
            resources.
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
          <span className="eyebrow">Smart cleanup</span>
          <h1>Find clutter. Decide deliberately.</h1>
          <p>
            Presets only create reviewable filters. They never delete anything.
          </p>
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
          <strong>Deletion is not available in this release</strong>
          <span>
            osu!lazer has no supported external library-mutation API. Matching a
            cleanup preset can never change game data.
          </span>
        </div>
      </div>
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
          <span className="eyebrow">Audit trail</span>
          <h1>Operation history</h1>
          <p>
            Every scan and blocked management action is recorded in the
            manager’s own database.
          </p>
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
          <p>
            Library discovery, interface preferences, safety state, and build
            identity.
          </p>
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
            <p>Choose how much information fits on screen.</p>
          </div>
        </header>
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
            <p>Capability gates are derived from the verified adapter.</p>
          </div>
        </header>
        <div className="capability-list">
          <span>
            <CheckCircle2 size={15} /> Realm metadata snapshot
          </span>
          <span>
            <CheckCircle2 size={15} /> App-owned SQLite index
          </span>
          <span className="blocked">
            <CircleSlash2 size={15} /> osu!lazer writes disabled
          </span>
          <span className="blocked">
            <CircleSlash2 size={15} /> Delete and quarantine disabled
          </span>
        </div>
      </section>
      <section className="settings-section about-section">
        <header>
          <Info size={19} />
          <div>
            <h2>About</h2>
            <p>Useful identity for bug reports.</p>
          </div>
        </header>
        <div className="about-build">
          <div className="brand-mark">
            <span />
          </div>
          <div>
            <strong>osu!lazer Library Manager</strong>
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
  type: "collections" | "duplicates" | "quarantine";
}): React.JSX.Element {
  const content = {
    collections: {
      icon: Library,
      eyebrow: "Collections",
      title: "Read-only collection support is next",
      body: "The verified Realm reader can see collection membership. The comparison and management interface is being kept separate from the first safe browser release.",
    },
    duplicates: {
      icon: CopyCheck,
      eyebrow: "Duplicate finder",
      title: "Confidence needs evidence",
      body: "Exact hash, online ID, and metadata comparison will be added as an analysis-only workflow. Uncertain matches will always require manual review.",
    },
    quarantine: {
      icon: ArchiveRestore,
      eyebrow: "Recovery",
      title: "Quarantine is intentionally unavailable",
      body: "Hashed blobs can be shared across many Realm owners. Moving them externally would corrupt references, so this screen stays disabled until osu! provides a supported workflow.",
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
          <strong>No simulated support</strong>
          <span>
            The application reports capability limits instead of pretending an
            unsafe operation works.
          </span>
        </div>
      </div>
    </div>
  );
}
