/**
 * Runtime layout overlay: the pure order + visibility logic that turns the
 * pristine normalized `config.rows` into the rows the viewer actually
 * displays. Kept out of the component so it is unit-testable in isolation
 * and reused by the render loop, the runtime API, and persistence.
 *
 * The overlay never mutates the config (per `specs/config-approach.md`: the
 * config is the initial mount, runtime UI state lives in the viewer). An
 * empty overlay (`order: null`, `hidden: {}`) reproduces the authored
 * layout exactly, so a user who changes nothing sees no difference.
 */
import type { NormalizedRow, NormalizedTrack } from './schema/normalize';

export interface LayoutState {
  /**
   * Effective row order as a list of row ids. `null` means "authored
   * order" (no reordering applied).
   */
  order: string[] | null;
  /**
   * Explicit user show/hide choices, keyed by row id (a lane) or the
   * `${groupId}-${trackId}` composite (a track within a group). A present
   * value overrides the authored `hidden` default; an absent key falls back
   * to that default. `true` = hidden, `false` = shown.
   */
  hidden: Record<string, boolean>;
}

/** The empty overlay: authored order, no visibility overrides. */
export function emptyLayout(): LayoutState {
  return { order: null, hidden: {} };
}

/**
 * Resolve whether a lane or track is hidden: an explicit user choice in
 * `layout.hidden` wins, otherwise the authored `hidden` default.
 *
 * @param key   Row id (a lane) or `${groupId}-${trackId}` (a track).
 * @param authoredDefault The config-authored `hidden` for that row/track.
 */
export function isHidden(
  layout: LayoutState,
  key: string,
  authoredDefault?: boolean
): boolean {
  const override = layout.hidden[key];
  return override !== undefined ? override : !!authoredDefault;
}

/**
 * Apply an order overlay to a list of id-bearing items. Items named in
 * `order` come first, in that order, ignoring ids no longer present; any
 * items `order` does not mention keep their original relative position and
 * are appended after. Returns the input unchanged when `order` is `null`.
 *
 * This graceful handling means a saved layout survives config edits: a
 * removed row simply drops out, a newly-added row appears at the end.
 */
export function orderRows<T extends { id: string }>(
  rows: T[],
  order: string[] | null
): T[] {
  if (!order) return rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const result: T[] = [];
  for (const id of order) {
    const row = byId.get(id);
    if (row && !seen.has(id)) {
      result.push(row);
      seen.add(id);
    }
  }
  for (const row of rows) {
    if (!seen.has(row.id)) {
      result.push(row);
      seen.add(row.id);
    }
  }
  return result;
}

/** The lanes to render: authored rows, reordered then visibility-filtered. */
export function effectiveRows(
  rows: NormalizedRow[],
  layout: LayoutState
): NormalizedRow[] {
  return orderRows(rows, layout.order).filter(
    (row) => !isHidden(layout, row.id, row.hidden)
  );
}

/** A group's currently-visible child tracks (hidden ones filtered out). */
export function visibleTracks(
  group: NormalizedRow,
  layout: LayoutState
): NormalizedTrack[] {
  return group.tracks.filter(
    (track) => !isHidden(layout, `${group.id}-${track.id}`, track.hidden)
  );
}
