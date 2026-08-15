export interface SelectionState {
  mode: "explicit" | "all-filtered";
  included: ReadonlySet<string>;
  excluded: ReadonlySet<string>;
  anchorId: string | null;
}

export function emptySelection(): SelectionState {
  return {
    mode: "explicit",
    included: new Set(),
    excluded: new Set(),
    anchorId: null,
  };
}

export function isSelected(state: SelectionState, id: string): boolean {
  return state.mode === "all-filtered"
    ? !state.excluded.has(id)
    : state.included.has(id);
}

export function selectedCount(
  state: SelectionState,
  filteredTotal: number,
): number {
  return state.mode === "all-filtered"
    ? Math.max(0, filteredTotal - state.excluded.size)
    : state.included.size;
}

export function toggleSelected(
  state: SelectionState,
  id: string,
): SelectionState {
  if (state.mode === "all-filtered") {
    const excluded = new Set(state.excluded);
    if (excluded.has(id)) excluded.delete(id);
    else excluded.add(id);
    return { ...state, excluded, anchorId: id };
  }

  const included = new Set(state.included);
  if (included.has(id)) included.delete(id);
  else included.add(id);
  return { ...state, included, anchorId: id };
}

export function selectRange(
  state: SelectionState,
  ids: string[],
  targetId: string,
): SelectionState {
  if (state.mode !== "explicit" || !state.anchorId)
    return toggleSelected(state, targetId);
  const anchorIndex = ids.indexOf(state.anchorId);
  const targetIndex = ids.indexOf(targetId);
  if (anchorIndex < 0 || targetIndex < 0)
    return toggleSelected(state, targetId);

  const included = new Set(state.included);
  const [start, end] =
    anchorIndex <= targetIndex
      ? [anchorIndex, targetIndex]
      : [targetIndex, anchorIndex];
  for (let index = start; index <= end; index += 1) {
    const id = ids[index];
    if (id) included.add(id);
  }
  return { ...state, included, anchorId: targetId };
}

export function selectAllFiltered(): SelectionState {
  return {
    mode: "all-filtered",
    included: new Set(),
    excluded: new Set(),
    anchorId: null,
  };
}

export function invertVisible(
  state: SelectionState,
  ids: string[],
): SelectionState {
  let next = state;
  for (const id of ids) next = toggleSelected(next, id);
  return next;
}
