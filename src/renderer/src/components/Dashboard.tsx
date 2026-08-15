import {
  Activity,
  Database,
  Disc3,
  HardDrive,
  Layers3,
  ShieldCheck,
} from "lucide-react";
import type {
  FilterCondition,
  LibraryStatistics,
} from "../../../shared/contracts";
import { formatBytes, formatNumber, titleCase } from "../lib/format";

interface DashboardProps {
  statistics: LibraryStatistics | null;
  loading: boolean;
  onApplyFilter: (condition: FilterCondition) => void;
  onOpenLibrary: () => void;
}

function Distribution({
  title,
  subtitle,
  items,
  color,
  onClick,
}: {
  title: string;
  subtitle: string;
  items: Array<{ key: string; count: number }>;
  color: string;
  onClick?: (key: string) => void;
}): React.JSX.Element {
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <section className="dashboard-card distribution-card">
      <header>
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </header>
      <div className="distribution-bars">
        {items.map((item) => (
          <button
            disabled={!onClick || item.key === "Unavailable"}
            key={item.key}
            onClick={() => onClick?.(item.key)}
            type="button"
          >
            <span className="distribution-label">{titleCase(item.key)}</span>
            <span className="distribution-track">
              <span
                style={{
                  background: color,
                  width: `${(item.count / max) * 100}%`,
                }}
              />
            </span>
            <strong>{item.count.toLocaleString()}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

export function Dashboard({
  statistics,
  loading,
  onApplyFilter,
  onOpenLibrary,
}: DashboardProps): React.JSX.Element {
  const cards = [
    {
      label: "Beatmap sets",
      value: formatNumber(statistics?.totalSets),
      icon: Layers3,
      accent: "pink",
    },
    {
      label: "Difficulties",
      value: formatNumber(statistics?.totalDifficulties),
      icon: Disc3,
      accent: "violet",
    },
    {
      label: "Logical library size",
      value: formatBytes(statistics?.knownStorageBytes),
      icon: HardDrive,
      accent: "cyan",
    },
    {
      label: "No play timestamp",
      value:
        statistics?.neverPlayed === null
          ? "Unavailable"
          : formatNumber(statistics?.neverPlayed),
      icon: Activity,
      accent: "amber",
    },
  ];
  return (
    <div className="page-scroll dashboard-page">
      <div className="page-intro dashboard-intro">
        <div>
          <span className="eyebrow">Library</span>
          <h1>Overview</h1>
          <p>Counts and distributions from the current local index.</p>
        </div>
        <button
          className="primary-button"
          onClick={onOpenLibrary}
          type="button"
        >
          Browse library
        </button>
      </div>

      <div className={`summary-grid ${loading ? "loading" : ""}`}>
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <section className="summary-card" key={card.label}>
              <div className={`summary-icon ${card.accent}`}>
                <Icon size={20} />
              </div>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
            </section>
          );
        })}
      </div>

      <div className="dashboard-grid">
        <Distribution
          color="linear-gradient(90deg, #ff5fa2, #ff89bb)"
          items={statistics?.byMode ?? []}
          onClick={(mode) =>
            onApplyFilter({
              kind: "condition",
              id: crypto.randomUUID(),
              field: "mode",
              operator: "equals",
              value: mode,
              label: `Mode: ${mode}`,
              enabled: true,
            })
          }
          subtitle="Select a mode to filter the library"
          title="Game modes"
        />
        <Distribution
          color="linear-gradient(90deg, #8b6cff, #b49cff)"
          items={statistics?.byStatus ?? []}
          onClick={(status) =>
            onApplyFilter({
              kind: "condition",
              id: crypto.randomUUID(),
              field: "status",
              operator: "equals",
              value: status,
              label: `Status: ${status}`,
              enabled: true,
            })
          }
          subtitle="Status stored by osu!lazer"
          title="Ranked status"
        />
        <Distribution
          color="linear-gradient(90deg, #4fd7c8, #7ee7dd)"
          items={statistics?.byStarRange ?? []}
          subtitle="Base difficulty rating"
          title="Star rating"
        />
        <Distribution
          color="linear-gradient(90deg, #ffbd5c, #ffd18a)"
          items={statistics?.byBpmRange ?? []}
          subtitle="Base BPM"
          title="BPM distribution"
        />
      </div>

      <div className="dashboard-bottom-grid">
        <section className="dashboard-card integrity-card">
          <div className="integrity-orbit">
            <ShieldCheck size={27} />
          </div>
          <div>
            <span className="eyebrow">Write safety</span>
            <h3>Backup before every change</h3>
            <p>
              Scans use a Realm snapshot. Set deletion requires a current schema
              check, verified backup, and DeletePending write.
            </p>
          </div>
        </section>
        <section className="dashboard-card index-card">
          <Database size={24} />
          <div>
            <h3>Local index</h3>
            <p>
              Search and filters use the manager’s SQLite database. Unchanged
              libraries are not rescanned at launch.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
