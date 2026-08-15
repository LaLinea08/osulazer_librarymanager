import {
  Archive,
  BarChart3,
  Boxes,
  ChevronLeft,
  CircleDot,
  Clock3,
  CopyCheck,
  Disc3,
  FolderHeart,
  Gauge,
  HardDrive,
  Heart,
  History,
  Library,
  ListMusic,
  SearchCheck,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  type LucideIcon,
} from "lucide-react";
import type { LibraryStatus, SavedSearch } from "../../../shared/contracts";

export type NavigationTarget =
  | "dashboard"
  | "all"
  | "recent"
  | "played"
  | "never"
  | "ranked"
  | "loved"
  | "graveyard"
  | "mode-osu"
  | "mode-taiko"
  | "mode-catch"
  | "mode-mania"
  | "collections"
  | "duplicates"
  | "storage"
  | "cleanup"
  | "quarantine"
  | "history"
  | "settings";

interface NavigationItem {
  id: NavigationTarget;
  label: string;
  icon: LucideIcon;
  badge?: string;
}

interface SidebarProps {
  active: NavigationTarget | `saved:${string}`;
  collapsed: boolean;
  savedSearches: SavedSearch[];
  status: LibraryStatus;
  onNavigate: (target: NavigationTarget | `saved:${string}`) => void;
  onToggleCollapsed: () => void;
}

const libraryItems: NavigationItem[] = [
  { id: "all", label: "All Beatmaps", icon: Library },
  { id: "recent", label: "Recently Added", icon: Sparkles },
  { id: "played", label: "Recently Played", icon: Clock3 },
  { id: "never", label: "No Play Recorded", icon: CircleDot },
  { id: "ranked", label: "Ranked", icon: Star },
  { id: "loved", label: "Loved", icon: Heart },
  { id: "graveyard", label: "Graveyard", icon: Archive },
];

const modeItems: NavigationItem[] = [
  { id: "mode-osu", label: "osu!", icon: CircleDot },
  { id: "mode-taiko", label: "osu!taiko", icon: Disc3 },
  { id: "mode-catch", label: "osu!catch", icon: FolderHeart },
  { id: "mode-mania", label: "osu!mania", icon: ListMusic },
];

const managementItems: NavigationItem[] = [
  { id: "collections", label: "Collections", icon: Boxes, badge: "Read-only" },
  { id: "duplicates", label: "Duplicate Finder", icon: CopyCheck },
  { id: "storage", label: "Storage Analyzer", icon: HardDrive },
  { id: "cleanup", label: "Cleanup", icon: SearchCheck },
  {
    id: "quarantine",
    label: "Quarantine",
    icon: ShieldCheck,
  },
  { id: "history", label: "Operation History", icon: History },
];

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavigationItem;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const Icon = item.icon;
  return (
    <button
      className={`sidebar-item ${active ? "active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" size={17} strokeWidth={1.9} />
      <span>{item.label}</span>
      {item.badge && <span className="sidebar-badge">{item.badge}</span>}
    </button>
  );
}

function RailButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className={`rail-button ${active ? "active" : ""}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
      <span className="rail-tooltip">{label}</span>
    </button>
  );
}

export function Sidebar({
  active,
  collapsed,
  savedSearches,
  status,
  onNavigate,
  onToggleCollapsed,
}: SidebarProps): React.JSX.Element {
  const libraryActive =
    active.startsWith("saved:") ||
    new Set<string>([
      "all",
      "recent",
      "played",
      "never",
      "ranked",
      "loved",
      "graveyard",
      "mode-osu",
      "mode-taiko",
      "mode-catch",
      "mode-mania",
    ]).has(active);
  const cleanupActive = new Set<string>([
    "cleanup",
    "collections",
    "duplicates",
    "quarantine",
  ]).has(active);
  const configuredPath = status.configuredPath ?? "Library not configured";
  const pathParts = configuredPath.split(/[\\/]/).filter(Boolean);
  const libraryFolder = pathParts.at(-1) ?? configuredPath;

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="nav-rail">
        <div
          aria-label="osu!lazer Library Manager"
          className="rail-brand"
          role="img"
        >
          <div className="brand-mark" aria-hidden="true">
            <span />
          </div>
        </div>
        <nav className="rail-navigation" aria-label="Workspace shortcuts">
          <RailButton
            active={active === "dashboard"}
            icon={BarChart3}
            label="Overview"
            onClick={() => onNavigate("dashboard")}
          />
          <RailButton
            active={libraryActive}
            icon={Library}
            label="Library"
            onClick={() => onNavigate("all")}
          />
          <RailButton
            active={active === "storage"}
            icon={HardDrive}
            label="Storage"
            onClick={() => onNavigate("storage")}
          />
          <RailButton
            active={cleanupActive}
            icon={SearchCheck}
            label="Cleanup"
            onClick={() => onNavigate("cleanup")}
          />
          <RailButton
            active={active === "history"}
            icon={History}
            label="History"
            onClick={() => onNavigate("history")}
          />
        </nav>
        <div className="rail-footer">
          <RailButton
            active={active === "settings"}
            icon={Settings}
            label="Settings"
            onClick={() => onNavigate("settings")}
          />
          <button
            aria-expanded={!collapsed}
            aria-label={
              collapsed ? "Show navigation panel" : "Hide navigation panel"
            }
            className="rail-button rail-collapse"
            onClick={onToggleCollapsed}
            title={
              collapsed ? "Show navigation panel" : "Hide navigation panel"
            }
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={18} />
            <span className="rail-tooltip">
              {collapsed ? "Show navigation" : "Hide navigation"}
            </span>
          </button>
        </div>
      </div>

      <div className="sidebar-panel">
        <header className="library-identity">
          <div className="library-avatar" aria-hidden="true">
            <Library size={21} strokeWidth={1.7} />
          </div>
          <div className="library-identity-copy">
            <span>Connected library</span>
            <strong>osu!lazer</strong>
            <small title={configuredPath}>{libraryFolder}</small>
          </div>
        </header>
        <div
          aria-label="Current library state"
          className="library-state"
          role="status"
        >
          <span>
            <i aria-hidden="true" className="state-dot indexed" />
            {status.indexedDifficulties.toLocaleString()} indexed
          </span>
          <span>
            <i
              aria-hidden="true"
              className={`state-dot ${status.osuIsRunning ? "warning" : "ready"}`}
            />
            {status.osuIsRunning ? "osu! is open" : "osu! is closed"}
          </span>
        </div>

        <nav className="sidebar-scroll" aria-label="Library navigation">
          <NavButton
            active={active === "dashboard"}
            item={{ id: "dashboard", label: "Overview", icon: BarChart3 }}
            onClick={() => onNavigate("dashboard")}
          />

          <div className="sidebar-section">
            <div className="sidebar-heading">Library</div>
            {libraryItems.map((item) => (
              <NavButton
                key={item.id}
                active={active === item.id}
                item={item}
                onClick={() => onNavigate(item.id)}
              />
            ))}
          </div>

          <div className="sidebar-section">
            <div className="sidebar-heading">Game modes</div>
            {modeItems.map((item) => (
              <NavButton
                key={item.id}
                active={active === item.id}
                item={item}
                onClick={() => onNavigate(item.id)}
              />
            ))}
          </div>

          <div className="sidebar-section">
            <div className="sidebar-heading">Management</div>
            {managementItems.map((item) => (
              <NavButton
                key={item.id}
                active={active === item.id}
                item={item}
                onClick={() => onNavigate(item.id)}
              />
            ))}
          </div>

          {savedSearches.length > 0 && (
            <div className="sidebar-section">
              <div className="sidebar-heading">Saved filters</div>
              {savedSearches.map((search) => {
                const searchActive = active === `saved:${search.id}`;
                return (
                  <button
                    aria-current={searchActive ? "page" : undefined}
                    className={`sidebar-item ${searchActive ? "active" : ""}`}
                    key={search.id}
                    onClick={() => onNavigate(`saved:${search.id}`)}
                    type="button"
                  >
                    <Gauge aria-hidden="true" size={17} />
                    <span>{search.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </nav>
      </div>
    </aside>
  );
}
