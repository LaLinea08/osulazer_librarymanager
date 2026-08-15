import { forwardRef } from "react";
import { BookmarkPlus, Filter, Search, X } from "lucide-react";
import type { FilterCondition } from "../../../shared/contracts";
import { conditionLabel } from "../lib/filters";

interface FilterBarProps {
  search: string;
  manualConditions: FilterCondition[];
  quickConditions: FilterCondition[];
  searchErrors: string[];
  onSearchChange: (value: string) => void;
  onOpenBuilder: () => void;
  onSaveSearch: () => void;
  onRemoveManual: (id: string) => void;
  onToggleManual: (id: string) => void;
  onRemoveQuick: (id: string) => void;
  onClearAll: () => void;
}

export const FilterBar = forwardRef<HTMLInputElement, FilterBarProps>(
  function FilterBar(
    {
      search,
      manualConditions,
      quickConditions,
      searchErrors,
      onSearchChange,
      onOpenBuilder,
      onSaveSearch,
      onRemoveManual,
      onToggleManual,
      onRemoveQuick,
      onClearAll,
    },
    ref,
  ): React.JSX.Element {
    const hasFilters =
      manualConditions.length > 0 || quickConditions.length > 0;
    return (
      <div className="filter-bar-wrap">
        <div className="filter-bar">
          <label className="search-box">
            <Search aria-hidden="true" size={18} />
            <input
              aria-label="Search beatmaps"
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search or use stars:4..6 bpm:>180 mode:mania"
              ref={ref}
              spellCheck="false"
              value={search}
            />
            {search && (
              <button
                aria-label="Clear search"
                onClick={() => onSearchChange("")}
                type="button"
              >
                <X size={15} />
              </button>
            )}
            <kbd>Ctrl F</kbd>
          </label>
          <button
            className="secondary-button"
            onClick={onOpenBuilder}
            type="button"
          >
            <Filter size={16} /> Filters
            {manualConditions.length > 0 && (
              <span className="button-count">{manualConditions.length}</span>
            )}
          </button>
          <button
            className="icon-button bordered"
            onClick={onSaveSearch}
            title="Save current search"
            type="button"
          >
            <BookmarkPlus size={17} />
          </button>
        </div>
        {(hasFilters || searchErrors.length > 0) && (
          <div className="filter-chips-row">
            <span className="filter-chips-label">Active</span>
            {quickConditions.map((condition) => (
              <span className="filter-chip quick" key={condition.id}>
                {conditionLabel(condition)}
                <button
                  aria-label={`Remove ${conditionLabel(condition)}`}
                  onClick={() => onRemoveQuick(condition.id)}
                  type="button"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {manualConditions.map((condition) => (
              <span
                className={`filter-chip ${condition.enabled ? "" : "disabled"}`}
                key={condition.id}
              >
                <button
                  className="chip-label-button"
                  onClick={() => onToggleManual(condition.id)}
                  title={condition.enabled ? "Temporarily disable" : "Enable"}
                  type="button"
                >
                  {conditionLabel(condition)}
                </button>
                <button
                  aria-label={`Remove ${conditionLabel(condition)}`}
                  onClick={() => onRemoveManual(condition.id)}
                  type="button"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {searchErrors.map((error) => (
              <span className="filter-error" key={error}>
                {error}
              </span>
            ))}
            <button
              className="clear-filters"
              onClick={onClearAll}
              type="button"
            >
              Clear all
            </button>
          </div>
        )}
      </div>
    );
  },
);
