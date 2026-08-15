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
import type { SavedSearch } from "../../../shared/contracts";

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
    badge: "Unavailable",
  },
  { id: "history", label: "Operation History", icon: History },
];

function NavButton({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: NavigationItem;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const Icon = item.icon;
  return (
    <button
      className={`sidebar-item ${active ? "active" : ""}`}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      type="button"
    >
      <Icon aria-hidden="true" size={17} strokeWidth={1.9} />
      {!collapsed && <span>{item.label}</span>}
      {!collapsed && item.badge && (
        <span className="sidebar-badge">{item.badge}</span>
      )}
    </button>
  );
}

export function Sidebar({
  active,
  collapsed,
  savedSearches,
  onNavigate,
  onToggleCollapsed,
}: SidebarProps): React.JSX.Element {
  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span />
        </div>
        {!collapsed && (
          <div>
            <strong>lazer library</strong>
            <span>manager</span>
          </div>
        )}
      </div>

      <nav className="sidebar-scroll" aria-label="Primary navigation">
        <NavButton
          active={active === "dashboard"}
          collapsed={collapsed}
          item={{ id: "dashboard", label: "Overview", icon: BarChart3 }}
          onClick={() => onNavigate("dashboard")}
        />

        <div className="sidebar-section">
          {!collapsed && <div className="sidebar-heading">Library</div>}
          {libraryItems.map((item) => (
            <NavButton
              key={item.id}
              active={active === item.id}
              collapsed={collapsed}
              item={item}
              onClick={() => onNavigate(item.id)}
            />
          ))}
        </div>

        <div className="sidebar-section">
          {!collapsed && <div className="sidebar-heading">Game modes</div>}
          {modeItems.map((item) => (
            <NavButton
              key={item.id}
              active={active === item.id}
              collapsed={collapsed}
              item={item}
              onClick={() => onNavigate(item.id)}
            />
          ))}
        </div>

        <div className="sidebar-section">
          {!collapsed && <div className="sidebar-heading">Management</div>}
          {managementItems.map((item) => (
            <NavButton
              key={item.id}
              active={active === item.id}
              collapsed={collapsed}
              item={item}
              onClick={() => onNavigate(item.id)}
            />
          ))}
        </div>

        {savedSearches.length > 0 && (
          <div className="sidebar-section">
            {!collapsed && <div className="sidebar-heading">Saved filters</div>}
            {savedSearches.map((search) => (
              <button
                className={`sidebar-item ${active === `saved:${search.id}` ? "active" : ""}`}
                key={search.id}
                onClick={() => onNavigate(`saved:${search.id}`)}
                title={collapsed ? search.name : undefined}
                type="button"
              >
                <Gauge aria-hidden="true" size={17} />
                {!collapsed && <span>{search.name}</span>}
              </button>
            ))}
          </div>
        )}
      </nav>

      <div className="sidebar-footer">
        <NavButton
          active={active === "settings"}
          collapsed={collapsed}
          item={{ id: "settings", label: "Settings", icon: Settings }}
          onClick={() => onNavigate("settings")}
        />
        <button
          className="collapse-button"
          onClick={onToggleCollapsed}
          type="button"
        >
          <ChevronLeft size={15} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
