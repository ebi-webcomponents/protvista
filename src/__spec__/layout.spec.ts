/**
 * Pure layout logic (`src/layout.ts`) — the transforms customize mode applies
 * to `config.rows`, plus the patch diff/replay that persistence rides on.
 *
 * The config is the source of truth here, so every transform is asserted to
 * (a) produce the new arrangement and (b) leave its input untouched, since
 * the viewer keeps the pristine rows as its "reset to default" baseline.
 *
 * Covers:
 *   - `visibleTracks` / `isRowHidden` / `displayRows` / `hiddenCount`;
 *   - `moveRow` / `moveTrack`: two-level reordering and its bounds;
 *   - `setRowHidden` / `setTrackHidden`: the show/hide cascades;
 *   - `sameArrangement`: the no-op guard the change event depends on;
 *   - `diffLayout` / `applyPatch`: round-trip and tolerance of config edits.
 */
import { describe, it, expect } from 'vitest';
import {
  applyPatch,
  diffLayout,
  displayRows,
  emptyPatch,
  hiddenCount,
  isDefaultPatch,
  isRowHidden,
  moveRow,
  moveTrack,
  sameArrangement,
  setRowHidden,
  setTrackHidden,
  trackKey,
  visibleTracks,
} from '../layout';
import type { NormalizedRow, NormalizedTrack } from '../schema/normalize';

// Minimal fixtures — the layout functions only read `id`, `hidden`,
// `standalone`, and `tracks[].id` / `tracks[].hidden`, so cast focused
// partials to the full normalized shapes.
function track(id: string, hidden?: boolean): NormalizedTrack {
  return { id, ...(hidden !== undefined ? { hidden } : {}) } as NormalizedTrack;
}

function group(
  id: string,
  trackIds: string[],
  opts: { hidden?: boolean } = {}
): NormalizedRow {
  return {
    id,
    tracks: trackIds.map((t) => track(t)),
    ...(opts.hidden !== undefined ? { hidden: opts.hidden } : {}),
  } as NormalizedRow;
}

function standalone(id: string, hidden?: boolean): NormalizedRow {
  return {
    id,
    standalone: true,
    tracks: [track(id, hidden)],
    ...(hidden !== undefined ? { hidden } : {}),
  } as NormalizedRow;
}

const ids = (rows: readonly NormalizedRow[]) => rows.map((r) => r.id);
const trackIdsOf = (row: NormalizedRow) => row.tracks.map((t) => t.id);

/** A three-row config: two groups of two tracks and one standalone. */
function rows(): NormalizedRow[] {
  return [group('A', ['a1', 'a2']), group('B', ['b1', 'b2']), standalone('S')];
}

describe('trackKey', () => {
  it('is the `${rowId}-${trackId}` composite the data map is keyed by', () => {
    expect(trackKey('A', 'a1')).toBe('A-a1');
  });
});

describe('visibility queries', () => {
  it('drops hidden tracks from visibleTracks', () => {
    const row = group('A', ['a1', 'a2']);
    row.tracks[0].hidden = true;
    expect(trackIdsOf({ ...row, tracks: visibleTracks(row) })).toEqual(['a2']);
  });

  it('treats a row hidden outright as hidden', () => {
    expect(isRowHidden(group('A', ['a1'], { hidden: true }))).toBe(true);
  });

  it('treats a row whose every track is hidden as hidden', () => {
    const row = group('A', ['a1', 'a2']);
    row.tracks.forEach((t) => (t.hidden = true));
    expect(isRowHidden(row)).toBe(true);
  });

  it('keeps a row with at least one visible track', () => {
    const row = group('A', ['a1', 'a2']);
    row.tracks[0].hidden = true;
    expect(isRowHidden(row)).toBe(false);
  });

  it('displayRows drops hidden rows and hidden tracks', () => {
    const input = rows();
    input[0].tracks[0].hidden = true;
    input[1].hidden = true;
    const shown = displayRows(input);
    expect(shown.map((d) => d.row.id)).toEqual(['A', 'S']);
    expect(shown[0].tracks.map((t) => t.id)).toEqual(['a2']);
  });

  // The badge answers "how much of the data am I not seeing", so hiding a
  // group of two and hiding one track must not both read as "1 hidden".
  it('counts every track a hidden row contains', () => {
    const input = rows();
    input[0].hidden = true;
    expect(hiddenCount(input)).toBe(2);
  });

  it('counts individually hidden tracks inside a visible row', () => {
    const input = rows();
    input[0].tracks[0].hidden = true;
    input[1].tracks[0].hidden = true;
    expect(hiddenCount(input)).toBe(2);
  });

  it('counts a hidden standalone row as its one track', () => {
    const input = rows();
    input[2].hidden = true;
    expect(hiddenCount(input)).toBe(1);
  });

  it('is zero when nothing is hidden', () => {
    expect(hiddenCount(rows())).toBe(0);
  });

  // A track with no data is absent because none arrived, not because anyone
  // hid it, and showing it would change nothing.
  it('excludes tracks the caller marks as having nothing to draw', () => {
    const input = rows();
    input[0].hidden = true;
    const isEmpty = (rowId: string, trackId: string) =>
      rowId === 'A' && trackId === 'a2';
    expect(hiddenCount(input, isEmpty)).toBe(1);
  });
});

describe('moveRow', () => {
  it('moves a row to the given index', () => {
    expect(ids(moveRow(rows(), 'S', 0))).toEqual(['S', 'A', 'B']);
  });

  it('reaches the last position', () => {
    expect(ids(moveRow(rows(), 'A', 2))).toEqual(['B', 'S', 'A']);
  });

  it('clamps an out-of-range index rather than dropping the row', () => {
    expect(ids(moveRow(rows(), 'A', 99))).toEqual(['B', 'S', 'A']);
    expect(ids(moveRow(rows(), 'S', -5))).toEqual(['S', 'A', 'B']);
  });

  it('is a no-op copy for an unknown id', () => {
    const input = rows();
    const out = moveRow(input, 'nope', 0);
    expect(ids(out)).toEqual(['A', 'B', 'S']);
    expect(out).not.toBe(input);
  });

  it('does not mutate its input', () => {
    const input = rows();
    moveRow(input, 'S', 0);
    expect(ids(input)).toEqual(['A', 'B', 'S']);
  });
});

describe('moveTrack', () => {
  it('reorders within the row', () => {
    const out = moveTrack(rows(), 'A', 'a2', 0);
    expect(trackIdsOf(out[0])).toEqual(['a2', 'a1']);
  });

  it('leaves other rows referentially untouched', () => {
    const input = rows();
    const out = moveTrack(input, 'A', 'a2', 0);
    expect(out[1]).toBe(input[1]);
    expect(out[2]).toBe(input[2]);
  });

  it('is a no-op for an unknown row or track', () => {
    expect(trackIdsOf(moveTrack(rows(), 'nope', 'a1', 0)[0])).toEqual([
      'a1',
      'a2',
    ]);
    expect(trackIdsOf(moveTrack(rows(), 'A', 'nope', 0)[0])).toEqual([
      'a1',
      'a2',
    ]);
  });

  it('does not mutate its input', () => {
    const input = rows();
    moveTrack(input, 'A', 'a2', 0);
    expect(trackIdsOf(input[0])).toEqual(['a1', 'a2']);
  });
});

describe('setRowHidden', () => {
  it('hides a row', () => {
    expect(setRowHidden(rows(), 'A', true)[0].hidden).toBe(true);
  });

  it('showing a row also clears per-track hides inside it', () => {
    let input = setTrackHidden(rows(), 'A', 'a1', true);
    input = setTrackHidden(input, 'A', 'a2', true);
    expect(isRowHidden(input[0])).toBe(true);

    const shown = setRowHidden(input, 'A', false);
    expect(shown[0].hidden).toBe(false);
    expect(shown[0].tracks.every((t) => !t.hidden)).toBe(true);
  });

  it('keeps a standalone row and its single track in step', () => {
    const out = setRowHidden(rows(), 'S', true);
    expect(out[2].hidden).toBe(true);
    expect(out[2].tracks[0].hidden).toBe(true);
  });

  it('does not mutate its input', () => {
    const input = rows();
    setRowHidden(input, 'A', true);
    expect(input[0].hidden).toBeUndefined();
  });
});

describe('setTrackHidden', () => {
  it('hides one track and leaves its siblings alone', () => {
    const out = setTrackHidden(rows(), 'A', 'a1', true);
    expect(out[0].tracks[0].hidden).toBe(true);
    expect(out[0].tracks[1].hidden).toBeFalsy();
  });

  it('hiding every track empties the row', () => {
    let out = setTrackHidden(rows(), 'A', 'a1', true);
    out = setTrackHidden(out, 'A', 'a2', true);
    expect(isRowHidden(out[0])).toBe(true);
    expect(displayRows(out).map((d) => d.row.id)).toEqual(['B', 'S']);
  });

  it('showing a track inside a hidden row reveals the row too', () => {
    const hiddenRow = setRowHidden(rows(), 'A', true);
    const out = setTrackHidden(hiddenRow, 'A', 'a1', false);
    expect(out[0].hidden).toBe(false);
    expect(isRowHidden(out[0])).toBe(false);
  });

  it('keeps a standalone row in step with its track', () => {
    const out = setTrackHidden(rows(), 'S', 'S', true);
    expect(out[2].hidden).toBe(true);
  });
});

describe('sameArrangement', () => {
  it('is true for an identical arrangement', () => {
    expect(sameArrangement(rows(), rows())).toBe(true);
  });

  it('is false when the row order differs', () => {
    expect(sameArrangement(rows(), moveRow(rows(), 'S', 0))).toBe(false);
  });

  it('is false when a track order differs', () => {
    expect(sameArrangement(rows(), moveTrack(rows(), 'A', 'a2', 0))).toBe(false);
  });

  it('is false when visibility differs', () => {
    expect(sameArrangement(rows(), setRowHidden(rows(), 'A', true))).toBe(false);
  });

  it('treats undefined and false hidden as the same state', () => {
    const explicit = setRowHidden(setRowHidden(rows(), 'A', true), 'A', false);
    expect(sameArrangement(rows(), explicit)).toBe(true);
  });
});

describe('diffLayout', () => {
  it('is the empty patch when nothing changed', () => {
    expect(isDefaultPatch(diffLayout(rows(), rows()))).toBe(true);
  });

  it('records a row reorder as the full row order', () => {
    const patch = diffLayout(rows(), moveRow(rows(), 'S', 0));
    expect(patch.order).toEqual(['S', 'A', 'B']);
    expect(patch.tracks).toEqual({});
  });

  it('records a track reorder under its row id only', () => {
    const patch = diffLayout(rows(), moveTrack(rows(), 'A', 'a2', 0));
    expect(patch.order).toBeNull();
    expect(patch.tracks).toEqual({ A: ['a2', 'a1'] });
  });

  it('records a row hide under the row id', () => {
    expect(diffLayout(rows(), setRowHidden(rows(), 'A', true)).hidden).toEqual({
      A: true,
    });
  });

  it('records a track hide under the composite key', () => {
    const patch = diffLayout(rows(), setTrackHidden(rows(), 'A', 'a1', true));
    expect(patch.hidden).toEqual({ 'A-a1': true });
  });

  it('records a standalone row once, never under both keys', () => {
    const patch = diffLayout(rows(), setRowHidden(rows(), 'S', true));
    expect(patch.hidden).toEqual({ S: true });
  });

  it('records revealing an author-hidden row as an explicit show', () => {
    const authored = [group('A', ['a1'], { hidden: true })];
    const patch = diffLayout(authored, setRowHidden(authored, 'A', false));
    expect(patch.hidden).toEqual({ A: false });
  });
});

describe('applyPatch', () => {
  it('replays a row reorder', () => {
    const patch = { ...emptyPatch(), order: ['S', 'B', 'A'] };
    expect(ids(applyPatch(rows(), patch))).toEqual(['S', 'B', 'A']);
  });

  it('replays a track reorder', () => {
    const patch = { ...emptyPatch(), tracks: { A: ['a2', 'a1'] } };
    expect(trackIdsOf(applyPatch(rows(), patch)[0])).toEqual(['a2', 'a1']);
  });

  it('replays row and track hides', () => {
    const patch = { ...emptyPatch(), hidden: { B: true, 'A-a1': true } };
    const out = applyPatch(rows(), patch);
    expect(out[1].hidden).toBe(true);
    expect(out[0].tracks[0].hidden).toBe(true);
  });

  it('keeps a standalone row and its track in step', () => {
    const out = applyPatch(rows(), { ...emptyPatch(), hidden: { S: true } });
    expect(out[2].hidden).toBe(true);
    expect(out[2].tracks[0].hidden).toBe(true);
  });

  it('does not mutate the baseline', () => {
    const base = rows();
    applyPatch(base, { ...emptyPatch(), order: ['S'], hidden: { A: true } });
    expect(ids(base)).toEqual(['A', 'B', 'S']);
    expect(base[0].hidden).toBeUndefined();
  });

  // A saved layout has to survive the config being edited underneath it —
  // otherwise every authoring change silently discards users' arrangements.
  it('ignores ids the config no longer has', () => {
    const patch = { ...emptyPatch(), order: ['gone', 'S', 'A'] };
    expect(ids(applyPatch(rows(), patch))).toEqual(['S', 'A', 'B']);
  });

  it('appends rows the patch never mentions, in authored order', () => {
    const patch = { ...emptyPatch(), order: ['S'] };
    expect(ids(applyPatch(rows(), patch))).toEqual(['S', 'A', 'B']);
  });

  it('leaves unmentioned tracks in authored order', () => {
    const patch = { ...emptyPatch(), tracks: { A: ['a2'] } };
    expect(trackIdsOf(applyPatch(rows(), patch)[0])).toEqual(['a2', 'a1']);
  });
});

describe('diffLayout / applyPatch round-trip', () => {
  it('reproduces an arrangement of reorders and hides', () => {
    const base = rows();
    let arranged = moveRow(base, 'S', 0);
    arranged = moveTrack(arranged, 'A', 'a2', 0);
    arranged = setTrackHidden(arranged, 'B', 'b1', true);
    arranged = setRowHidden(arranged, 'A', true);

    const replayed = applyPatch(base, diffLayout(base, arranged));
    expect(sameArrangement(replayed, arranged)).toBe(true);
  });
});
