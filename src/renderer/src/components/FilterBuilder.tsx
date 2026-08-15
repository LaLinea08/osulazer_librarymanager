import { useState } from "react";
import { Brackets, Plus, Trash2, X } from "lucide-react";
import type {
  FilterCondition,
  FilterField,
  FilterGroup,
  FilterOperator,
  FilterNode,
} from "../../../shared/contracts";
import { newCondition, newGroup } from "../lib/filters";

interface FieldDefinition {
  field: FilterField;
  label: string;
  kind: "text" | "number" | "enum" | "boolean" | "date";
  options?: Array<{ value: string; label: string }>;
}

const fields: FieldDefinition[] = [
  { field: "artist", label: "Artist", kind: "text" },
  { field: "title", label: "Title", kind: "text" },
  { field: "difficultyName", label: "Difficulty name", kind: "text" },
  { field: "mapper", label: "Mapper", kind: "text" },
  {
    field: "mode",
    label: "Game mode",
    kind: "enum",
    options: [
      { value: "osu", label: "osu!" },
      { value: "taiko", label: "osu!taiko" },
      { value: "catch", label: "osu!catch" },
      { value: "mania", label: "osu!mania" },
    ],
  },
  {
    field: "status",
    label: "Status",
    kind: "enum",
    options: [
      "ranked",
      "approved",
      "qualified",
      "loved",
      "pending",
      "wip",
      "graveyard",
      "unknown",
    ].map((value) => ({
      value,
      label: value[0]?.toUpperCase() + value.slice(1),
    })),
  },
  { field: "starRating", label: "Star rating", kind: "number" },
  { field: "bpm", label: "BPM", kind: "number" },
  { field: "durationSeconds", label: "Length (seconds)", kind: "number" },
  { field: "approachRate", label: "Approach rate", kind: "number" },
  { field: "overallDifficulty", label: "Overall difficulty", kind: "number" },
  { field: "circleSize", label: "Circle size", kind: "number" },
  { field: "hpDrain", label: "HP drain", kind: "number" },
  { field: "beatmapId", label: "Beatmap ID", kind: "number" },
  { field: "beatmapSetId", label: "Beatmap set ID", kind: "number" },
  { field: "source", label: "Source", kind: "text" },
  { field: "tags", label: "Tags", kind: "text" },
  { field: "importedAt", label: "Date added", kind: "date" },
  { field: "lastPlayedAt", label: "Last played", kind: "date" },
  { field: "localScoreCount", label: "Local score count", kind: "number" },
  { field: "storageBytes", label: "Beatmap set size", kind: "number" },
  { field: "hasVideo", label: "Contains video", kind: "boolean" },
  { field: "hasBackground", label: "Has background", kind: "boolean" },
];

const textOperators: FilterOperator[] = [
  "contains",
  "notContains",
  "equals",
  "notEquals",
  "beginsWith",
  "endsWith",
  "isEmpty",
  "isNotEmpty",
];
const numericOperators: FilterOperator[] = [
  "equals",
  "notEquals",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "between",
  "isEmpty",
  "isNotEmpty",
];
const dateOperators: FilterOperator[] = [
  "beforeRelativeDays",
  "afterRelativeDays",
  "isEmpty",
  "isNotEmpty",
];

const operatorLabels: Record<FilterOperator, string> = {
  contains: "contains",
  notContains: "does not contain",
  equals: "equals",
  notEquals: "does not equal",
  beginsWith: "begins with",
  endsWith: "ends with",
  greaterThan: "is greater than",
  greaterThanOrEqual: "is at least",
  lessThan: "is less than",
  lessThanOrEqual: "is at most",
  between: "is between",
  in: "is one of",
  isTrue: "is true",
  isFalse: "is false",
  isEmpty: "is unavailable",
  isNotEmpty: "is available",
  beforeRelativeDays: "is older than (days)",
  afterRelativeDays: "is within last (days)",
};

function definition(field: FilterField): FieldDefinition {
  return fields.find((item) => item.field === field) ?? fields[0]!;
}

function operatorsFor(field: FilterField): FilterOperator[] {
  const item = definition(field);
  if (item.kind === "boolean") return ["isTrue", "isFalse"];
  if (item.kind === "number") return numericOperators;
  if (item.kind === "date") return dateOperators;
  if (item.kind === "enum") return ["equals", "notEquals"];
  return textOperators;
}

function defaultOperator(field: FilterField): FilterOperator {
  const item = definition(field);
  if (item.kind === "boolean") return "isTrue";
  if (item.kind === "number") return "greaterThanOrEqual";
  if (item.kind === "date") return "beforeRelativeDays";
  if (item.kind === "enum") return "equals";
  return "contains";
}

function ConditionEditor({
  condition,
  onChange,
  onRemove,
}: {
  condition: FilterCondition;
  onChange: (condition: FilterCondition) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const item = definition(condition.field);
  const hasValue = !["isTrue", "isFalse", "isEmpty", "isNotEmpty"].includes(
    condition.operator,
  );

  const updateValue = (raw: string, secondary = false): void => {
    const value =
      item.kind === "number" || item.kind === "date" ? Number(raw) : raw;
    onChange(
      secondary ? { ...condition, valueTo: value } : { ...condition, value },
    );
  };

  return (
    <div className={`condition-row ${condition.enabled ? "" : "disabled"}`}>
      <label
        className="switch mini"
        title="Temporarily enable or disable this condition"
      >
        <input
          checked={condition.enabled}
          onChange={(event) =>
            onChange({ ...condition, enabled: event.target.checked })
          }
          type="checkbox"
        />
        <span />
      </label>
      <select
        aria-label="Filter field"
        value={condition.field}
        onChange={(event) => {
          const field = event.target.value as FilterField;
          const nextDefinition = definition(field);
          onChange({
            ...condition,
            field,
            operator: defaultOperator(field),
            value:
              nextDefinition.options?.[0]?.value ??
              (nextDefinition.kind === "number" ||
              nextDefinition.kind === "date"
                ? 0
                : ""),
            valueTo: undefined,
            label: undefined,
          });
        }}
      >
        {fields.map((field) => (
          <option key={field.field} value={field.field}>
            {field.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Filter operator"
        value={condition.operator}
        onChange={(event) =>
          onChange({
            ...condition,
            operator: event.target.value as FilterOperator,
          })
        }
      >
        {operatorsFor(condition.field).map((operator) => (
          <option key={operator} value={operator}>
            {operatorLabels[operator]}
          </option>
        ))}
      </select>
      {hasValue && item.options ? (
        <select
          aria-label="Filter value"
          value={String(condition.value ?? item.options[0]?.value ?? "")}
          onChange={(event) => updateValue(event.target.value)}
        >
          {item.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : hasValue ? (
        <input
          aria-label="Filter value"
          min={item.kind === "number" || item.kind === "date" ? 0 : undefined}
          onChange={(event) => updateValue(event.target.value)}
          placeholder={item.kind === "date" ? "Days" : "Value"}
          type={
            item.kind === "number" || item.kind === "date" ? "number" : "text"
          }
          value={String(condition.value ?? "")}
        />
      ) : (
        <span className="condition-no-value">No value needed</span>
      )}
      {condition.operator === "between" && (
        <>
          <span className="condition-and">and</span>
          <input
            aria-label="Second filter value"
            onChange={(event) => updateValue(event.target.value, true)}
            type="number"
            value={String(condition.valueTo ?? "")}
          />
        </>
      )}
      <button
        aria-label="Remove condition"
        className="icon-button subtle"
        onClick={onRemove}
        type="button"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function GroupEditor({
  group,
  depth,
  onChange,
  onRemove,
}: {
  group: FilterGroup;
  depth: number;
  onChange: (group: FilterGroup) => void;
  onRemove?: () => void;
}): React.JSX.Element {
  const replaceChild = (id: string, replacement: FilterNode): void => {
    onChange({
      ...group,
      children: group.children.map((child) =>
        child.id === id ? replacement : child,
      ),
    });
  };
  const removeChild = (id: string): void => {
    onChange({
      ...group,
      children: group.children.filter((child) => child.id !== id),
    });
  };

  return (
    <div className={`filter-group depth-${Math.min(depth, 3)}`}>
      <div className="filter-group-header">
        <select
          aria-label="Filter group conjunction"
          value={group.conjunction}
          onChange={(event) =>
            onChange({
              ...group,
              conjunction: event.target.value as "and" | "or",
            })
          }
        >
          <option value="and">Match all (AND)</option>
          <option value="or">Match any (OR)</option>
        </select>
        <label className="inline-check">
          <input
            checked={group.negated}
            onChange={(event) =>
              onChange({ ...group, negated: event.target.checked })
            }
            type="checkbox"
          />
          NOT
        </label>
        {onRemove && (
          <button
            className="text-button danger-text"
            onClick={onRemove}
            type="button"
          >
            Remove group
          </button>
        )}
      </div>
      <div className="filter-group-body">
        {group.children.length === 0 && (
          <div className="empty-group">
            Add a condition or nested group to begin.
          </div>
        )}
        {group.children.map((child) =>
          child.kind === "condition" ? (
            <ConditionEditor
              condition={child}
              key={child.id}
              onChange={(condition) => replaceChild(child.id, condition)}
              onRemove={() => removeChild(child.id)}
            />
          ) : (
            <GroupEditor
              depth={depth + 1}
              group={child}
              key={child.id}
              onChange={(nested) => replaceChild(child.id, nested)}
              onRemove={() => removeChild(child.id)}
            />
          ),
        )}
      </div>
      <div className="filter-group-actions">
        <button
          className="secondary-button small"
          onClick={() =>
            onChange({
              ...group,
              children: [...group.children, newCondition()],
            })
          }
          type="button"
        >
          <Plus size={14} /> Add condition
        </button>
        {depth < 3 && (
          <button
            className="secondary-button small"
            onClick={() =>
              onChange({
                ...group,
                children: [...group.children, newGroup("or")],
              })
            }
            type="button"
          >
            <Brackets size={14} /> Add group
          </button>
        )}
      </div>
    </div>
  );
}

interface FilterBuilderProps {
  open: boolean;
  filters: FilterGroup;
  onApply: (filters: FilterGroup) => void;
  onClose: () => void;
}

export function FilterBuilder({
  open,
  filters,
  onApply,
  onClose,
}: FilterBuilderProps): React.JSX.Element | null {
  const [draft, setDraft] = useState<FilterGroup>(() =>
    structuredClone(filters),
  );

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby="filter-builder-title"
        aria-modal="true"
        className="modal filter-builder-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">Advanced filters</span>
            <h2 id="filter-builder-title">Build a precise library view</h2>
            <p>
              Combine conditions with nested AND, OR, and NOT groups. Missing
              metadata never becomes a fake zero.
            </p>
          </div>
          <button
            aria-label="Close filter builder"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X size={19} />
          </button>
        </header>
        <div className="modal-content filter-builder-content">
          <GroupEditor depth={0} group={draft} onChange={setDraft} />
        </div>
        <footer className="modal-footer">
          <button
            className="secondary-button"
            onClick={() => setDraft(newGroup())}
            type="button"
          >
            Clear all
          </button>
          <div className="spacer" />
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
            type="button"
          >
            Apply filters
          </button>
        </footer>
      </section>
    </div>
  );
}
