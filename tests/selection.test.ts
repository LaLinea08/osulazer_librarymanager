import { describe, expect, it } from "vitest";

import {
  emptySelection,
  invertVisible,
  isSelected,
  selectAllFiltered,
  selectedCount,
  selectRange,
  toggleSelected,
  type SelectionState,
} from "../src/shared/selection";

function sorted(values: ReadonlySet<string>): string[] {
  return [...values].sort();
}

describe("selection model", () => {
  it("creates an independent empty explicit selection", () => {
    const first = emptySelection();
    const second = emptySelection();

    expect(first).toMatchObject({ mode: "explicit", anchorId: null });
    expect(first.included.size).toBe(0);
    expect(first.excluded.size).toBe(0);
    expect(first.included).not.toBe(second.included);
    expect(first.excluded).not.toBe(second.excluded);
    expect(selectedCount(first, 10_000)).toBe(0);
    expect(isSelected(first, "map-1")).toBe(false);
  });

  it("toggles explicit ids immutably and updates the anchor", () => {
    const initial = emptySelection();
    const selected = toggleSelected(initial, "map-1");
    const deselected = toggleSelected(selected, "map-1");

    expect(sorted(initial.included)).toEqual([]);
    expect(sorted(selected.included)).toEqual(["map-1"]);
    expect(selected.anchorId).toBe("map-1");
    expect(isSelected(selected, "map-1")).toBe(true);
    expect(selectedCount(selected, 999)).toBe(1);
    expect(sorted(deselected.included)).toEqual([]);
    expect(deselected.anchorId).toBe("map-1");
  });

  it("does not mutate pre-existing explicit sets", () => {
    const included = new Set(["old"]);
    const state: SelectionState = {
      mode: "explicit",
      included,
      excluded: new Set(),
      anchorId: "old",
    };

    const next = toggleSelected(state, "new");

    expect(sorted(included)).toEqual(["old"]);
    expect(sorted(next.included)).toEqual(["new", "old"]);
    expect(next.included).not.toBe(included);
  });

  it("represents all filtered rows without materializing their ids", () => {
    const state = selectAllFiltered();

    expect(state).toMatchObject({ mode: "all-filtered", anchorId: null });
    expect(state.included.size).toBe(0);
    expect(state.excluded.size).toBe(0);
    expect(isSelected(state, "any-filtered-id")).toBe(true);
    expect(selectedCount(state, 100_000)).toBe(100_000);
  });

  it("toggles exclusions immutably in all-filtered mode", () => {
    const all = selectAllFiltered();
    const excluded = toggleSelected(all, "map-2");
    const restored = toggleSelected(excluded, "map-2");

    expect(sorted(all.excluded)).toEqual([]);
    expect(sorted(excluded.excluded)).toEqual(["map-2"]);
    expect(excluded.anchorId).toBe("map-2");
    expect(isSelected(excluded, "map-2")).toBe(false);
    expect(isSelected(excluded, "map-1")).toBe(true);
    expect(selectedCount(excluded, 20)).toBe(19);
    expect(sorted(restored.excluded)).toEqual([]);
    expect(isSelected(restored, "map-2")).toBe(true);
  });

  it("never reports a negative all-filtered count for stale exclusions", () => {
    const state: SelectionState = {
      mode: "all-filtered",
      included: new Set(),
      excluded: new Set(["a", "b", "c"]),
      anchorId: null,
    };

    expect(selectedCount(state, 1)).toBe(0);
    expect(selectedCount(state, 0)).toBe(0);
  });

  it("uses a first range click as a normal toggle when no anchor exists", () => {
    const state = selectRange(emptySelection(), ["a", "b", "c"], "b");

    expect(sorted(state.included)).toEqual(["b"]);
    expect(state.anchorId).toBe("b");
  });

  it("selects an inclusive forward range and retains earlier selections", () => {
    const initial: SelectionState = {
      mode: "explicit",
      included: new Set(["outside", "b"]),
      excluded: new Set(),
      anchorId: "b",
    };

    const next = selectRange(initial, ["a", "b", "c", "d", "e"], "d");

    expect(sorted(next.included)).toEqual(["b", "c", "d", "outside"]);
    expect(next.anchorId).toBe("d");
    expect(sorted(initial.included)).toEqual(["b", "outside"]);
  });

  it("selects an inclusive reverse range", () => {
    const initial: SelectionState = {
      mode: "explicit",
      included: new Set(["d"]),
      excluded: new Set(),
      anchorId: "d",
    };

    const next = selectRange(initial, ["a", "b", "c", "d", "e"], "b");

    expect(sorted(next.included)).toEqual(["b", "c", "d"]);
    expect(next.anchorId).toBe("b");
  });

  it("falls back to toggling the target when the anchor is outside the visible id window", () => {
    const initial: SelectionState = {
      mode: "explicit",
      included: new Set(["offscreen"]),
      excluded: new Set(),
      anchorId: "offscreen",
    };

    const next = selectRange(initial, ["a", "b", "c"], "b");

    expect(sorted(next.included)).toEqual(["b", "offscreen"]);
    expect(next.anchorId).toBe("b");
  });

  it("falls back to toggling an absent target rather than selecting an accidental range", () => {
    const initial: SelectionState = {
      mode: "explicit",
      included: new Set(["a"]),
      excluded: new Set(),
      anchorId: "a",
    };

    const next = selectRange(initial, ["a", "b", "c"], "offscreen");

    expect(sorted(next.included)).toEqual(["a", "offscreen"]);
    expect(next.anchorId).toBe("offscreen");
  });

  it("inverts only the supplied visible ids in explicit mode", () => {
    const initial: SelectionState = {
      mode: "explicit",
      included: new Set(["a", "outside"]),
      excluded: new Set(),
      anchorId: "a",
    };

    const next = invertVisible(initial, ["a", "b", "c"]);

    expect(sorted(next.included)).toEqual(["b", "c", "outside"]);
    expect(next.anchorId).toBe("c");
    expect(sorted(initial.included)).toEqual(["a", "outside"]);
  });

  it("inverts visible ids as exclusions in all-filtered mode", () => {
    const initial: SelectionState = {
      mode: "all-filtered",
      included: new Set(),
      excluded: new Set(["a", "outside"]),
      anchorId: "a",
    };

    const next = invertVisible(initial, ["a", "b", "c"]);

    expect(sorted(next.excluded)).toEqual(["b", "c", "outside"]);
    expect(next.anchorId).toBe("c");
    expect(isSelected(next, "a")).toBe(true);
    expect(isSelected(next, "b")).toBe(false);
  });

  it("returns the same state when asked to invert no ids", () => {
    const state = toggleSelected(emptySelection(), "a");

    expect(invertVisible(state, [])).toBe(state);
  });
});
