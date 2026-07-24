/**
 * Pure persistence logic (`src/layout-persistence.ts`): the config identity
 * used to key a saved layout, and the base64 codec for the shareable
 * `?layout=` URL parameter. The component's `localStorage` / URL glue is
 * covered end-to-end in the browser specs.
 */
import { describe, it, expect } from 'vitest';
import {
  configIdentity,
  storageKey,
  isDefaultLayout,
  encodeLayout,
  decodeLayout,
  STORAGE_PREFIX,
} from '../layout-persistence';
import { emptyLayout } from '../layout';
import type { NormalizedRow } from '../schema/normalize';

const track = (id: string) => ({ id }) as NormalizedRow['tracks'][number];
const row = (id: string, trackIds: string[] = []): NormalizedRow =>
  ({ id, tracks: trackIds.map(track) }) as NormalizedRow;

describe('configIdentity', () => {
  it('is stable across a reorder of the authored rows (keyed by the id set)', () => {
    const a = [row('A', ['t1']), row('B', ['t2'])];
    const b = [row('B', ['t2']), row('A', ['t1'])];
    expect(configIdentity(a)).toBe(configIdentity(b));
  });

  it('changes when a track is added or removed', () => {
    const base = [row('A', ['t1'])];
    const added = [row('A', ['t1', 't2'])];
    expect(configIdentity(base)).not.toBe(configIdentity(added));
  });

  it('produces a compact string key', () => {
    const id = configIdentity([row('A', ['t1'])]);
    expect(id).toMatch(/^[a-z0-9]+$/);
    expect(storageKey(id)).toBe(`${STORAGE_PREFIX}:${id}`);
  });
});

describe('isDefaultLayout', () => {
  it('is true only for the empty overlay', () => {
    expect(isDefaultLayout(emptyLayout())).toBe(true);
    expect(isDefaultLayout({ order: ['A'], hidden: {} })).toBe(false);
    expect(isDefaultLayout({ order: null, hidden: { A: true } })).toBe(false);
  });
});

describe('encodeLayout / decodeLayout', () => {
  it('round-trips an overlay', () => {
    const layout = { order: ['C', 'A', 'B'], hidden: { A: true, 'A-t2': false } };
    expect(decodeLayout(encodeLayout(layout))).toEqual(layout);
  });

  it('round-trips the empty overlay', () => {
    expect(decodeLayout(encodeLayout(emptyLayout()))).toEqual({
      order: null,
      hidden: {},
    });
  });

  it('returns null for a missing or malformed token', () => {
    expect(decodeLayout(null)).toBeNull();
    expect(decodeLayout('')).toBeNull();
    expect(decodeLayout('not-base64-$$$')).toBeNull();
    expect(decodeLayout(btoa('not json'))).toBeNull();
  });

  it('sanitizes a tampered payload (wrong types dropped)', () => {
    const token = btoa(
      JSON.stringify({ order: [1, 2], hidden: { A: true, B: 'yes', C: 1 } })
    );
    // Non-string order → null; only boolean hidden entries survive.
    expect(decodeLayout(token)).toEqual({ order: null, hidden: { A: true } });
  });
});
