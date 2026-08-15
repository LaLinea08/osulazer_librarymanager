import type {
  FilterCondition,
  FilterField,
  FilterGroup,
  FilterNode,
  SortField,
} from "../shared/contracts";

export type SqlValue = string | number | null;

export interface CompiledWhere {
  sql: string;
  params: SqlValue[];
}

const columns: Record<FilterField, string> = {
  artist: "artist",
  title: "title",
  difficultyName: "difficulty_name",
  mapper: "mapper",
  mode: "mode",
  status: "status",
  bpm: "bpm",
  durationSeconds: "duration_seconds",
  starRating: "star_rating",
  approachRate: "approach_rate",
  overallDifficulty: "overall_difficulty",
  circleSize: "circle_size",
  hpDrain: "hp_drain",
  source: "source",
  tags: "tags",
  beatmapId: "beatmap_id",
  beatmapSetId: "beatmap_set_id",
  importedAt: "imported_at",
  lastPlayedAt: "last_played_at",
  localPlayCount: "local_play_count",
  localScoreCount: "local_score_count",
  storageBytes: "storage_bytes",
  hasVideo: "has_video",
  hasBackground: "has_background",
};

export const sortColumns: Record<SortField, string> = {
  artist: "artist",
  title: "title",
  difficultyName: "difficulty_name",
  mapper: "mapper",
  mode: "mode",
  starRating: "star_rating",
  bpm: "bpm",
  durationSeconds: "duration_seconds",
  status: "status",
  importedAt: "imported_at",
  lastPlayedAt: "last_played_at",
  localPlayCount: "local_play_count",
  storageBytes: "storage_bytes",
};

function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function scalar(value: FilterCondition["value"]): SqlValue {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

function compileCondition(
  condition: FilterCondition,
  params: SqlValue[],
): string {
  const column = columns[condition.field];
  const value = scalar(condition.value);

  switch (condition.operator) {
    case "contains":
      params.push(`%${escapeLike(String(value ?? ""))}%`);
      return `${column} LIKE ? ESCAPE '\\' COLLATE NOCASE`;
    case "notContains":
      params.push(`%${escapeLike(String(value ?? ""))}%`);
      return `(${column} IS NULL OR ${column} NOT LIKE ? ESCAPE '\\' COLLATE NOCASE)`;
    case "beginsWith":
      params.push(`${escapeLike(String(value ?? ""))}%`);
      return `${column} LIKE ? ESCAPE '\\' COLLATE NOCASE`;
    case "endsWith":
      params.push(`%${escapeLike(String(value ?? ""))}`);
      return `${column} LIKE ? ESCAPE '\\' COLLATE NOCASE`;
    case "equals":
      params.push(value);
      return `${column} = ? COLLATE NOCASE`;
    case "notEquals":
      params.push(value);
      return `(${column} IS NULL OR ${column} != ? COLLATE NOCASE)`;
    case "greaterThan":
      params.push(value);
      return `${column} > ?`;
    case "greaterThanOrEqual":
      params.push(value);
      return `${column} >= ?`;
    case "lessThan":
      params.push(value);
      return `${column} < ?`;
    case "lessThanOrEqual":
      params.push(value);
      return `${column} <= ?`;
    case "between":
      params.push(value, scalar(condition.valueTo));
      return `${column} BETWEEN ? AND ?`;
    case "in": {
      const values = Array.isArray(condition.value) ? condition.value : [];
      if (values.length === 0) return "0 = 1";
      params.push(
        ...values.map((item) =>
          typeof item === "number" ? item : String(item),
        ),
      );
      return `${column} IN (${values.map(() => "?").join(", ")})`;
    }
    case "isTrue":
      return `${column} = 1`;
    case "isFalse":
      return `${column} = 0`;
    case "isEmpty":
      return `(${column} IS NULL OR ${column} = '')`;
    case "isNotEmpty":
      return `(${column} IS NOT NULL AND ${column} != '')`;
    case "beforeRelativeDays": {
      const days = Math.max(0, Number(value ?? 0));
      params.push(new Date(Date.now() - days * 86_400_000).toISOString());
      return `${column} < ?`;
    }
    case "afterRelativeDays": {
      const days = Math.max(0, Number(value ?? 0));
      params.push(new Date(Date.now() - days * 86_400_000).toISOString());
      return `${column} >= ?`;
    }
  }
}

function compileNode(node: FilterNode, params: SqlValue[]): string {
  if (!node.enabled) return "";
  if (node.kind === "condition") return compileCondition(node, params);

  const parts = node.children
    .map((child) => compileNode(child, params))
    .filter(Boolean);
  if (parts.length === 0) return "";
  const expression = `(${parts.join(node.conjunction === "and" ? " AND " : " OR ")})`;
  return node.negated ? `NOT ${expression}` : expression;
}

export function compileWhere(
  filters: FilterGroup,
  text: string,
): CompiledWhere {
  const params: SqlValue[] = [];
  const clauses: string[] = [];
  const filterSql = compileNode(filters, params);
  if (filterSql) clauses.push(filterSql);

  const normalizedText = text.trim();
  if (normalizedText) {
    const pattern = `%${escapeLike(normalizedText)}%`;
    params.push(pattern, pattern, pattern, pattern, pattern, pattern);
    clauses.push(`(
      artist LIKE ? ESCAPE '\\' COLLATE NOCASE OR
      title LIKE ? ESCAPE '\\' COLLATE NOCASE OR
      difficulty_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR
      mapper LIKE ? ESCAPE '\\' COLLATE NOCASE OR
      tags LIKE ? ESCAPE '\\' COLLATE NOCASE OR
      source LIKE ? ESCAPE '\\' COLLATE NOCASE
    )`);
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}
