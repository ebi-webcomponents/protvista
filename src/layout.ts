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
import type { ViewerLayout } from './schema/types';

/**
 * The runtime layout overlay. Structurally the public `ViewerLayout`
 * contract (`getLayout()` / the `protvista-layout-change` event `detail`);
 * aliased here so the render/logic code reads in layout terms.
 */
export type LayoutState = ViewerLayout;

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

/**
 * Return a copy of `ids` with the positions of `a` and `b` swapped. Used by
 * the move-up / move-down controls (swap a lane with its visible neighbour).
 * A no-op copy when either id is absent or `a === b`.
 */
export function swapIds(ids: string[], a: string, b: string): string[] {
  const ia = ids.indexOf(a);
  const ib = ids.indexOf(b);
  if (ia === -1 || ib === -1 || ia === ib) return ids.slice();
  const out = ids.slice();
  out[ia] = b;
  out[ib] = a;
  return out;
}

/**
 * Move `movedId` to sit immediately before `targetId`. Used by drag-and-drop
 * (drop a lane onto another). A no-op copy when either id is absent or they
 * are equal.
 */
export function moveId(
  ids: string[],
  movedId: string,
  targetId: string
): string[] {
  if (movedId === targetId) return ids.slice();
  if (ids.indexOf(movedId) === -1 || ids.indexOf(targetId) === -1) {
    return ids.slice();
  }
  const out = ids.filter((id) => id !== movedId);
  out.splice(out.indexOf(targetId), 0, movedId);
  return out;
}

/**
 * Move the contiguous set `blockKeys` (kept in their given order) to sit
 * immediately before `beforeKey`, or at the end when `beforeKey` is `null` or
 * absent. Used to move a whole group block past its neighbour while leaving
 * the other keys (including hidden tracks) in place.
 */
export function moveBlock(
  allKeys: string[],
  blockKeys: string[],
  beforeKey: string | null
): string[] {
  const moving = new Set(blockKeys);
  const rest = allKeys.filter((k) => !moving.has(k));
  const idx = beforeKey === null ? -1 : rest.indexOf(beforeKey);
  const at = idx === -1 ? rest.length : idx;
  return [...rest.slice(0, at), ...blockKeys, ...rest.slice(at)];
}

// ─────────────────────────────────────────────────────────────
// Flat per-track model
// ─────────────────────────────────────────────────────────────
//
// Order is a flat list of track keys (`${groupId}-${trackId}`); grouping is
// derived from adjacency, not stored. Same-group tracks that stay adjacent
// render together under the group header; a track moved away from its
// siblings renders on its own as "Group / Track".

/** The global key for a track: `${groupId}-${trackId}`. */
export function trackKey(groupId: string, trackId: string): string {
  return `${groupId}-${trackId}`;
}

export interface TrackEntry {
  group: NormalizedRow;
  track: NormalizedTrack;
  /** Global `${groupId}-${trackId}` key (data-push, hidden, and order key). */
  key: string;
}

/** Every track in authored order, flattened out of the rows. */
export function flattenTracks(rows: NormalizedRow[]): TrackEntry[] {
  const out: TrackEntry[] = [];
  for (const group of rows) {
    for (const track of group.tracks) {
      out.push({ group, track, key: trackKey(group.id, track.id) });
    }
  }
  return out;
}

/** The full flat order of every track key (visible + hidden), overlay applied. */
export function orderedTrackKeys(
  rows: NormalizedRow[],
  layout: LayoutState
): string[] {
  return orderRows(
    flattenTracks(rows).map((e) => ({ id: e.key })),
    layout.order
  ).map((x) => x.id);
}

/**
 * The tracks to display, in effective order, with hidden ones removed. A
 * track is hidden when it (or its whole group) is hidden — so an explicit
 * group hide, or hiding every track of a group, empties the group entirely.
 */
export function effectiveTracks(
  rows: NormalizedRow[],
  layout: LayoutState
): TrackEntry[] {
  const byKey = new Map(flattenTracks(rows).map((e) => [e.key, e]));
  return orderedTrackKeys(rows, layout)
    .map((key) => byKey.get(key))
    .filter((e): e is TrackEntry => e !== undefined)
    .filter(
      (e) =>
        // A whole-group hide suppresses every track. A standalone row *is*
        // its track, so it is controlled by the row id alone (its separate
        // per-track key is not consulted, avoiding a two-key tangle).
        !isHidden(layout, e.group.id, e.group.hidden) &&
        (e.group.standalone || !isHidden(layout, e.key, e.track.hidden))
    );
}

/**
 * One displayed unit on the canvas / in the panel.
 *
 * - `group` intact: all of a real group's visible tracks are contiguous →
 *   render the collapsible header + aggregate + tracks.
 * - `group` partial (`intact:false`): a run of ≥2 tracks of a split group →
 *   a label-only bracket header + the tracks, always expanded, no aggregate.
 * - `single`: one track — a standalone (`separated:false`, its own label) or a
 *   track isolated from a multi-track group (`separated:true`, "Group / Track").
 */
export type Block =
  | { kind: 'group'; group: NormalizedRow; tracks: TrackEntry[]; intact: boolean }
  | { kind: 'single'; entry: TrackEntry; separated: boolean };

/** The full ordered track list (visible + hidden), overlay applied. */
export function orderedEntries(
  rows: NormalizedRow[],
  layout: LayoutState
): TrackEntry[] {
  const byKey = new Map(flattenTracks(rows).map((e) => [e.key, e]));
  return orderedTrackKeys(rows, layout)
    .map((key) => byKey.get(key))
    .filter((e): e is TrackEntry => e !== undefined);
}

/**
 * Group a list of ordered track entries into display blocks (see `Block`),
 * classifying each maximal same-group run against how many of that group's
 * tracks are present in the list. Shared by the canvas (`displayBlocks`,
 * visible tracks only) and the panel (`panelBlocks`, every track).
 */
function groupIntoBlocks(entries: TrackEntry[]): Block[] {
  const countByGroup = new Map<string, number>();
  for (const e of entries) {
    countByGroup.set(e.group.id, (countByGroup.get(e.group.id) ?? 0) + 1);
  }

  const blocks: Block[] = [];
  let i = 0;
  while (i < entries.length) {
    const groupId = entries[i].group.id;
    let j = i + 1;
    while (j < entries.length && entries[j].group.id === groupId) j++;
    const run = entries.slice(i, j);
    const group = run[0].group;
    const n = countByGroup.get(groupId) ?? run.length;

    if (run.length === n) {
      // All the group's tracks (in this list) are contiguous → intact.
      if (group.standalone) {
        blocks.push({ kind: 'single', entry: run[0], separated: false });
      } else {
        blocks.push({ kind: 'group', group, tracks: run, intact: true });
      }
    } else if (run.length >= 2) {
      blocks.push({ kind: 'group', group, tracks: run, intact: false });
    } else {
      blocks.push({ kind: 'single', entry: run[0], separated: true });
    }
    i = j;
  }
  return blocks;
}

/**
 * The blocks the **canvas** renders: derived from the visible tracks only, so
 * a hidden track drops out and the group reflows.
 */
export function displayBlocks(
  rows: NormalizedRow[],
  layout: LayoutState
): Block[] {
  return groupIntoBlocks(effectiveTracks(rows, layout));
}

/**
 * The blocks the **Track Manager panel** renders: every track (visible +
 * hidden), grouped the same way, so a hidden track stays in place in its
 * group (the row marks its own hidden state). The canvas still hides them.
 */
export function panelBlocks(
  rows: NormalizedRow[],
  layout: LayoutState
): Block[] {
  return groupIntoBlocks(orderedEntries(rows, layout));
}
