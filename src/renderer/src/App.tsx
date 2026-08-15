import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Database,
  FolderSearch,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type {
  AppBuildInfo,
  AppSettings,
  BeatmapDifficulty,
  DeletionResult,
  FilterCondition,
  FilterGroup,
  LibraryQuery,
  LibraryQueryResult,
  LibraryStatistics,
  LibraryStatus,
  OperationRecord,
  QuarantineRecord,
  SavedSearch,
  ScanProgress,
  SerializableSelection,
  SortField,
} from "../../shared/contracts";
import { EMPTY_FILTER_GROUP } from "../../shared/contracts";
import { parseQuickSearch } from "../../shared/quick-search";
import {
  emptySelection,
  invertVisible,
  selectAllFiltered,
  selectedCount,
  selectRange,
  toggleSelected,
  type SelectionState,
} from "../../shared/selection";
import {
  BulkToolbar,
  ProtectedDeletionModal,
  SaveSearchModal,
} from "./components/ActionModals";
import { Dashboard } from "./components/Dashboard";
import { DetailsPanel } from "./components/DetailsPanel";
import { FilterBar } from "./components/FilterBar";
import { FilterBuilder } from "./components/FilterBuilder";
import { LibraryTable } from "./components/LibraryTable";
import { Onboarding } from "./components/Onboarding";
import {
  CleanupPage,
  FeaturePlaceholder,
  HistoryPage,
  QuarantinePage,
  SettingsPage,
  StoragePage,
} from "./components/Pages";
import { Sidebar, type NavigationTarget } from "./components/Sidebar";
import {
  combineFilters,
  conditionLabel,
  flattenConditions,
  newGroup,
  presetCondition,
  removeFilterNode,
  updateFilterNode,
} from "./lib/filters";

const fallbackBuild: AppBuildInfo = {
  version: "unknown",
  commit: "unknown",
  channel: "development",
  builtAt: new Date(0).toISOString(),
};

const emptyCounts: Omit<LibraryQueryResult, "items"> = {
  totalDifficulties: 0,
  filteredDifficulties: 0,
  filteredSets: 0,
  filteredBytes: 0,
};

function quickGroup(conditions: FilterCondition[]): FilterGroup {
  return {
    kind: "group",
    id: "quick-search-group",
    conjunction: "and",
    negated: false,
    enabled: true,
    children: conditions,
  };
}

function navigationPreset(target: NavigationTarget): FilterGroup {
  switch (target) {
    case "recent":
      return presetCondition(
        "importedAt",
        "afterRelativeDays",
        30,
        "Added within 30 days",
      );
    case "played":
      return presetCondition(
        "lastPlayedAt",
        "afterRelativeDays",
        30,
        "Played within 30 days",
      );
    case "never":
      return presetCondition(
        "lastPlayedAt",
        "isEmpty",
        undefined,
        "No play timestamp",
      );
    case "ranked":
      return presetCondition("status", "equals", "ranked", "Ranked");
    case "loved":
      return presetCondition("status", "equals", "loved", "Loved");
    case "graveyard":
      return presetCondition("status", "equals", "graveyard", "Graveyard");
    case "mode-osu":
      return presetCondition("mode", "equals", "osu", "osu!");
    case "mode-taiko":
      return presetCondition("mode", "equals", "taiko", "osu!taiko");
    case "mode-catch":
      return presetCondition("mode", "equals", "catch", "osu!catch");
    case "mode-mania":
      return presetCondition("mode", "equals", "mania", "osu!mania");
    default:
      return newGroup();
  }
}

function pageTitle(
  target: NavigationTarget | `saved:${string}`,
  savedSearches: SavedSearch[],
): string {
  if (target.startsWith("saved:"))
    return (
      savedSearches.find((search) => `saved:${search.id}` === target)?.name ??
      "Saved filter"
    );
  const titles: Record<NavigationTarget, string> = {
    dashboard: "Overview",
    all: "All Beatmaps",
    recent: "Recently Added",
    played: "Recently Played",
    never: "No Play Recorded",
    ranked: "Ranked",
    loved: "Loved",
    graveyard: "Graveyard",
    "mode-osu": "osu!",
    "mode-taiko": "osu!taiko",
    "mode-catch": "osu!catch",
    "mode-mania": "osu!mania",
    collections: "Collections",
    duplicates: "Duplicate Finder",
    storage: "Storage Analyzer",
    cleanup: "Cleanup",
    quarantine: "Quarantine",
    history: "Operation History",
    settings: "Settings",
  };
  return titles[target as NavigationTarget];
}

function isLibraryTarget(
  target: NavigationTarget | `saved:${string}`,
): boolean {
  return (
    target.startsWith("saved:") ||
    [
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
    ].includes(target)
  );
}

export function App(): React.JSX.Element {
  const searchInput = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [build, setBuild] = useState<AppBuildInfo>(fallbackBuild);
  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [operations, setOperations] = useState<OperationRecord[]>([]);
  const [quarantineRecords, setQuarantineRecords] = useState<
    QuarantineRecord[]
  >([]);
  const [statistics, setStatistics] = useState<LibraryStatistics | null>(null);
  const [statisticsLoading, setStatisticsLoading] = useState(false);
  const [active, setActive] = useState<NavigationTarget | `saved:${string}`>(
    "dashboard",
  );
  const [collapsedSidebar, setCollapsedSidebar] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [manualFilters, setManualFilters] = useState<FilterGroup>(() =>
    newGroup(),
  );
  const [presetFilters, setPresetFilters] = useState<FilterGroup>(() =>
    newGroup(),
  );
  const [sort, setSort] = useState<LibraryQuery["sort"]>({
    field: "artist",
    direction: "asc",
  });
  const [selection, setSelection] = useState<SelectionState>(() =>
    emptySelection(),
  );
  const [counts, setCounts] = useState(emptyCounts);
  const [loadedRecords, setLoadedRecords] = useState<
    Map<string, BeatmapDifficulty>
  >(new Map());
  const [details, setDetails] = useState<BeatmapDifficulty | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filterBuilderOpen, setFilterBuilderOpen] = useState(false);
  const [saveSearchOpen, setSaveSearchOpen] = useState(false);
  const [deletionRequest, setDeletionRequest] = useState<{
    query: LibraryQuery;
    selection: SerializableSelection;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 180);
    return () => window.clearTimeout(timer);
  }, [search]);

  const refreshStatistics = useCallback(async (): Promise<void> => {
    setStatisticsLoading(true);
    try {
      setStatistics(
        await window.libraryManager.getStatistics(EMPTY_FILTER_GROUP),
      );
    } finally {
      setStatisticsLoading(false);
    }
  }, []);

  useEffect(() => {
    let activeEffect = true;
    void Promise.all([
      window.libraryManager.getBuildInfo(),
      window.libraryManager.getLibraryStatus(),
      window.libraryManager.getSettings(),
      window.libraryManager.getSavedSearches(),
      window.libraryManager.getOperationHistory(),
      window.libraryManager.getQuarantineRecords(),
    ])
      .then(
        async ([
          nextBuild,
          nextStatus,
          nextSettings,
          searches,
          history,
          quarantine,
        ]) => {
          if (!activeEffect) return;
          setBuild(nextBuild);
          setStatus(nextStatus);
          setSettings(nextSettings);
          setSavedSearches(searches);
          setOperations(history);
          setQuarantineRecords(quarantine);
          if (nextStatus.indexedDifficulties > 0) await refreshStatistics();
        },
      )
      .catch((error: unknown) => {
        if (activeEffect)
          setFatalError(
            error instanceof Error
              ? error.message
              : "The application failed to start.",
          );
      })
      .finally(() => {
        if (activeEffect) setLoading(false);
      });
    const unsubscribe = window.libraryManager.onScanProgress((progress) =>
      setScanProgress(progress),
    );
    return () => {
      activeEffect = false;
      unsubscribe();
    };
  }, [refreshStatistics]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const parsedSearch = useMemo(
    () => parseQuickSearch(debouncedSearch),
    [debouncedSearch],
  );
  const effectiveFilters = useMemo(
    () =>
      combineFilters(
        presetFilters,
        manualFilters,
        quickGroup(parsedSearch.conditions),
      ),
    [manualFilters, parsedSearch.conditions, presetFilters],
  );
  const queryBase = useMemo<Omit<LibraryQuery, "offset" | "limit">>(
    () => ({ text: parsedSearch.text, filters: effectiveFilters, sort }),
    [effectiveFilters, parsedSearch.text, sort],
  );
  const queryFilterKey = useMemo(
    () => JSON.stringify([queryBase.text, queryBase.filters]),
    [queryBase.filters, queryBase.text],
  );
  useEffect(() => {
    queueMicrotask(() => {
      setSelection(emptySelection());
      setDetails(null);
    });
  }, [queryFilterKey]);

  const selectedTotal = selectedCount(selection, counts.filteredDifficulties);
  const allFilterConditions = [
    ...flattenConditions(presetFilters),
    ...flattenConditions(manualFilters),
    ...parsedSearch.conditions,
  ];

  const openDeletionPreview = useCallback((): void => {
    setDeletionRequest({
      query: structuredClone({
        ...queryBase,
        offset: 0,
        limit: 200,
      }),
      selection: {
        mode: selection.mode,
        included: [...selection.included],
        excluded: [...selection.excluded],
      },
    });
  }, [queryBase, selection]);

  const refreshQuarantine = useCallback(async (): Promise<void> => {
    const [nextStatus, records] = await Promise.all([
      window.libraryManager.getLibraryStatus(),
      window.libraryManager.getQuarantineRecords(),
    ]);
    setStatus(nextStatus);
    setQuarantineRecords(records);
  }, []);

  const refreshAfterMutation = useCallback(
    async (result: DeletionResult): Promise<void> => {
      const [nextStatus, history, quarantine] = await Promise.all([
        window.libraryManager.getLibraryStatus(),
        window.libraryManager.getOperationHistory(),
        window.libraryManager.getQuarantineRecords(),
      ]);
      setStatus(nextStatus);
      setOperations(history);
      setQuarantineRecords(quarantine);
      setSelection(emptySelection());
      setDetails(null);
      setRefreshKey((value) => value + 1);
      if (nextStatus.indexedDifficulties > 0) await refreshStatistics();
      setToast(result.message);
    },
    [refreshStatistics],
  );

  const restoreQuarantineRecord = async (
    operationId: string,
  ): Promise<DeletionResult> => {
    const result = await window.libraryManager.restoreQuarantine(operationId);
    await refreshAfterMutation(result);
    return result;
  };

  const setLibrary = async (path: string): Promise<void> => {
    const nextStatus = await window.libraryManager.setLibraryPath(path);
    setStatus(nextStatus);
    setSettings(await window.libraryManager.getSettings());
  };

  const chooseLibrary = async (): Promise<void> => {
    const candidate = await window.libraryManager.chooseLibrary();
    if (candidate) await setLibrary(candidate.path);
  };

  const scan = async (): Promise<void> => {
    if (!status || status.osuIsRunning) {
      setToast("Close osu!lazer before starting a fresh scan.");
      return;
    }
    setStatus({ ...status, scanInProgress: true });
    try {
      await window.libraryManager.startScan();
      const [nextStatus, history] = await Promise.all([
        window.libraryManager.getLibraryStatus(),
        window.libraryManager.getOperationHistory(),
      ]);
      setStatus(nextStatus);
      setOperations(history);
      setRefreshKey((value) => value + 1);
      await refreshStatistics();
      setToast("Library index updated successfully.");
    } catch (error) {
      setStatus(await window.libraryManager.getLibraryStatus());
      setToast(error instanceof Error ? error.message : "The scan failed.");
    }
  };

  const navigate = (target: NavigationTarget | `saved:${string}`): void => {
    setActive(target);
    setDetails(null);
    if (target === "quarantine")
      void refreshQuarantine().catch((caught: unknown) =>
        setToast(
          caught instanceof Error
            ? caught.message
            : "Recovery records could not be refreshed.",
        ),
      );
    if (target.startsWith("saved:")) {
      const saved = savedSearches.find((item) => `saved:${item.id}` === target);
      if (saved) {
        setPresetFilters(newGroup());
        setManualFilters(structuredClone(saved.query.filters));
        setSearch(saved.query.text);
        setSort(saved.query.sort);
      }
      return;
    }
    if (isLibraryTarget(target))
      setPresetFilters(navigationPreset(target as NavigationTarget));
  };

  const openFilteredLibrary = (condition: FilterCondition): void => {
    setActive("all");
    setPresetFilters(newGroup());
    setManualFilters({ ...newGroup(), children: [condition] });
  };

  const applyCleanupPreset = (
    preset: "never" | "old" | "easy" | "large" | "video",
  ): void => {
    const conditions: Record<typeof preset, FilterCondition> = {
      never: {
        kind: "condition",
        id: crypto.randomUUID(),
        field: "lastPlayedAt",
        operator: "isEmpty",
        label: "No play timestamp",
        enabled: true,
      },
      old: {
        kind: "condition",
        id: crypto.randomUUID(),
        field: "lastPlayedAt",
        operator: "beforeRelativeDays",
        value: 730,
        label: "Not played in 2 years",
        enabled: true,
      },
      easy: {
        kind: "condition",
        id: crypto.randomUUID(),
        field: "starRating",
        operator: "lessThan",
        value: 2,
        label: "Below 2★",
        enabled: true,
      },
      large: {
        kind: "condition",
        id: crypto.randomUUID(),
        field: "storageBytes",
        operator: "greaterThan",
        value: 100 * 1024 ** 2,
        label: "Set larger than 100 MB",
        enabled: true,
      },
      video: {
        kind: "condition",
        id: crypto.randomUUID(),
        field: "hasVideo",
        operator: "isTrue",
        label: "Contains video",
        enabled: true,
      },
    };
    openFilteredLibrary(conditions[preset]);
  };

  const updateSettings = async (patch: Partial<AppSettings>): Promise<void> => {
    setSettings(await window.libraryManager.updateSettings(patch));
  };

  const toggleSelection = (
    id: string,
    shift: boolean,
    orderedIds: string[],
  ): void => {
    setSelection((current) =>
      shift
        ? selectRange(current, orderedIds, id)
        : toggleSelected(current, id),
    );
  };

  const copySelection = async (): Promise<void> => {
    const copied = await window.libraryManager.copySelectionMetadata(
      { ...queryBase, offset: 0, limit: 200 },
      {
        mode: selection.mode,
        included: [...selection.included],
        excluded: [...selection.excluded],
      },
    );
    setToast(`Copied metadata for ${copied.toLocaleString()} difficulties.`);
  };

  const saveCurrentSearch = async (name: string): Promise<void> => {
    await window.libraryManager.saveSearch(name, queryBase);
    setSavedSearches(await window.libraryManager.getSavedSearches());
    setToast(`Saved “${name}”.`);
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const editing =
        target?.matches('input, textarea, select, [contenteditable="true"]') ??
        false;
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFilterBuilderOpen(true);
      } else if (event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInput.current?.focus();
      } else if (
        event.ctrlKey &&
        event.key.toLowerCase() === "a" &&
        isLibraryTarget(active) &&
        !editing
      ) {
        event.preventDefault();
        setSelection(selectAllFiltered());
      } else if (event.key === "Delete" && selectedTotal > 0 && !editing) {
        event.preventDefault();
        openDeletionPreview();
      } else if (event.key === "Escape") {
        if (deletionRequest) return;
        if (filterBuilderOpen) setFilterBuilderOpen(false);
        else if (details) setDetails(null);
        else setSelection(emptySelection());
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    active,
    deletionRequest,
    details,
    filterBuilderOpen,
    openDeletionPreview,
    selectedTotal,
  ]);

  if (loading) {
    return (
      <main className="startup-screen">
        <div className="brand-mark large">
          <span />
        </div>
        <LoaderCircle className="spin" size={24} />
        <span>Opening the local index…</span>
      </main>
    );
  }
  if (fatalError || !status || !settings) {
    return (
      <main className="startup-screen error">
        <AlertCircle size={28} />
        <strong>Couldn’t start the library manager</strong>
        <p>{fatalError ?? "Required application state is unavailable."}</p>
      </main>
    );
  }
  if (!status.configuredPath) {
    return (
      <Onboarding
        build={build}
        onChoose={chooseLibrary}
        onUseCandidate={(candidate) => setLibrary(candidate.path)}
        status={status}
      />
    );
  }

  const libraryPage = isLibraryTarget(active);
  const title = pageTitle(active, savedSearches);

  return (
    <div className={`app-shell ${details ? "details-open" : ""}`}>
      <Sidebar
        active={active}
        collapsed={collapsedSidebar}
        onNavigate={navigate}
        onToggleCollapsed={() => setCollapsedSidebar((value) => !value)}
        savedSearches={savedSearches}
        status={status}
      />
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Library Manager</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            {status.osuIsRunning && (
              <span className="running-pill">
                <AlertCircle size={14} /> osu!lazer running
              </span>
            )}
            <span className="readonly-pill">
              <ShieldCheck size={14} />
              {status.capabilities.writeLibrary
                ? "Protected writes"
                : "Read-only compatibility"}
            </span>
            <button
              className="scan-button"
              disabled={status.scanInProgress || status.osuIsRunning}
              onClick={() => void scan()}
              type="button"
            >
              {status.scanInProgress ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <RefreshCw size={15} />
              )}
              {status.scanInProgress ? "Scanning…" : "Rescan"}
            </button>
          </div>
        </header>

        {status.scanInProgress && scanProgress && (
          <div className="scan-strip">
            <div>
              <Database size={14} />
              <span>{scanProgress.message}</span>
              <strong>{scanProgress.imported.toLocaleString()} indexed</strong>
              <button
                onClick={() => void window.libraryManager.cancelScan()}
                type="button"
              >
                Cancel
              </button>
            </div>
            <span
              style={{
                width:
                  scanProgress.discovered > 0
                    ? `${Math.min(100, (scanProgress.processed / scanProgress.discovered) * 100)}%`
                    : "18%",
              }}
            />
          </div>
        )}

        {status.indexedDifficulties === 0 && (
          <div className="first-scan-banner">
            <div className="first-scan-icon">
              <FolderSearch size={19} />
            </div>
            <div>
              <strong>Ready for the first read-only scan</strong>
              <span>
                A temporary Realm snapshot will be validated, indexed, and
                immediately removed.
              </span>
            </div>
            <button
              className="primary-button"
              disabled={status.osuIsRunning || status.scanInProgress}
              onClick={() => void scan()}
              type="button"
            >
              Build library index
            </button>
          </div>
        )}

        {libraryPage ? (
          <section className="library-page">
            <div className="library-heading">
              <div>
                <span className="eyebrow">Library browser</span>
                <h1>{title}</h1>
              </div>
              <div
                className="library-counts"
                aria-label="Library, filtered, and selected counts"
              >
                <div>
                  <strong>{counts.totalDifficulties.toLocaleString()}</strong>
                  <span>all difficulties</span>
                </div>
                <i />
                <div>
                  <strong>
                    {counts.filteredDifficulties.toLocaleString()}
                  </strong>
                  <span>match filters</span>
                </div>
                <i />
                <div className={selectedTotal > 0 ? "selected-count" : ""}>
                  <strong>{selectedTotal.toLocaleString()}</strong>
                  <span>selected</span>
                </div>
              </div>
            </div>
            <FilterBar
              manualConditions={flattenConditions(manualFilters)}
              onClearAll={() => {
                setSearch("");
                setManualFilters(newGroup());
                setPresetFilters(newGroup());
              }}
              onOpenBuilder={() => setFilterBuilderOpen(true)}
              onRemoveManual={(id) =>
                setManualFilters((group) => removeFilterNode(group, id))
              }
              onRemoveQuick={(id) => {
                const index = Number(id.replace("quick-", ""));
                const tokens = search.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
                setSearch(
                  tokens
                    .filter((_token, tokenIndex) => tokenIndex !== index)
                    .join(" "),
                );
              }}
              onSaveSearch={() => setSaveSearchOpen(true)}
              onSearchChange={setSearch}
              onToggleManual={(id) =>
                setManualFilters((group) =>
                  updateFilterNode(group, id, (node) => ({
                    ...node,
                    enabled: !node.enabled,
                  })),
                )
              }
              quickConditions={parsedSearch.conditions}
              ref={searchInput}
              search={search}
              searchErrors={parsedSearch.errors}
            />
            {selectedTotal > 0 && (
              <BulkToolbar
                onClear={() => setSelection(emptySelection())}
                onCopy={() => void copySelection()}
                onDelete={openDeletionPreview}
                onInvert={() =>
                  setSelection((current) =>
                    invertVisible(current, [...loadedRecords.keys()]),
                  )
                }
                selectedAllFiltered={selection.mode === "all-filtered"}
                selectedCount={selectedTotal}
              />
            )}
            <LibraryTable
              density={settings.density}
              onClearSelection={() => setSelection(emptySelection())}
              onCounts={setCounts}
              onLoadedRecords={setLoadedRecords}
              onOpenDetails={setDetails}
              onSelectAll={() => setSelection(selectAllFiltered())}
              onSort={(field: SortField) =>
                setSort((current) => ({
                  field,
                  direction:
                    current.field === field && current.direction === "asc"
                      ? "desc"
                      : "asc",
                }))
              }
              onToggleSelected={toggleSelection}
              query={queryBase}
              refreshKey={refreshKey}
              selection={selection}
            />
          </section>
        ) : active === "dashboard" ? (
          <Dashboard
            loading={statisticsLoading}
            onApplyFilter={openFilteredLibrary}
            onOpenLibrary={() => navigate("all")}
            statistics={statistics}
          />
        ) : active === "storage" ? (
          <StoragePage
            onBrowseLargest={() => {
              setSort({ field: "storageBytes", direction: "desc" });
              navigate("all");
            }}
            onShowVideos={() => applyCleanupPreset("video")}
            statistics={statistics}
          />
        ) : active === "cleanup" ? (
          <CleanupPage onPreset={applyCleanupPreset} />
        ) : active === "quarantine" ? (
          <QuarantinePage
            onRefresh={refreshQuarantine}
            onRestore={restoreQuarantineRecord}
            osuIsRunning={status.osuIsRunning}
            records={quarantineRecords}
          />
        ) : active === "history" ? (
          <HistoryPage operations={operations} />
        ) : active === "settings" ? (
          <SettingsPage
            build={build}
            onChooseLibrary={chooseLibrary}
            onOpenDocs={() =>
              void window.libraryManager.openExternal(
                "https://github.com/LaLinea08/osulazer_librarymanager",
              )
            }
            onScan={scan}
            onUpdate={updateSettings}
            settings={settings}
            status={status}
          />
        ) : active === "collections" || active === "duplicates" ? (
          <FeaturePlaceholder type={active} />
        ) : (
          <FeaturePlaceholder type="duplicates" />
        )}
      </main>

      <DetailsPanel onClose={() => setDetails(null)} record={details} />
      {filterBuilderOpen && (
        <FilterBuilder
          filters={manualFilters}
          onApply={setManualFilters}
          onClose={() => setFilterBuilderOpen(false)}
          open
        />
      )}
      {saveSearchOpen && (
        <SaveSearchModal
          onClose={() => setSaveSearchOpen(false)}
          onSave={saveCurrentSearch}
          open
        />
      )}
      {deletionRequest && (
        <ProtectedDeletionModal
          filterLabels={allFilterConditions.map(conditionLabel)}
          onClose={() => setDeletionRequest(null)}
          onMutation={refreshAfterMutation}
          open
          query={deletionRequest.query}
          selection={deletionRequest.selection}
        />
      )}
      {toast && (
        <div className="toast">
          <Check size={15} /> {toast}
        </div>
      )}
    </div>
  );
}
