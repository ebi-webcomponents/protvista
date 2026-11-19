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
  isRecord,
  boolMap,
  nestedBoolMap,
  STORAGE_PREFIX,
} from '../layout-persistence';
import { emptyPatch } from '../layout';
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

  it('does not confuse a hyphenated row id with a row+track pair', () => {
    // Row `x` with tracks `y`,`z` vs. row `x` with track `y` plus a separate
    // row `x-z`: a delimiter-joined identity blurs these into the same token
    // set and shares a saved layout across them. The JSON-encoded identity
    // keeps them distinct.
    const a = [row('x', ['y', 'z'])];
    const b = [row('x', ['y']), row('x-z', [])];
    expect(configIdentity(a)).not.toBe(configIdentity(b));
  });

  it('produces a compact string key', () => {
    const id = configIdentity([row('A', ['t1'])]);
    expect(id).toMatch(/^[a-z0-9]+$/);
    expect(storageKey(id)).toBe(`${STORAGE_PREFIX}:${id}`);
  });
});

describe('isDefaultLayout', () => {
  it('is true only for the empty patch (nothing to persist)', () => {
    expect(isDefaultLayout(emptyPatch())).toBe(true);
    expect(isDefaultLayout({ ...emptyPatch(), order: ['A'] })).toBe(false);
    expect(isDefaultLayout({ ...emptyPatch(), tracks: { A: ['t1'] } })).toBe(
      false
    );
    expect(
      isDefaultLayout({
        ...emptyPatch(),
        hidden: { rows: { A: true }, tracks: {} },
      })
    ).toBe(false);
    expect(
      isDefaultLayout({
        ...emptyPatch(),
        hidden: { rows: {}, tracks: { A: { t1: true } } },
      })
    ).toBe(false);
  });
});

describe('encodeLayout / decodeLayout', () => {
  it('round-trips a patch across all three fields', () => {
    const patch = {
      order: ['C', 'A', 'B'],
      tracks: { A: ['t2', 't1'] },
      hidden: { rows: { A: true }, tracks: { A: { t2: false } } },
    };
    expect(decodeLayout(encodeLayout(patch))).toEqual(patch);
  });

  it('round-trips the empty patch', () => {
    expect(decodeLayout(encodeLayout(emptyPatch()))).toEqual(emptyPatch());
  });

  it('round-trips non-ASCII ids without mangling them', () => {
    const patch = { ...emptyPatch(), order: ['α', '中文'] };
    expect(decodeLayout(encodeLayout(patch))).toEqual(patch);
  });

  it('returns null for a missing or malformed token', () => {
    expect(decodeLayout(null)).toBeNull();
    expect(decodeLayout('')).toBeNull();
    expect(decodeLayout('not-base64-$$$')).toBeNull();
    expect(decodeLayout(btoa('not json'))).toBeNull();
  });

  // A hand-edited URL or a stale storage entry must never throw or inject a
  // wrong-typed patch; bad entries are dropped one by one so a single bad key
  // does not discard an otherwise good layout.
  it('sanitizes a tampered payload (wrong types dropped)', () => {
    const token = btoa(
      JSON.stringify({
        order: [1, 2],
        tracks: { A: ['t1'], B: 'nope' },
        hidden: {
          rows: { A: true, B: 'yes' },
          tracks: { A: { t2: false, t3: 1 }, C: 'nope' },
        },
      })
    );
    expect(decodeLayout(token)).toEqual({
      order: null,
      tracks: { A: ['t1'] },
      hidden: { rows: { A: true }, tracks: { A: { t2: false } } },
    });
  });

  it('ignores a legacy flat hidden map rather than misreading it', () => {
    // Pre-nesting tokens keyed row and track hides in one flat map. A stale
    // shared link like that must decode to "no visibility overrides", not
    // throw or smuggle the old keys into the new shape.
    const token = btoa(
      JSON.stringify({ order: null, tracks: {}, hidden: { A: true } })
    );
    expect(decodeLayout(token)).toEqual({
      order: null,
      tracks: {},
      hidden: { rows: {}, tracks: {} },
    });
  });

  // An older or hand-written token may carry no `hidden` at all, or a null /
  // non-object one; reading `.rows` off it would throw outside the try/catch.
  it.each([
    ['{"order":["A"]}', ['A']],
    ['{"order":null,"hidden":"x"}', null],
    ['{"order":null,"hidden":null}', null],
  ])(
    'treats a missing or non-object hidden in %s as no overrides, without throwing',
    (json, order) => {
      expect(decodeLayout(btoa(json))).toEqual({
        order,
        tracks: {},
        hidden: { rows: {}, tracks: {} },
      });
    }
  );
});

// The untrusted-JSON guards `decodeLayout` is built from. The layout token
// comes from `localStorage` / the URL, so these treat their input as
// attacker-controlled.
describe('isRecord', () => {
  it('accepts any non-null object, arrays included', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(true);
  });

  it('rejects null and primitives', () => {
    for (const v of [null, undefined, 0, 1, '', 'x', true, false]) {
      expect(isRecord(v)).toBe(false);
    }
  });
});

describe('boolMap', () => {
  it('keeps boolean entries and drops every other type', () => {
    expect(
      boolMap({ a: true, b: false, c: 'yes', d: 1, e: null, f: {} })
    ).toEqual({ a: true, b: false });
  });

  it('is empty for a non-object', () => {
    for (const v of [null, undefined, 'nope', 1, true]) {
      expect(boolMap(v)).toEqual({});
    }
  });

  it('returns a prototype-less map, so a __proto__ key stays an own key', () => {
    const map = boolMap(
      JSON.parse('{"__proto__": true, "constructor": false}')
    );
    expect(Object.getPrototypeOf(map)).toBeNull();
    expect(Object.keys(map)).toEqual(['__proto__', 'constructor']);
    expect(map['__proto__']).toBe(true);
    expect(({} as Record<string, unknown>).constructor).toBe(Object);
  });
});

describe('nestedBoolMap', () => {
  it('keeps boolean leaves under object rows', () => {
    expect(
      nestedBoolMap({ A: { t1: true, t2: 'no' }, B: { t3: false } })
    ).toEqual({ A: { t1: true }, B: { t3: false } });
  });

  it('drops rows that are not objects or hold no boolean entries', () => {
    expect(
      nestedBoolMap({
        A: 'nope',
        B: null,
        C: { t1: 1 },
        D: {},
        E: { t2: true },
      })
    ).toEqual({ E: { t2: true } });
  });

  it('is empty for a non-object', () => {
    expect(nestedBoolMap(null)).toEqual({});
    expect(nestedBoolMap('nope')).toEqual({});
  });

  it('returns prototype-less maps at both levels', () => {
    const map = nestedBoolMap(JSON.parse('{"__proto__": {"__proto__": true}}'));
    expect(Object.getPrototypeOf(map)).toBeNull();
    expect(Object.keys(map)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(map['__proto__'])).toBeNull();
    expect(Object.keys(map['__proto__'])).toEqual(['__proto__']);
  });
});

describe('decodeLayout (prototype safety)', () => {
  it('keeps __proto__ ids as own keys without polluting any prototype', () => {
    const token = btoa(
      '{"order":null,"tracks":{"__proto__":["t1"]},' +
        '"hidden":{"rows":{"__proto__":true},' +
        '"tracks":{"__proto__":{"polluted":true}}}}'
    );
    const patch = decodeLayout(token)!;
    expect(Object.getPrototypeOf(patch.tracks)).toBeNull();
    expect(Object.getPrototypeOf(patch.hidden.rows)).toBeNull();
    expect(Object.getPrototypeOf(patch.hidden.tracks)).toBeNull();
    expect(Object.keys(patch.tracks)).toEqual(['__proto__']);
    expect(patch.tracks['__proto__']).toEqual(['t1']);
    expect(patch.hidden.rows['__proto__']).toBe(true);
    expect(patch.hidden.tracks['__proto__']).toEqual({ polluted: true });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('returns null for a non-object payload', () => {
    expect(decodeLayout(btoa('null'))).toBeNull();
    expect(decodeLayout(btoa('42'))).toBeNull();
    expect(decodeLayout(btoa('"str"'))).toBeNull();
  });
});
