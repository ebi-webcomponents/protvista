/**
 * Pure layout-overlay logic (`src/layout.ts`) — the order + visibility
 * derivation that turns the authored `config.rows` into the displayed
 * rows, layered over the config without mutating it.
 *
 * Covers:
 *   - `isHidden`: user override wins over the authored default, both ways;
 *   - `orderRows`: reorder by id, ignore unknown ids, append config rows
 *     the saved order does not mention, no-op on `null`;
 *   - `effectiveRows`: order + lane visibility combined, authored `hidden`
 *     default honoured and overridable;
 *   - `visibleTracks`: per-track visibility with the `${groupId}-${trackId}`
 *     key, authored default honoured and overridable.
 */
import { describe, it, expect } from 'vitest';
import {
  type LayoutState,
  emptyLayout,
  isHidden,
  orderRows,
  swapIds,
  moveId,
  effectiveRows,
  visibleTracks,
} from '../layout';
import type { NormalizedRow, NormalizedTrack } from '../schema/normalize';

// Minimal fixtures — the layout functions only read `id`, `hidden`, and
// `tracks[].id` / `tracks[].hidden`, so cast focused partials to the full
// normalized shapes rather than spelling out every resolved field.
function track(id: string, hidden?: boolean): NormalizedTrack {
  return { id, ...(hidden !== undefined ? { hidden } : {}) } as NormalizedTrack;
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
    // User reveals an author-hidden row.
    expect(isHidden(layout({ hidden: { A: false } }), 'A', true)).toBe(false);
    // User hides an author-visible row.
    expect(isHidden(layout({ hidden: { A: true } }), 'A', false)).toBe(true);
  });
});

describe('orderRows', () => {
  const rows = [row('A'), row('B'), row('C')];

  it('is a no-op when order is null (authored order preserved)', () => {
    expect(orderRows(rows, null).map((r) => r.id)).toEqual(['A', 'B', 'C']);
  });

  it('reorders rows by the saved id order', () => {
    expect(orderRows(rows, ['C', 'A', 'B']).map((r) => r.id)).toEqual([
      'C',
      'A',
      'B',
    ]);
  });

  it('ignores ids in the saved order that are no longer in the config', () => {
    expect(orderRows(rows, ['C', 'GONE', 'A']).map((r) => r.id)).toEqual([
      'C',
      'A',
      'B',
    ]);
  });

  it('appends config rows the saved order does not mention, in authored order', () => {
    // A newly-added row 'B' and 'C' are absent from the saved order.
    expect(orderRows(rows, ['C']).map((r) => r.id)).toEqual(['C', 'A', 'B']);
  });

  it('does not duplicate a row named twice in the saved order', () => {
    expect(orderRows(rows, ['A', 'A', 'B']).map((r) => r.id)).toEqual([
      'A',
      'B',
      'C',
    ]);
  });
});

describe('swapIds', () => {
  it('swaps two ids in place (move up/down)', () => {
    expect(swapIds(['A', 'B', 'C'], 'A', 'B')).toEqual(['B', 'A', 'C']);
    expect(swapIds(['A', 'B', 'C'], 'C', 'A')).toEqual(['C', 'B', 'A']);
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

describe('effectiveRows', () => {
  it('returns authored rows unchanged under the empty layout', () => {
    const rows = [row('A'), row('B')];
    expect(effectiveRows(rows, emptyLayout())).toEqual(rows);
  });

  it('applies order then filters hidden lanes', () => {
    const rows = [row('A'), row('B'), row('C')];
    const out = effectiveRows(
      rows,
      layout({ order: ['C', 'B', 'A'], hidden: { B: true } })
    );
    expect(out.map((r) => r.id)).toEqual(['C', 'A']);
  });

  it('honours an authored hidden default', () => {
    const rows = [row('A'), row('B', { hidden: true })];
    expect(effectiveRows(rows, emptyLayout()).map((r) => r.id)).toEqual(['A']);
  });

  it('lets a user reveal an author-hidden lane', () => {
    const rows = [row('A'), row('B', { hidden: true })];
    const out = effectiveRows(rows, layout({ hidden: { B: false } }));
    expect(out.map((r) => r.id)).toEqual(['A', 'B']);
  });
});

describe('visibleTracks', () => {
  const group = row('G', {
    tracks: [track('t1'), track('t2', true), track('t3')],
  });

  it('filters out an authored-hidden track by default', () => {
    expect(visibleTracks(group, emptyLayout()).map((t) => t.id)).toEqual([
      't1',
      't3',
    ]);
  });

  it('uses the ${groupId}-${trackId} key for user overrides', () => {
    // Reveal the author-hidden t2, hide the visible t1.
    const out = visibleTracks(
      group,
      layout({ hidden: { 'G-t2': false, 'G-t1': true } })
    );
    expect(out.map((t) => t.id)).toEqual(['t2', 't3']);
  });
});
