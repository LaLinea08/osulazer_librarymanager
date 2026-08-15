import type {
  FilterCondition,
  FilterGroup,
  FilterNode,
} from "../../../shared/contracts";

export function newGroup(conjunction: "and" | "or" = "and"): FilterGroup {
  return {
    kind: "group",
    id: crypto.randomUUID(),
    conjunction,
    negated: false,
    enabled: true,
    children: [],
  };
}

export function newCondition(
  overrides: Partial<FilterCondition> = {},
): FilterCondition {
  return {
    kind: "condition",
    id: crypto.randomUUID(),
    field: "starRating",
    operator: "greaterThanOrEqual",
    value: 4,
    enabled: true,
    ...overrides,
  };
}

export function removeFilterNode(group: FilterGroup, id: string): FilterGroup {
  return {
    ...group,
    children: group.children
      .filter((child) => child.id !== id)
      .map((child) =>
        child.kind === "group" ? removeFilterNode(child, id) : child,
      ),
  };
}

export function updateFilterNode(
  group: FilterGroup,
  id: string,
  update: (node: FilterNode) => FilterNode,
): FilterGroup {
  return {
    ...group,
    children: group.children.map((child) => {
      if (child.id === id) return update(child);
      return child.kind === "group"
        ? updateFilterNode(child, id, update)
        : child;
    }),
  };
}

export function flattenConditions(group: FilterGroup): FilterCondition[] {
  return group.children.flatMap((child) =>
    child.kind === "condition" ? child : flattenConditions(child),
  );
}

export function conditionLabel(condition: FilterCondition): string {
  if (condition.label) return condition.label;
  const field = condition.field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase());
  const operators: Record<FilterCondition["operator"], string> = {
    contains: "contains",
    notContains: "does not contain",
    equals: "=",
    notEquals: "≠",
    beginsWith: "begins with",
    endsWith: "ends with",
    greaterThan: ">",
    greaterThanOrEqual: "≥",
    lessThan: "<",
    lessThanOrEqual: "≤",
    between: "between",
    in: "in",
    isTrue: "is true",
    isFalse: "is false",
    isEmpty: "is unavailable",
    isNotEmpty: "is available",
    beforeRelativeDays: "older than",
    afterRelativeDays: "within",
  };
  const rawValue = Array.isArray(condition.value)
    ? condition.value.join(", ")
    : condition.value;
  const value = rawValue === undefined ? "" : String(rawValue);
  const suffix = condition.operator.endsWith("RelativeDays") ? " days" : "";
  const range =
    condition.operator === "between"
      ? ` and ${String(condition.valueTo ?? "")}`
      : "";
  return `${field} ${operators[condition.operator]} ${value}${range}${suffix}`.trim();
}

export function combineFilters(...groups: FilterGroup[]): FilterGroup {
  return {
    kind: "group",
    id: "effective-root",
    conjunction: "and",
    negated: false,
    enabled: true,
    children: groups.filter(
      (group) => group.enabled && group.children.length > 0,
    ),
  };
}

export function presetCondition(
  field: FilterCondition["field"],
  operator: FilterCondition["operator"],
  value?: FilterCondition["value"],
  label?: string,
): FilterGroup {
  return {
    ...newGroup(),
    id: `preset-${field}-${operator}`,
    children: [
      {
        ...newCondition({ field, operator, value, label }),
        id: `preset-condition-${field}-${operator}`,
      },
    ],
  };
}
