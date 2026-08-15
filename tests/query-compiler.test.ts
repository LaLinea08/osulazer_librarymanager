import { afterEach, describe, expect, it, vi } from "vitest";

import { compileWhere, sortColumns } from "../src/main/query-compiler";
import type {
  FilterCondition,
  FilterField,
  FilterGroup,
  FilterOperator,
  SortField,
} from "../src/shared/contracts";

function condition(
  field: FilterField,
  operator: FilterOperator,
  value?: FilterCondition["value"],
  valueTo?: FilterCondition["valueTo"],
  enabled = true,
): FilterCondition {
  return {
    kind: "condition",
    id: `${field}-${operator}`,
    field,
    operator,
    value,
    valueTo,
    enabled,
  };
}

function group(
  children: FilterGroup["children"] = [],
  options: Partial<
    Pick<FilterGroup, "conjunction" | "negated" | "enabled">
  > = {},
): FilterGroup {
  return {
    kind: "group",
    id: "group",
    conjunction: options.conjunction ?? "and",
    negated: options.negated ?? false,
    enabled: options.enabled ?? true,
    children,
  };
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("compileWhere", () => {
  it("emits no WHERE clause or parameters for an empty query", () => {
    expect(compileWhere(group(), "")).toEqual({ sql: "", params: [] });
    expect(compileWhere(group(), "   \t")).toEqual({ sql: "", params: [] });
  });

  it("ignores disabled conditions, groups, and empty nested groups without leaking params", () => {
    const filters = group([
      condition("artist", "equals", "ignored", undefined, false),
      group([condition("bpm", "greaterThan", 180)], { enabled: false }),
      group([], { negated: true }),
    ]);

    expect(compileWhere(filters, "")).toEqual({ sql: "", params: [] });
  });

  it("combines enabled conditions with AND and preserves parameter order", () => {
    const result = compileWhere(
      group([
        condition("mode", "equals", "mania"),
        condition("starRating", "greaterThan", 6),
        condition("bpm", "greaterThanOrEqual", 180),
      ]),
      "",
    );

    expect(compactSql(result.sql)).toBe(
      "WHERE (mode = ? COLLATE NOCASE AND star_rating > ? AND bpm >= ?)",
    );
    expect(result.params).toEqual(["mania", 6, 180]);
  });

  it("compiles nested OR groups and group negation with explicit parentheses", () => {
    const result = compileWhere(
      group([
        condition("mode", "equals", "osu"),
        group(
          [
            condition("starRating", "lessThan", 2),
            condition("starRating", "greaterThan", 8),
          ],
          { conjunction: "or", negated: true },
        ),
      ]),
      "",
    );

    expect(compactSql(result.sql)).toBe(
      "WHERE (mode = ? COLLATE NOCASE AND NOT (star_rating < ? OR star_rating > ?))",
    );
    expect(result.params).toEqual(["osu", 2, 8]);
  });

  it.each([
    ["equals", "artist = ? COLLATE NOCASE", "Camellia"],
    ["notEquals", "(artist IS NULL OR artist != ? COLLATE NOCASE)", "Camellia"],
    ["greaterThan", "artist > ?", "Camellia"],
    ["greaterThanOrEqual", "artist >= ?", "Camellia"],
    ["lessThan", "artist < ?", "Camellia"],
    ["lessThanOrEqual", "artist <= ?", "Camellia"],
  ] as const)(
    "compiles %s with a bound scalar parameter",
    (operator, sql, value) => {
      const result = compileWhere(
        group([condition("artist", operator, value)]),
        "",
      );

      expect(compactSql(result.sql)).toBe(`WHERE (${sql})`);
      expect(result.params).toEqual([value]);
    },
  );

  it.each([
    [
      "contains",
      "%100\\%\\_fun\\\\path%",
      "artist LIKE ? ESCAPE '\\' COLLATE NOCASE",
    ],
    [
      "notContains",
      "%100\\%\\_fun\\\\path%",
      "(artist IS NULL OR artist NOT LIKE ? ESCAPE '\\' COLLATE NOCASE)",
    ],
    [
      "beginsWith",
      "100\\%\\_fun\\\\path%",
      "artist LIKE ? ESCAPE '\\' COLLATE NOCASE",
    ],
    [
      "endsWith",
      "%100\\%\\_fun\\\\path",
      "artist LIKE ? ESCAPE '\\' COLLATE NOCASE",
    ],
  ] as const)(
    "compiles and escapes LIKE operator %s",
    (operator, parameter, sql) => {
      const result = compileWhere(
        group([condition("artist", operator, String.raw`100%_fun\path`)]),
        "",
      );

      expect(compactSql(result.sql)).toBe(`WHERE (${sql})`);
      expect(result.params).toEqual([parameter]);
    },
  );

  it("compiles BETWEEN with two ordered parameters", () => {
    const result = compileWhere(
      group([condition("starRating", "between", 4.5, 6.5)]),
      "",
    );

    expect(compactSql(result.sql)).toBe("WHERE (star_rating BETWEEN ? AND ?)");
    expect(result.params).toEqual([4.5, 6.5]);
  });

  it("compiles non-empty IN lists and binds every value", () => {
    const strings = compileWhere(
      group([condition("mode", "in", ["osu", "mania", "taiko"])]),
      "",
    );
    const numbers = compileWhere(
      group([condition("beatmapId", "in", [7, 8])]),
      "",
    );

    expect(compactSql(strings.sql)).toBe("WHERE (mode IN (?, ?, ?))");
    expect(strings.params).toEqual(["osu", "mania", "taiko"]);
    expect(compactSql(numbers.sql)).toBe("WHERE (beatmap_id IN (?, ?))");
    expect(numbers.params).toEqual([7, 8]);
  });

  it("compiles an empty or non-array IN operand to an always-false expression", () => {
    expect(compileWhere(group([condition("mode", "in", [])]), "")).toEqual({
      sql: "WHERE (0 = 1)",
      params: [],
    });
    expect(compileWhere(group([condition("mode", "in", "osu")]), "")).toEqual({
      sql: "WHERE (0 = 1)",
      params: [],
    });
  });

  it.each([
    ["hasVideo", "isTrue", "has_video = 1"],
    ["hasBackground", "isFalse", "has_background = 0"],
    ["source", "isEmpty", "(source IS NULL OR source = '')"],
    ["tags", "isNotEmpty", "(tags IS NOT NULL AND tags != '')"],
  ] as const)(
    "compiles parameter-free operator %s.%s",
    (field, operator, sql) => {
      const result = compileWhere(group([condition(field, operator)]), "");

      expect(compactSql(result.sql)).toBe(`WHERE (${sql})`);
      expect(result.params).toEqual([]);
    },
  );

  it("normalizes boolean scalar values to SQLite integers", () => {
    const result = compileWhere(
      group([condition("hasVideo", "equals", true)]),
      "",
    );

    expect(compactSql(result.sql)).toBe("WHERE (has_video = ? COLLATE NOCASE)");
    expect(result.params).toEqual([1]);
  });

  it("binds null for an omitted scalar rather than interpolating undefined", () => {
    const result = compileWhere(group([condition("artist", "equals")]), "");

    expect(compactSql(result.sql)).toBe("WHERE (artist = ? COLLATE NOCASE)");
    expect(result.params).toEqual([null]);
  });

  it("compiles relative dates against the current time deterministically", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));

    const result = compileWhere(
      group([
        condition("lastPlayedAt", "beforeRelativeDays", 365),
        condition("importedAt", "afterRelativeDays", 30),
      ]),
      "",
    );

    expect(compactSql(result.sql)).toBe(
      "WHERE (last_played_at < ? AND imported_at >= ?)",
    );
    expect(result.params).toEqual([
      "2025-08-15T12:00:00.000Z",
      "2026-07-16T12:00:00.000Z",
    ]);
  });

  it("clamps negative relative-day values to the current instant", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));

    const result = compileWhere(
      group([condition("lastPlayedAt", "beforeRelativeDays", -10)]),
      "",
    );

    expect(result.params).toEqual(["2026-08-15T12:00:00.000Z"]);
  });

  it("compiles trimmed free text across every searchable column", () => {
    const result = compileWhere(group(), "  Camellia  ");

    expect(compactSql(result.sql)).toBe(
      "WHERE ( artist LIKE ? ESCAPE '\\' COLLATE NOCASE OR title LIKE ? ESCAPE '\\' COLLATE NOCASE OR difficulty_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR mapper LIKE ? ESCAPE '\\' COLLATE NOCASE OR tags LIKE ? ESCAPE '\\' COLLATE NOCASE OR source LIKE ? ESCAPE '\\' COLLATE NOCASE )",
    );
    expect(result.params).toEqual(
      Array.from({ length: 6 }, () => "%Camellia%"),
    );
  });

  it("escapes free-text LIKE wildcards identically for all searchable columns", () => {
    const result = compileWhere(group(), String.raw`100%_\mix`);

    expect(result.params).toEqual(
      Array.from({ length: 6 }, () => String.raw`%100\%\_\\mix%`),
    );
  });

  it("appends free-text parameters after filter parameters", () => {
    const result = compileWhere(
      group([
        condition("mode", "equals", "mania"),
        condition("bpm", "greaterThan", 180),
      ]),
      "speed",
    );

    expect(compactSql(result.sql)).toContain(
      "WHERE (mode = ? COLLATE NOCASE AND bpm > ?) AND ( artist LIKE ?",
    );
    expect(result.params).toEqual([
      "mania",
      180,
      ...Array.from({ length: 6 }, () => "%speed%"),
    ]);
  });

  it("keeps SQL metacharacters in bound values and out of the SQL expression", () => {
    const attack = "x' OR 1=1 --";
    const result = compileWhere(
      group([condition("artist", "equals", attack)]),
      attack,
    );

    expect(result.sql).not.toContain(attack);
    expect(result.params[0]).toBe(attack);
    expect(result.params.slice(1)).toEqual(
      Array.from({ length: 6 }, () => `%${attack}%`),
    );
  });

  it.each([
    ["artist", "artist"],
    ["difficultyName", "difficulty_name"],
    ["starRating", "star_rating"],
    ["approachRate", "approach_rate"],
    ["overallDifficulty", "overall_difficulty"],
    ["circleSize", "circle_size"],
    ["hpDrain", "hp_drain"],
    ["beatmapId", "beatmap_id"],
    ["beatmapSetId", "beatmap_set_id"],
    ["importedAt", "imported_at"],
    ["lastPlayedAt", "last_played_at"],
    ["localPlayCount", "local_play_count"],
    ["localScoreCount", "local_score_count"],
    ["storageBytes", "storage_bytes"],
    ["hasVideo", "has_video"],
    ["hasBackground", "has_background"],
  ] as const)("uses the allow-listed column for %s", (field, column) => {
    const result = compileWhere(group([condition(field, "equals", 1)]), "");

    expect(compactSql(result.sql)).toBe(`WHERE (${column} = ? COLLATE NOCASE)`);
    expect(result.params).toEqual([1]);
  });
});

describe("sortColumns", () => {
  it("contains an explicit safe mapping for every public sort field", () => {
    const expected: Record<SortField, string> = {
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

    expect(sortColumns).toEqual(expected);
  });
});
