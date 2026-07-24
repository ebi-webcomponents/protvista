/**
 * Pure layout-overlay logic (`src/layout.ts`) — the flat per-track order +
 * visibility derivation that turns the authored `config.rows` into the
 * display blocks the viewer renders, layered over the config without mutating
 * it.
 *
 * Covers:
 *   - `isHidden` / `orderRows` / `swapIds` / `moveId` / `moveBlock` primitives;
 *   - `flattenTracks` / `orderedTrackKeys` / `effectiveTracks`: the flat track
 *     order + per-track and whole-group visibility;
 *   - `displayBlocks`: grouping by adjacency into intact / partial / single
 *     blocks, and the "all tracks hidden ⇒ group vanishes" rule.
 */
import { describe, it, expect } from 'vitest';
import {
  type LayoutState,
  type Block,
  emptyLayout,
  isHidden,
  orderRows,
  swapIds,
  moveId,
  moveBlock,
  flattenTracks,
  orderedTrackKeys,
  orderedEntries,
  effectiveTracks,
  displayBlocks,
  panelBlocks,
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
  trackDefs: NormalizedTrack[],
  opts: { hidden?: boolean } = {}
): NormalizedRow {
  return {
    id,
    tracks: trackDefs,
    ...(opts.hidden !== undefined ? { hidden: opts.hidden } : {}),
  } as NormalizedRow;
}

function standalone(id: string, hidden?: boolean): NormalizedRow {
  return {
    id,
    standalone: true,
    tracks: [track(id)],
    ...(hidden !== undefined ? { hidden } : {}),
  } as NormalizedRow;
}

function row(
  id: string,
  opts: { hidden?: boolean; tracks?: NormalizedTrack[] } = {}
): NormalizedRow {
  return {
    id,
    tracks: opts.tracks ?? [],
    ...(opts.hidden !== undefined ? { hidden: opts.hidden } : {}),
  } as NormalizedRow;
}

function layout(partial: Partial<LayoutState> = {}): LayoutState {
  return { ...emptyLayout(), ...partial };
}

describe('isHidden', () => {
  it('returns the authored default when there is no user override', () => {
    expect(isHidden(layout(), 'A', true)).toBe(true);
    expect(isHidden(layout(), 'A', false)).toBe(false);
    expect(isHidden(layout(), 'A')).toBe(false);
  });

  it('lets a user override win over the authored default (both directions)', () => {
    expect(isHidden(layout({ hidden: { A: false } }), 'A', true)).toBe(false);
    expect(isHidden(layout({ hidden: { A: true } }), 'A', false)).toBe(true);
  });
});

describe('orderRows', () => {
  const rows = [row('A'), row('B'), row('C')];

  it('is a no-op when order is null', () => {
    expect(orderRows(rows, null).map((r) => r.id)).toEqual(['A', 'B', 'C']);
  });

  it('reorders by the saved order, ignores unknown ids, appends the rest', () => {
    expect(orderRows(rows, ['C', 'GONE']).map((r) => r.id)).toEqual([
      'C',
      'A',
      'B',
    ]);
  });

  it('does not duplicate a row named twice', () => {
    expect(orderRows(rows, ['A', 'A', 'B']).map((r) => r.id)).toEqual([
      'A',
      'B',
      'C',
    ]);
  });
});

describe('swapIds', () => {
  it('swaps two ids in place', () => {
    expect(swapIds(['A', 'B', 'C'], 'A', 'B')).toEqual(['B', 'A', 'C']);
  });

  it('is a no-op copy when an id is absent or a === b', () => {
    expect(swapIds(['A', 'B'], 'A', 'A')).toEqual(['A', 'B']);
    expect(swapIds(['A', 'B'], 'A', 'Z')).toEqual(['A', 'B']);
  });
});

describe('moveId', () => {
  it('moves an id to sit immediately before the target', () => {
    expect(moveId(['A', 'B', 'C', 'D'], 'A', 'C')).toEqual(['B', 'A', 'C', 'D']);
    expect(moveId(['A', 'B', 'C', 'D'], 'D', 'B')).toEqual(['A', 'D', 'B', 'C']);
  });

  it('is a no-op copy when an id is absent or moved === target', () => {
    expect(moveId(['A', 'B'], 'A', 'A')).toEqual(['A', 'B']);
    expect(moveId(['A', 'B'], 'Z', 'B')).toEqual(['A', 'B']);
  });
});

describe('moveBlock', () => {
  it('moves a contiguous block to sit before the target key', () => {
    // Move the [b1, b2] block before 'x'.
    expect(moveBlock(['x', 'b1', 'b2', 'y'], ['b1', 'b2'], 'x')).toEqual([
      'b1',
      'b2',
      'x',
      'y',
    ]);
  });

  it('appends the block at the end when beforeKey is null or absent', () => {
    expect(moveBlock(['a', 'b1', 'b2', 'c'], ['b1', 'b2'], null)).toEqual([
      'a',
      'c',
      'b1',
      'b2',
    ]);
    expect(moveBlock(['a', 'b1', 'b2', 'c'], ['b1', 'b2'], 'GONE')).toEqual([
      'a',
      'c',
      'b1',
      'b2',
    ]);
  });
});

// ── Flat per-track model ─────────────────────────────────────

// G1: t1, t2   S: standalone   G3: a, b, c
const CONFIG = [
  group('G1', [track('t1'), track('t2')]),
  standalone('S'),
  group('G3', [track('a'), track('b'), track('c')]),
];

describe('flattenTracks', () => {
  it('yields every track key in authored order', () => {
    expect(flattenTracks(CONFIG).map((e) => e.key)).toEqual([
      'G1-t1',
      'G1-t2',
      'S-S',
      'G3-a',
      'G3-b',
      'G3-c',
    ]);
  });
});

describe('orderedTrackKeys', () => {
  it('applies the flat track-key order and appends the unmentioned', () => {
    const out = orderedTrackKeys(CONFIG, layout({ order: ['G3-b', 'G1-t2'] }));
    expect(out).toEqual([
      'G3-b',
      'G1-t2',
      'G1-t1',
      'S-S',
      'G3-a',
      'G3-c',
    ]);
  });
});

describe('effectiveTracks', () => {
  it('is authored order under the empty layout', () => {
    expect(effectiveTracks(CONFIG, emptyLayout()).map((e) => e.key)).toEqual([
      'G1-t1',
      'G1-t2',
      'S-S',
      'G3-a',
      'G3-b',
      'G3-c',
    ]);
  });

  it('filters a hidden track by its key', () => {
    const out = effectiveTracks(CONFIG, layout({ hidden: { 'G3-b': true } }));
    expect(out.map((e) => e.key)).not.toContain('G3-b');
    expect(out).toHaveLength(5);
  });

  it('an explicit group hide suppresses all its tracks', () => {
    const out = effectiveTracks(CONFIG, layout({ hidden: { G3: true } }));
    expect(out.map((e) => e.key)).toEqual(['G1-t1', 'G1-t2', 'S-S']);
  });
});

/** Compact block summary for assertions. */
function summarize(blocks: Block[]): string[] {
  return blocks.map((b) =>
    b.kind === 'group'
      ? `${b.intact ? 'intact' : 'partial'}:${b.group.id}[${b.tracks
          .map((t) => t.key)
          .join(',')}]`
      : `${b.separated ? 'sep' : 'stand'}:${b.entry.key}`
  );
}

describe('displayBlocks', () => {
  it('groups intact groups + standalone under the empty layout', () => {
    expect(summarize(displayBlocks(CONFIG, emptyLayout()))).toEqual([
      'intact:G1[G1-t1,G1-t2]',
      'stand:S-S',
      'intact:G3[G3-a,G3-b,G3-c]',
    ]);
  });

  it('renders a track moved out of its group as a separated single', () => {
    // Pull G3-b up between G1 and S.
    const out = displayBlocks(
      CONFIG,
      layout({ order: ['G1-t1', 'G1-t2', 'G3-b', 'S-S', 'G3-a', 'G3-c'] })
    );
    expect(summarize(out)).toEqual([
      'intact:G1[G1-t1,G1-t2]',
      'sep:G3-b', // isolated → "Group / Track"
      'stand:S-S',
      'partial:G3[G3-a,G3-c]', // the remaining two stay bracketed
    ]);
  });

  it('brackets a contiguous run of ≥2 split tracks as a partial group', () => {
    // G3 split into [a,b] together and [c] alone.
    const out = displayBlocks(
      CONFIG,
      layout({ order: ['G3-a', 'G3-b', 'S-S', 'G3-c', 'G1-t1', 'G1-t2'] })
    );
    expect(summarize(out)).toEqual([
      'partial:G3[G3-a,G3-b]',
      'stand:S-S',
      'sep:G3-c',
      'intact:G1[G1-t1,G1-t2]',
    ]);
  });

  it('vanishes a group whose tracks are all hidden (item 2)', () => {
    const out = displayBlocks(
      CONFIG,
      layout({ hidden: { 'G1-t1': true, 'G1-t2': true } })
    );
    expect(summarize(out)).toEqual(['stand:S-S', 'intact:G3[G3-a,G3-b,G3-c]']);
  });

  it('treats a group as intact when its visible tracks stay contiguous', () => {
    // Hide the middle track; the visible a,c are still one run → intact.
    const out = displayBlocks(CONFIG, layout({ hidden: { 'G3-b': true } }));
    expect(summarize(out)).toEqual([
      'intact:G1[G1-t1,G1-t2]',
      'stand:S-S',
      'intact:G3[G3-a,G3-c]',
    ]);
  });
});

describe('orderedEntries', () => {
  it('includes hidden tracks in the full order', () => {
    const out = orderedEntries(
      CONFIG,
      layout({ hidden: { 'G1-t1': true, G3: true } })
    );
    expect(out.map((e) => e.key)).toEqual([
      'G1-t1',
      'G1-t2',
      'S-S',
      'G3-a',
      'G3-b',
      'G3-c',
    ]);
  });
});

describe('panelBlocks', () => {
  it('keeps a hidden track in place within its group (unlike displayBlocks)', () => {
    const l = layout({ hidden: { 'G1-t1': true } });
    // The canvas drops the hidden track…
    expect(summarize(displayBlocks(CONFIG, l))).toContain('intact:G1[G1-t2]');
    // …the panel keeps it in place.
    expect(summarize(panelBlocks(CONFIG, l))).toEqual([
      'intact:G1[G1-t1,G1-t2]',
      'stand:S-S',
      'intact:G3[G3-a,G3-b,G3-c]',
    ]);
  });

  it('keeps a fully-hidden group in the list so it stays recoverable', () => {
    const l = layout({ hidden: { G3: true } });
    // The canvas removes the whole group…
    expect(summarize(displayBlocks(CONFIG, l))).toEqual([
      'intact:G1[G1-t1,G1-t2]',
      'stand:S-S',
    ]);
    // …the panel still lists it (dimmed, in place).
    expect(summarize(panelBlocks(CONFIG, l))).toContain(
      'intact:G3[G3-a,G3-b,G3-c]'
    );
  });
});
