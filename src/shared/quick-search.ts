import type { FilterCondition, FilterField, FilterOperator } from "./contracts";

export interface QuickSearchParseResult {
  conditions: FilterCondition[];
  text: string;
  errors: string[];
}

const fieldAliases: Record<string, FilterField> = {
  artist: "artist",
  title: "title",
  diff: "difficultyName",
  difficulty: "difficultyName",
  mapper: "mapper",
  creator: "mapper",
  mode: "mode",
  status: "status",
  bpm: "bpm",
  length: "durationSeconds",
  stars: "starRating",
  star: "starRating",
  ar: "approachRate",
  od: "overallDifficulty",
  cs: "circleSize",
  hp: "hpDrain",
  source: "source",
  tags: "tags",
  id: "beatmapId",
  beatmapid: "beatmapId",
  setid: "beatmapSetId",
  added: "importedAt",
  lastplayed: "lastPlayedAt",
  played: "localPlayCount",
  plays: "localPlayCount",
  scores: "localScoreCount",
  size: "storageBytes",
  video: "hasVideo",
  background: "hasBackground",
};

const numericFields = new Set<FilterField>([
  "bpm",
  "durationSeconds",
  "starRating",
  "approachRate",
  "overallDifficulty",
  "circleSize",
  "hpDrain",
  "beatmapId",
  "beatmapSetId",
  "localPlayCount",
  "localScoreCount",
  "storageBytes",
]);

const booleanFields = new Set<FilterField>(["hasVideo", "hasBackground"]);

function tokenize(input: string): string[] {
  return input.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
}

function stripQuotes(value: string): string {
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

function idFor(index: number): string {
  return `quick-${index}`;
}

function numericCondition(
  field: FilterField,
  raw: string,
  index: number,
): FilterCondition | { error: string } {
  const range = raw.match(/^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/);
  if (range) {
    return {
      kind: "condition",
      id: idFor(index),
      field,
      operator: "between",
      value: Number(range[1]),
      valueTo: Number(range[2]),
      label: `${field}: ${range[1]}–${range[2]}`,
      enabled: true,
    };
  }

  const comparison = raw.match(/^(>=|<=|>|<|=)?(-?\d+(?:\.\d+)?)(kb|mb|gb)?$/i);
  if (!comparison) return { error: `“${raw}” is not a valid numeric value.` };

  const operatorMap: Record<string, FilterOperator> = {
    ">": "greaterThan",
    ">=": "greaterThanOrEqual",
    "<": "lessThan",
    "<=": "lessThanOrEqual",
    "=": "equals",
  };
  const unit = comparison[3]?.toLowerCase();
  const multiplier =
    unit === "gb"
      ? 1024 ** 3
      : unit === "mb"
        ? 1024 ** 2
        : unit === "kb"
          ? 1024
          : 1;
  const value = Number(comparison[2]) * multiplier;

  return {
    kind: "condition",
    id: idFor(index),
    field,
    operator: operatorMap[comparison[1] ?? "="] ?? "equals",
    value,
    label: `${field} ${comparison[1] ?? "="} ${raw.replace(/^[><=]+/, "")}`,
    enabled: true,
  };
}

function relativeDateCondition(
  field: "lastPlayedAt" | "importedAt",
  raw: string,
  index: number,
): FilterCondition | { error: string } {
  const match = raw.match(/^(>|<)?(\d+)(d|w|m|y)$/i);
  if (!match)
    return {
      error: `“${raw}” must use a relative duration such as >365d or <6m.`,
    };
  const unit = match[3]?.toLowerCase();
  const days =
    Number(match[2]) *
    (unit === "y" ? 365 : unit === "m" ? 30 : unit === "w" ? 7 : 1);
  return {
    kind: "condition",
    id: idFor(index),
    field,
    operator: match[1] === "<" ? "afterRelativeDays" : "beforeRelativeDays",
    value: days,
    label: `${field === "lastPlayedAt" ? "Last played" : "Added"} ${match[1] ?? ">"} ${raw.replace(/^[><]/, "")} ago`,
    enabled: true,
  };
}

function stringCondition(
  field: FilterField,
  raw: string,
  index: number,
): FilterCondition {
  const value = stripQuotes(raw);
  return {
    kind: "condition",
    id: idFor(index),
    field,
    operator: field === "mode" || field === "status" ? "equals" : "contains",
    value,
    label: `${field}: ${value}`,
    enabled: true,
  };
}

export function parseQuickSearch(input: string): QuickSearchParseResult {
  const conditions: FilterCondition[] = [];
  const textTokens: string[] = [];
  const errors: string[] = [];

  for (const [index, token] of tokenize(input).entries()) {
    const separator = token.indexOf(":");
    if (separator <= 0) {
      textTokens.push(stripQuotes(token));
      continue;
    }

    const alias = token.slice(0, separator).toLowerCase();
    const raw = token.slice(separator + 1);
    const field = fieldAliases[alias];
    if (!field || !raw) {
      textTokens.push(stripQuotes(token));
      continue;
    }

    if (alias === "played") {
      const played = raw.toLowerCase();
      if (played !== "true" && played !== "false") {
        errors.push("played accepts only true or false.");
      } else {
        conditions.push({
          kind: "condition",
          id: idFor(index),
          field: "localPlayCount",
          operator: played === "true" ? "greaterThan" : "equals",
          value: 0,
          label: played === "true" ? "Played" : "Never played",
          enabled: true,
        });
      }
      continue;
    }

    if (field === "lastPlayedAt" || field === "importedAt") {
      const result = relativeDateCondition(field, raw, index);
      if ("error" in result) errors.push(result.error);
      else conditions.push(result);
      continue;
    }

    if (booleanFields.has(field)) {
      const normalized = raw.toLowerCase();
      if (!["true", "false", "yes", "no"].includes(normalized)) {
        errors.push(`${alias} accepts true or false.`);
      } else {
        const enabled = normalized === "true" || normalized === "yes";
        conditions.push({
          kind: "condition",
          id: idFor(index),
          field,
          operator: enabled ? "isTrue" : "isFalse",
          label: `${alias}: ${enabled ? "yes" : "no"}`,
          enabled: true,
        });
      }
      continue;
    }

    if (numericFields.has(field)) {
      const result = numericCondition(field, raw, index);
      if ("error" in result) errors.push(result.error);
      else conditions.push(result);
      continue;
    }

    conditions.push(stringCondition(field, raw, index));
  }

  return { conditions, text: textTokens.join(" "), errors };
}
