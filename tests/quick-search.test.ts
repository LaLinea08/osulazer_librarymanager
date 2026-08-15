import { describe, expect, it } from "vitest";

import { parseQuickSearch } from "../src/shared/quick-search";

describe("parseQuickSearch", () => {
  it("returns an empty result for empty and whitespace-only input", () => {
    expect(parseQuickSearch("")).toEqual({
      conditions: [],
      text: "",
      errors: [],
    });
    expect(parseQuickSearch("   \t\r\n ")).toEqual({
      conditions: [],
      text: "",
      errors: [],
    });
  });

  it("keeps unqualified terms as free text and preserves their order", () => {
    expect(parseQuickSearch("Camellia Exit atmosphere")).toEqual({
      conditions: [],
      text: "Camellia Exit atmosphere",
      errors: [],
    });
  });

  it("treats a standalone quoted phrase as one free-text term", () => {
    expect(parseQuickSearch('"Exit This Earth" live')).toEqual({
      conditions: [],
      text: "Exit This Earth live",
      errors: [],
    });
  });

  it("parses quoted field values containing spaces", () => {
    const result = parseQuickSearch(
      'mapper:"A Great Mapper" title:"Exit This Earth"',
    );

    expect(result.errors).toEqual([]);
    expect(result.text).toBe("");
    expect(result.conditions).toMatchObject([
      {
        id: "quick-0",
        field: "mapper",
        operator: "contains",
        value: "A Great Mapper",
        enabled: true,
      },
      {
        id: "quick-1",
        field: "title",
        operator: "contains",
        value: "Exit This Earth",
        enabled: true,
      },
    ]);
  });

  it.each([
    ["diff", "difficultyName"],
    ["difficulty", "difficultyName"],
    ["creator", "mapper"],
    ["star", "starRating"],
    ["stars", "starRating"],
    ["id", "beatmapId"],
    ["beatmapid", "beatmapId"],
    ["setid", "beatmapSetId"],
  ] as const)("maps the %s alias to %s", (alias, field) => {
    const result = parseQuickSearch(`${alias}:7`);

    expect(result.errors).toEqual([]);
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0]?.field).toBe(field);
  });

  it("uses equality for enum-like mode and status fields", () => {
    const result = parseQuickSearch("mode:mania status:loved");

    expect(result.conditions).toMatchObject([
      { field: "mode", operator: "equals", value: "mania" },
      { field: "status", operator: "equals", value: "loved" },
    ]);
  });

  it("uses contains for ordinary string fields and retains additional colons", () => {
    const result = parseQuickSearch(
      "artist:Camellia source:game:anime tags:speed",
    );

    expect(result.conditions).toMatchObject([
      { field: "artist", operator: "contains", value: "Camellia" },
      { field: "source", operator: "contains", value: "game:anime" },
      { field: "tags", operator: "contains", value: "speed" },
    ]);
  });

  it.each([
    ["stars:5", "equals", 5],
    ["stars:=5.25", "equals", 5.25],
    ["stars:>5", "greaterThan", 5],
    ["stars:>=5", "greaterThanOrEqual", 5],
    ["bpm:<180", "lessThan", 180],
    ["bpm:<=180.5", "lessThanOrEqual", 180.5],
    ["ar:-1", "equals", -1],
  ] as const)("parses numeric comparison %s", (input, operator, value) => {
    const result = parseQuickSearch(input);

    expect(result.errors).toEqual([]);
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0]).toMatchObject({ operator, value });
  });

  it("parses inclusive numeric ranges, including negative and decimal bounds", () => {
    const positive = parseQuickSearch("stars:4.5..6.75");
    const negative = parseQuickSearch("od:-2..-0.5");

    expect(positive.conditions[0]).toMatchObject({
      field: "starRating",
      operator: "between",
      value: 4.5,
      valueTo: 6.75,
    });
    expect(negative.conditions[0]).toMatchObject({
      field: "overallDifficulty",
      operator: "between",
      value: -2,
      valueTo: -0.5,
    });
  });

  it.each([
    ["size:2kb", 2 * 1024],
    ["size:1.5MB", 1.5 * 1024 ** 2],
    ["size:2gb", 2 * 1024 ** 3],
  ] as const)("converts binary storage unit in %s to bytes", (input, value) => {
    const result = parseQuickSearch(input);

    expect(result.errors).toEqual([]);
    expect(result.conditions[0]).toMatchObject({
      field: "storageBytes",
      operator: "equals",
      value,
    });
  });

  it("reports malformed numeric values without turning them into free text", () => {
    const result = parseQuickSearch("stars:many bpm:180x title:valid");

    expect(result.text).toBe("");
    expect(result.conditions).toMatchObject([
      { field: "title", value: "valid" },
    ]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("many");
    expect(result.errors[1]).toContain("180x");
  });

  it.each([
    ["video:true", "hasVideo", "isTrue"],
    ["video:YES", "hasVideo", "isTrue"],
    ["video:false", "hasVideo", "isFalse"],
    ["background:no", "hasBackground", "isFalse"],
  ] as const)("parses boolean token %s", (input, field, operator) => {
    const result = parseQuickSearch(input);

    expect(result.errors).toEqual([]);
    expect(result.conditions[0]).toMatchObject({
      field,
      operator,
      enabled: true,
    });
    expect(result.conditions[0]).not.toHaveProperty("value");
  });

  it("reports invalid boolean values and continues parsing later tokens", () => {
    const result = parseQuickSearch("video:perhaps background:true");

    expect(result.errors).toEqual(["video accepts true or false."]);
    expect(result.conditions).toMatchObject([
      { field: "hasBackground", operator: "isTrue" },
    ]);
  });

  it.each([
    ["lastplayed:>365d", "lastPlayedAt", "beforeRelativeDays", 365],
    ["lastplayed:2w", "lastPlayedAt", "beforeRelativeDays", 14],
    ["added:<6m", "importedAt", "afterRelativeDays", 180],
    ["added:>2y", "importedAt", "beforeRelativeDays", 730],
  ] as const)(
    "parses relative date token %s",
    (input, field, operator, value) => {
      const result = parseQuickSearch(input);

      expect(result.errors).toEqual([]);
      expect(result.conditions[0]).toMatchObject({ field, operator, value });
    },
  );

  it("reports malformed relative dates", () => {
    const result = parseQuickSearch("lastplayed:yesterday added:12");

    expect(result.conditions).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain(">365d");
    expect(result.errors[1]).toContain("<6m");
  });

  it("parses the documented played shorthand into a play-count condition", () => {
    const neverPlayed = parseQuickSearch("played:false");
    const played = parseQuickSearch("played:TRUE");

    expect(neverPlayed).toMatchObject({
      text: "",
      errors: [],
      conditions: [
        {
          field: "localPlayCount",
          operator: "equals",
          value: 0,
          label: "Never played",
        },
      ],
    });
    expect(played).toMatchObject({
      text: "",
      errors: [],
      conditions: [
        {
          field: "localPlayCount",
          operator: "greaterThan",
          value: 0,
          label: "Played",
        },
      ],
    });
  });

  it("rejects invalid played shorthand values", () => {
    const result = parseQuickSearch("played:sometimes");

    expect(result.conditions).toEqual([]);
    expect(result.text).toBe("");
    expect(result.errors).toEqual(["played accepts only true or false."]);
  });

  it("leaves unknown fields and field-like URLs in free text", () => {
    const result = parseQuickSearch(
      "unknown:value https://osu.ppy.sh/beatmaps/123",
    );

    expect(result.conditions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.text).toBe("unknown:value https://osu.ppy.sh/beatmaps/123");
  });

  it("leaves an empty recognized field in free text rather than creating an empty condition", () => {
    expect(parseQuickSearch("mapper:")).toEqual({
      conditions: [],
      text: "mapper:",
      errors: [],
    });
  });

  it("bases condition ids on token positions so they remain unique among free-text terms", () => {
    const result = parseQuickSearch("free mode:osu words bpm:>180");

    expect(result.text).toBe("free words");
    expect(result.conditions.map((condition) => condition.id)).toEqual([
      "quick-1",
      "quick-3",
    ]);
  });
});
