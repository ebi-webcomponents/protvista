/**
 * Layout transforms: the pure order + visibility logic behind the viewer's
 * customize mode. Kept out of the component so it is unit-testable in
 * isolation and reused by the render loop, the runtime API, and persistence.
 *
 * **The config is the source of truth.** Every transform here maps a
 * `NormalizedRow[]` to a new `NormalizedRow[]` — a reorder moves entries in
 * `config.rows` / `row.tracks`, and a show/hide writes the same `hidden`
 * field an author can set in config. Nothing is layered on top at render
 * time, so what the user arranged *is* the config, and can be exported and
 * re-loaded (see `src/schema/denormalize.ts`).
 *
 * Movement is two-level and stays within the shape config can express: rows
 * reorder among rows, tracks reorder within their own row. A track cannot
 * leave its group.
 *
 * Inputs are never mutated — each transform returns fresh arrays/objects, so
 * the pristine baseline the viewer keeps for "reset to default" stays intact
 * and Lit's identity dirty-check fires on the result.
 */
import type { NormalizedRow, NormalizedTrack } from './schema/normalize.js';
import type { LayoutPatch } from './schema/types.js';

export type { LayoutPatch };

/** The global key for a track: `${rowId}-${trackId}`. Also the data-push key. */
export function trackKey(rowId: string, trackId: string): string {
  return `${rowId}-${trackId}`;
}

/**
 * The empty patch: authored order, no visibility overrides.
 *
 * The id-keyed maps are `Object.create(null)` so a config whose row/track id
 * happens to be an `Object.prototype` member name (`constructor`, `toString`,
 * `__proto__`, …) can't have a lookup resolve to an inherited value — which
 * would otherwise make `applyPatch` throw or apply a garbage `hidden`.
 */
export function emptyPatch(): LayoutPatch {
  return {
    order: null,
    tracks: Object.create(null),
    hidden: { rows: Object.create(null), tracks: Object.create(null) },
  };
}

/** Whether a patch would leave the authored config untouched. */
export function isDefaultPatch(patch: LayoutPatch): boolean {
  return (
    patch.order === null &&
    Object.keys(patch.tracks).length === 0 &&
    Object.keys(patch.hidden.rows).length === 0 &&
    Object.keys(patch.hidden.tracks).length === 0
  );
}

// ─────────────────────────────────────────────────────────────
// Visibility queries
// ─────────────────────────────────────────────────────────────

/** The tracks of a row that are not hidden. */
export function visibleTracks(row: NormalizedRow): NormalizedTrack[] {
  return row.tracks.filter((t) => !t.hidden);
}

/**
 * Whether a row renders nothing: hidden outright, or left with no visible
 * track (hiding every track of a group empties it, so the group header and
 * its aggregate go too).
 */
export function isRowHidden(row: NormalizedRow): boolean {
  return !!row.hidden || visibleTracks(row).length === 0;
}

/** One row to render, paired with the tracks that survive its hides. */
export interface DisplayRow {
  row: NormalizedRow;
  tracks: NormalizedTrack[];
}

/** The rows the canvas renders, in config order, hidden ones dropped. */
export function displayRows(rows: NormalizedRow[]): DisplayRow[] {
  return rows
    .filter((row) => !isRowHidden(row))
    .map((row) => ({ row, tracks: visibleTracks(row) }));
}

/**
 * How many **tracks** are hidden — the number the "N hidden" badge shows.
 *
 * Counted per track, not per toggle: hiding a group of six and hiding one
 * track are not both "1 hidden". The badge answers "how much of the data am
 * I not seeing", so it has to count the things that would come back.
 *
 * @param isEmpty Optional predicate marking a track as having nothing to
 *   draw. Those are excluded: they are absent because no data arrived, not
 *   because the user hid them, and showing them would change nothing.
 */
export function hiddenCount(
  rows: NormalizedRow[],
  isEmpty?: (rowId: string, trackId: string) => boolean
): number {
  let n = 0;
  for (const row of rows) {
    const rowHidden = !!row.hidden;
    for (const track of row.tracks) {
      if (isEmpty?.(row.id, track.id)) continue;
      if (rowHidden || track.hidden) n += 1;
    }
  }
  return n;
}

// ─────────────────────────────────────────────────────────────
// Order transforms
// ─────────────────────────────────────────────────────────────

/**
 * Move the item at `from` to sit at index `to` in a copy of `items`. `to` is
 * the destination index in the *resulting* list, so `to === items.length - 1`
 * puts the item last. Out-of-range indices clamp; a no-op returns a copy.
 */
function moveAt<T>(items: readonly T[], from: number, to: number): T[] {
  const out = items.slice();
  if (from < 0 || from >= out.length) return out;
  const clamped = Math.max(0, Math.min(out.length - 1, to));
  if (clamped === from) return out;
  const [moved] = out.splice(from, 1);
  out.splice(clamped, 0, moved);
  return out;
}

/**
 * Move a row to index `to` among the rows. Unknown `rowId` is a no-op copy.
 * `to` is an index into the full row list including hidden rows, which is
 * what the customize-mode UI works in (hidden rows stay in place as stubs).
 */
export function moveRow(
  rows: NormalizedRow[],
  rowId: string,
  to: number
): NormalizedRow[] {
  return moveAt(rows, rows.findIndex((r) => r.id === rowId), to);
}

/**
 * Move a track to index `to` within its own row. Unknown `rowId` / `trackId`
 * is a no-op copy. Cross-row moves are deliberately not expressible — see the
 * module header.
 */
export function moveTrack(
  rows: NormalizedRow[],
  rowId: string,
  trackId: string,
  to: number
): NormalizedRow[] {
  return rows.map((row) => {
    if (row.id !== rowId) return row;
    const from = row.tracks.findIndex((t) => t.id === trackId);
    if (from === -1) return row;
    return { ...row, tracks: moveAt(row.tracks, from, to) };
  });
}

// ─────────────────────────────────────────────────────────────
// Visibility transforms
// ─────────────────────────────────────────────────────────────

/**
 * Show or hide a whole row. Showing also clears any per-track hides inside
 * it, so "show group" fully reveals a group whose tracks were hidden
 * individually rather than leaving it visible but empty.
 *
 * A standalone row *is* its single track, so both flags are kept in step —
 * whichever control the user reaches, the exported config reads the same.
 */
export function setRowHidden(
  rows: NormalizedRow[],
  rowId: string,
  hidden: boolean
): NormalizedRow[] {
  return rows.map((row) => {
    if (row.id !== rowId) return row;
    if (hidden) {
      return row.standalone
        ? { ...row, hidden: true, tracks: row.tracks.map(hide) }
        : { ...row, hidden: true };
    }
    return { ...row, hidden: false, tracks: row.tracks.map(show) };
  });
}

/**
 * Show or hide one track within a row. Hiding the last visible track of a
 * group empties the row (`isRowHidden`); showing a track inside a row that
 * was hidden outright also reveals the row, so the track the user asked for
 * actually appears.
 */
export function setTrackHidden(
  rows: NormalizedRow[],
  rowId: string,
  trackId: string,
  hidden: boolean
): NormalizedRow[] {
  return rows.map((row) => {
    if (row.id !== rowId) return row;

    // Revealing one track of a wholly-hidden group: the group comes back, but
    // carrying only the track that was asked for. The row's hide moves onto
    // its other tracks rather than evaporating — "show this one" must not be
    // a back door to showing all six.
    if (!hidden && row.hidden && !row.standalone) {
      return {
        ...row,
        hidden: false,
        tracks: row.tracks.map((t) => (t.id === trackId ? show(t) : hide(t))),
      };
    }

    const tracks = row.tracks.map((t) =>
      t.id === trackId ? (hidden ? hide(t) : show(t)) : t
    );
    const next: NormalizedRow = { ...row, tracks };
    if (!hidden && row.hidden) next.hidden = false;
    if (row.standalone) next.hidden = hidden;
    return next;
  });
}

const hide = <T extends { hidden?: boolean }>(x: T): T => ({
  ...x,
  hidden: true,
});
const show = <T extends { hidden?: boolean }>(x: T): T => ({
  ...x,
  hidden: false,
});

// ─────────────────────────────────────────────────────────────
// Patch: diff against the authored baseline, and re-apply
// ─────────────────────────────────────────────────────────────
//
// The config is what renders, but persisting a whole config into
// localStorage and a `?layout=` URL would be far too heavy. So the viewer
// keeps the pristine normalized rows as a baseline and stores only the diff:
// which rows moved, which tracks moved within their row, and what the user
// showed or hid. `applyPatch` replays that diff onto the baseline at mount.

/**
 * Reorder id-bearing items by an id list. Items named in `order` come first,
 * in that order, ignoring ids no longer present; items `order` does not
 * mention keep their relative position and are appended after.
 *
 * This graceful handling is what lets a saved layout survive config edits: a
 * removed row simply drops out, a newly-added row appears at the end.
 */
function orderByIds<T extends { id: string }>(
  items: readonly T[],
  order: string[] | null | undefined
): T[] {
  if (!order) return items.slice();
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const result: T[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (item && !seen.has(id)) {
      result.push(item);
      seen.add(id);
    }
  }
  for (const item of items) {
    if (!seen.has(item.id)) result.push(item);
  }
  return result;
}

const sameIds = (a: readonly { id: string }[], b: readonly { id: string }[]) =>
  a.length === b.length && a.every((x, i) => x.id === b[i].id);

/**
 * Whether two row lists arrange the same things the same way — same row
 * order, same track order within each row, same visibility. The viewer uses
 * this to drop no-op edits (dragging a row back where it started, toggling a
 * track to the state it already had) before they reach the change event, so
 * `protvista-layout-change` only ever fires on a real change.
 */
export function sameArrangement(
  a: readonly NormalizedRow[],
  b: readonly NormalizedRow[]
): boolean {
  if (!sameIds(a, b)) return false;
  return a.every((row, i) => {
    const other = b[i];
    if (!!row.hidden !== !!other.hidden) return false;
    if (!sameIds(row.tracks, other.tracks)) return false;
    return row.tracks.every((t, j) => !!t.hidden === !!other.tracks[j].hidden);
  });
}

/**
 * The diff from the authored baseline to the current rows: the patch that,
 * replayed onto `base` by `applyPatch`, reproduces `current`. Returns the
 * empty patch when nothing was customized, which is what lets the viewer
 * clear its stored layout instead of persisting a no-op.
 */
export function diffLayout(
  base: NormalizedRow[],
  current: NormalizedRow[]
): LayoutPatch {
  const patch = emptyPatch();
  if (!sameIds(base, current)) patch.order = current.map((r) => r.id);

  const baseById = new Map(base.map((r) => [r.id, r]));
  for (const row of current) {
    const from = baseById.get(row.id);
    // A row absent from the baseline has no authored state to diff against;
    // `order` already carries its position and its hides read as authored.
    if (!from) continue;

    if (!sameIds(from.tracks, row.tracks)) {
      patch.tracks[row.id] = row.tracks.map((t) => t.id);
    }
    if (!!row.hidden !== !!from.hidden) patch.hidden.rows[row.id] = !!row.hidden;

    // A standalone row's track hide is the row hide; recording both would
    // double-count and let the two drift apart in storage.
    if (row.standalone) continue;
    const trackById = new Map(from.tracks.map((t) => [t.id, t]));
    for (const track of row.tracks) {
      const fromTrack = trackById.get(track.id);
      if (fromTrack && !!track.hidden !== !!fromTrack.hidden) {
        let hides = patch.hidden.tracks[row.id];
        if (!hides) hides = patch.hidden.tracks[row.id] = Object.create(null);
        hides[track.id] = !!track.hidden;
      }
    }
  }
  return patch;
}

/**
 * Replay a saved patch onto the authored baseline. Unknown ids are ignored
 * and unmentioned rows/tracks keep their authored order and visibility, so a
 * layout saved before a config edit still restores what it can.
 */
export function applyPatch(
  base: NormalizedRow[],
  patch: LayoutPatch
): NormalizedRow[] {
  return orderByIds(base, patch.order).map((row) => {
    const trackHides = patch.hidden.tracks[row.id];
    const tracks = orderByIds(row.tracks, patch.tracks[row.id]).map((track) => {
      const override = trackHides ? trackHides[track.id] : undefined;
      return override === undefined ? track : { ...track, hidden: override };
    });
    const rowOverride = patch.hidden.rows[row.id];
    const next: NormalizedRow = { ...row, tracks };
    if (rowOverride !== undefined) {
      next.hidden = rowOverride;
      // Keep a standalone row and its single track in step (see `diffLayout`).
      if (row.standalone) {
        next.tracks = tracks.map((t) => ({ ...t, hidden: rowOverride }));
      }
    }
    return next;
  });
}
