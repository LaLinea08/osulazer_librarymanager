import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ExternalLink,
  LoaderCircle,
} from "lucide-react";
import type {
  AppSettings,
  BeatmapDifficulty,
  LibraryQuery,
  LibraryQueryResult,
  SortField,
} from "../../../shared/contracts";
import type { SelectionState } from "../../../shared/selection";
import { isSelected } from "../../../shared/selection";
import {
  formatBytes,
  formatDate,
  formatDuration,
  formatRelativeDate,
  titleCase,
} from "../lib/format";

interface LibraryTableProps {
  query: Omit<LibraryQuery, "offset" | "limit">;
  selection: SelectionState;
  density: AppSettings["density"];
  refreshKey: number;
  onCounts: (counts: Omit<LibraryQueryResult, "items">) => void;
  onSort: (field: SortField) => void;
  onToggleSelected: (
    id: string,
    shift: boolean,
    orderedLoadedIds: string[],
  ) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onOpenDetails: (record: BeatmapDifficulty) => void;
  onLoadedRecords: (records: Map<string, BeatmapDifficulty>) => void;
}

interface Column {
  field?: SortField;
  label: string;
  className: string;
}

const columns: Column[] = [
  { label: "", className: "check-column" },
  { field: "title", label: "Beatmap", className: "beatmap-column" },
  {
    field: "difficultyName",
    label: "Difficulty",
    className: "difficulty-column",
  },
  { field: "mapper", label: "Mapper", className: "mapper-column" },
  { field: "mode", label: "Mode", className: "mode-column" },
  { field: "starRating", label: "Stars", className: "number-column" },
  { field: "bpm", label: "BPM", className: "number-column" },
  { field: "durationSeconds", label: "Length", className: "number-column" },
  { field: "status", label: "Status", className: "status-column" },
  { field: "lastPlayedAt", label: "Last played", className: "date-column" },
  { field: "storageBytes", label: "Set size", className: "size-column" },
];

function sortIcon(
  query: LibraryTableProps["query"],
  field?: SortField,
): React.JSX.Element | null {
  if (!field) return null;
  if (query.sort.field !== field) return <ArrowUpDown size={12} />;
  return query.sort.direction === "asc" ? (
    <ArrowUp size={12} />
  ) : (
    <ArrowDown size={12} />
  );
}

function TableRow({
  record,
  selected,
  shiftSelect,
  onOpenDetails,
  onToggleSelected,
}: {
  record: BeatmapDifficulty;
  selected: boolean;
  shiftSelect: boolean;
  onOpenDetails: () => void;
  onToggleSelected: (shift: boolean) => void;
}): React.JSX.Element {
  const onlineUrl = record.beatmapId
    ? `https://osu.ppy.sh/beatmaps/${record.beatmapId}`
    : record.beatmapSetId
      ? `https://osu.ppy.sh/beatmapsets/${record.beatmapSetId}`
      : null;

  return (
    <div
      aria-selected={selected}
      className={`table-row ${selected ? "selected" : ""}`}
      onClick={onOpenDetails}
      onDoubleClick={() =>
        onlineUrl && void window.libraryManager.openExternal(onlineUrl)
      }
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          onOpenDetails();
        }
      }}
      role="row"
      tabIndex={0}
    >
      <div
        className="table-cell check-column"
        onClick={(event) => event.stopPropagation()}
        role="cell"
      >
        <label className="row-checkbox">
          <input
            aria-label={`Select ${record.artist} – ${record.title} [${record.difficultyName}]`}
            checked={selected}
            onChange={(event) =>
              onToggleSelected(
                event.nativeEvent instanceof MouseEvent
                  ? event.nativeEvent.shiftKey
                  : shiftSelect,
              )
            }
            type="checkbox"
          />
          <span />
        </label>
      </div>
      <div className="table-cell beatmap-column" role="cell">
        <div className={`cover-tile mode-${record.mode}`} aria-hidden="true">
          <span>
            {record.mode === "unknown" ? "?" : record.mode[0]?.toUpperCase()}
          </span>
        </div>
        <div className="beatmap-copy">
          <strong title={`${record.artist} – ${record.title}`}>
            {record.title}
          </strong>
          <span title={record.artist}>{record.artist}</span>
        </div>
        {onlineUrl && <ExternalLink className="row-external" size={13} />}
      </div>
      <div
        className="table-cell difficulty-column"
        role="cell"
        title={record.difficultyName}
      >
        <span>{record.difficultyName}</span>
      </div>
      <div
        className="table-cell mapper-column muted-cell"
        role="cell"
        title={record.mapper}
      >
        {record.mapper}
      </div>
      <div className="table-cell mode-column" role="cell">
        <span className={`mode-pill mode-${record.mode}`}>
          {record.mode === "catch" ? "catch" : record.mode}
        </span>
      </div>
      <div className="table-cell number-column rating-cell" role="cell">
        {record.starRating === null ? (
          <span className="unavailable">—</span>
        ) : (
          `${record.starRating.toFixed(2)}★`
        )}
      </div>
      <div className="table-cell number-column" role="cell">
        {record.bpm === null ? (
          <span className="unavailable">—</span>
        ) : (
          Math.round(record.bpm)
        )}
      </div>
      <div className="table-cell number-column" role="cell">
        {formatDuration(record.durationSeconds)}
      </div>
      <div className="table-cell status-column" role="cell">
        <span className={`status-pill status-${record.status}`}>
          {titleCase(record.status)}
        </span>
      </div>
      <div
        className="table-cell date-column"
        role="cell"
        title={formatDate(record.lastPlayedAt)}
      >
        {formatRelativeDate(record.lastPlayedAt)}
      </div>
      <div
        className="table-cell size-column"
        role="cell"
        title="Logical size of unique resources referenced by this set"
      >
        {formatBytes(record.storageBytes)}
      </div>
    </div>
  );
}

export function LibraryTable({
  query,
  selection,
  density,
  refreshKey,
  onCounts,
  onSort,
  onToggleSelected,
  onSelectAll,
  onClearSelection,
  onOpenDetails,
  onLoadedRecords,
}: LibraryTableProps): React.JSX.Element {
  const pageSize = 200;
  const scrollElement = useRef<HTMLDivElement>(null);
  const queryGeneration = useRef(0);
  const loadingPages = useRef(new Set<number>());
  const [pages, setPages] = useState<Map<number, BeatmapDifficulty[]>>(
    new Map(),
  );
  const [counts, setCounts] = useState({
    totalDifficulties: 0,
    filteredDifficulties: 0,
    filteredSets: 0,
    filteredBytes: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const queryKey = useMemo(
    () => JSON.stringify([query, refreshKey]),
    [query, refreshKey],
  );

  const loadPage = useCallback(
    async (page: number, generation: number): Promise<void> => {
      if (loadingPages.current.has(page)) return;
      loadingPages.current.add(page);
      try {
        const result = await window.libraryManager.queryLibrary({
          ...query,
          offset: page * pageSize,
          limit: pageSize,
        });
        if (queryGeneration.current !== generation) return;
        const nextCounts = {
          totalDifficulties: result.totalDifficulties,
          filteredDifficulties: result.filteredDifficulties,
          filteredSets: result.filteredSets,
          filteredBytes: result.filteredBytes,
        };
        setCounts(nextCounts);
        onCounts(nextCounts);
        setPages((current) => new Map(current).set(page, result.items));
        setError(null);
      } catch (caught) {
        if (queryGeneration.current === generation) {
          setError(
            caught instanceof Error
              ? caught.message
              : "The library query failed.",
          );
        }
      } finally {
        loadingPages.current.delete(page);
        if (queryGeneration.current === generation) setInitialLoading(false);
      }
    },
    [onCounts, query],
  );

  useEffect(() => {
    queryGeneration.current += 1;
    const generation = queryGeneration.current;
    loadingPages.current.clear();
    setPages(new Map());
    setInitialLoading(true);
    setError(null);
    scrollElement.current?.scrollTo({ top: 0 });
    void loadPage(0, generation);
  }, [loadPage, queryKey]);

  const rowVirtualizer = useVirtualizer({
    count: counts.filteredDifficulties,
    getScrollElement: () => scrollElement.current,
    estimateSize: () => (density === "compact" ? 48 : 58),
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const visiblePages = [
    ...new Set(virtualRows.map((row) => Math.floor(row.index / pageSize))),
  ];
  const visiblePageKey = visiblePages.join(",");

  useEffect(() => {
    const generation = queryGeneration.current;
    const pagesToLoad = visiblePageKey
      ? visiblePageKey.split(",").map(Number)
      : [];
    for (const page of pagesToLoad) {
      if (!pages.has(page)) void loadPage(page, generation);
    }
  }, [loadPage, pages, visiblePageKey]);

  const loadedById = useMemo(() => {
    const records = new Map<string, BeatmapDifficulty>();
    for (const page of [...pages.keys()].sort((left, right) => left - right)) {
      for (const record of pages.get(page) ?? [])
        records.set(record.id, record);
    }
    return records;
  }, [pages]);
  const orderedLoadedIds = useMemo(() => [...loadedById.keys()], [loadedById]);

  useEffect(() => onLoadedRecords(loadedById), [loadedById, onLoadedRecords]);

  const recordAt = (index: number): BeatmapDifficulty | undefined => {
    return pages.get(Math.floor(index / pageSize))?.[index % pageSize];
  };

  return (
    <div
      aria-label="Beatmap difficulties"
      aria-rowcount={counts.filteredDifficulties + 1}
      className={`library-table density-${density}`}
      role="table"
    >
      <div className="table-header" role="row">
        {columns.map((column, index) => (
          <div
            aria-sort={
              column.field && query.sort.field === column.field
                ? query.sort.direction === "asc"
                  ? "ascending"
                  : "descending"
                : undefined
            }
            className={`table-heading ${column.className}`}
            key={`${column.label}-${index}`}
            role="columnheader"
          >
            {index === 0 ? (
              <label className="row-checkbox header-checkbox">
                <input
                  aria-label="Select all filtered results"
                  checked={
                    selection.mode === "all-filtered" &&
                    selection.excluded.size === 0
                  }
                  onChange={() =>
                    selection.mode === "all-filtered"
                      ? onClearSelection()
                      : onSelectAll()
                  }
                  type="checkbox"
                />
                <span />
              </label>
            ) : column.field ? (
              <button onClick={() => onSort(column.field!)} type="button">
                {column.label}
                {sortIcon(query, column.field)}
              </button>
            ) : (
              column.label
            )}
          </div>
        ))}
      </div>
      <div
        aria-busy={initialLoading}
        className="table-scroll"
        ref={scrollElement}
        role="rowgroup"
      >
        {error && (
          <div className="table-state error-state">
            <strong>Couldn’t load this library view</strong>
            <span>{error}</span>
            <button
              className="secondary-button small"
              onClick={() => void loadPage(0, queryGeneration.current)}
              type="button"
            >
              Retry
            </button>
          </div>
        )}
        {!error && initialLoading && (
          <div className="table-state">
            <LoaderCircle className="spin" size={22} />
            <span>Querying the local index…</span>
          </div>
        )}
        {!error && !initialLoading && counts.filteredDifficulties === 0 && (
          <div className="table-state empty-table-state">
            <div className="empty-orbit" aria-hidden="true">
              <span />
            </div>
            <strong>No difficulties match this view</strong>
            <span>Adjust the search or remove a filter chip.</span>
          </div>
        )}
        <div
          className="virtual-space"
          style={{ height: rowVirtualizer.getTotalSize() }}
        >
          {virtualRows.map((virtualRow) => {
            const record = recordAt(virtualRow.index);
            return (
              <div
                className="virtual-row"
                data-index={virtualRow.index}
                key={virtualRow.key}
                ref={rowVirtualizer.measureElement}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {record ? (
                  <TableRow
                    onOpenDetails={() => onOpenDetails(record)}
                    onToggleSelected={(shift) =>
                      onToggleSelected(record.id, shift, orderedLoadedIds)
                    }
                    record={record}
                    selected={isSelected(selection, record.id)}
                    shiftSelect={false}
                  />
                ) : (
                  <div className="table-row skeleton-row" role="row">
                    <span />
                    <span />
                    <span />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
