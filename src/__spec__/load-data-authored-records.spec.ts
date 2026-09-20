/**
 * The author-supplied record contract, across all three transports.
 *
 * A track's records are the same records whether they arrive over the network,
 * inline in the config, or through `setTrackData()`. Before this was true,
 * `from: inline` ran the record adapter only for the `linegraph` family and
 * `from: custom` never ran it at all, so a consumer following the published
 * `{ position, value }` contract got a `TypeError` out of the component — and
 * because the assignment walk was un-guarded, every track iterated after it
 * lost its data too.
 *
 * Pins, in order: the wrapping/non-wrapping split the rule is derived from,
 * the three transports agreeing, the pass-through for payloads already in the
 * renderer's representation, and the blast-radius containment.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { loadProtvistaData } from '../load-data.js';
import { createRegistry } from '../schema/registry.js';
import { normalizeConfig } from '../schema/normalize.js';
import {
  WRAPPING_RECORD_ADAPTERS,
  recordAdapterForKind,
  KIND_ADAPTER_VARIANTS,
  BYO_KIND_BASE_ADAPTERS,
} from '../schema/file-formats.js';
import type { ProtvistaViewerConfig } from '../schema/types.js';
import '../protvista-uniprot.js';

const registry = () => createRegistry();
const noFetch = async () => null;

const load = (config: ProtvistaViewerConfig) => {
  const r = registry();
  return loadProtvistaData(
    'P05067',
    normalizeConfig(config, { registry: r }),
    noFetch,
    (name) => r.getAdapter(name),
    {}
  );
};

const inlineConfig = (
  kind: string,
  inlineData: unknown
): ProtvistaViewerConfig => ({
  accession: 'P05067',
  rows: [
    {
      id: 'G',
      tracks: [{ id: 't', kind, data: { from: 'inline', inlineData } }],
    },
  ],
});

const customConfig = (kind: string): ProtvistaViewerConfig => ({
  accession: 'P05067',
  rows: [{ id: 'G', tracks: [{ id: 't', kind, data: { from: 'custom' } }] }],
});

const loadCustom = (kind: string, payload: unknown) => {
  const r = registry();
  return loadProtvistaData(
    'P05067',
    normalizeConfig(customConfig(kind), { registry: r }),
    noFetch,
    (name) => r.getAdapter(name),
    { 'G-t': payload }
  );
};

describe('WRAPPING_RECORD_ADAPTERS reflects what the adapters actually do', () => {
  // The whole rule rests on this split, and it is the kind of fact that rots
  // silently: an adapter changed from wrapping to pass-through (or a new
  // family added without thinking about it) would leave the set asserting
  // something no longer true, and the symptom would be a blank track.
  const POINTS = [{ position: 1, value: 2 }];
  const VARIATIONS = [{ position: 1, variant: 'K' }];
  const FEATURES = [{ type: 'DOMAIN', start: 1, end: 9 }];

  it.each([
    ['linegraph', POINTS],
    ['variation', VARIATIONS],
    ['features-json', FEATURES],
  ])('%s wraps iff it is listed as wrapping', async (name, records) => {
    const out = await registry().getAdapter(name)!(records);
    // "Wrapping" means: the output is not simply the records back again.
    const wrapped = !(
      Array.isArray(out) &&
      out.length === records.length &&
      out.every((item, i) => {
        const source = records[i] as Record<string, unknown>;
        return Object.keys(source).every(
          (k) => (item as Record<string, unknown>)?.[k] === source[k]
        );
      })
    );
    expect(wrapped, `${name} wrapping mismatch`).toBe(
      WRAPPING_RECORD_ADAPTERS.has(name)
    );
  });

  it('every wrapping adapter is reachable as some kind’s record adapter', () => {
    const reachable = new Set(
      [
        ...BYO_KIND_BASE_ADAPTERS,
        ...Object.keys(KIND_ADAPTER_VARIANTS).flatMap((base) => [
          base,
          ...Object.values(KIND_ADAPTER_VARIANTS[base]),
        ]),
      ]
        .map((a) => recordAdapterForKind(a))
        .filter(Boolean)
    );
    for (const name of WRAPPING_RECORD_ADAPTERS) {
      expect(reachable.has(name), `${name} is listed but unreachable`).toBe(
        true
      );
    }
  });
});

describe('inline and custom run the kind’s record adapter', () => {
  const series = (payload: unknown) =>
    (payload as Array<{ values: unknown[] }>)[0];

  it.each([
    ['variant-counts'],
    ['rna-editing-counts'],
    ['linegraph'],
  ])('%s: inline point records become a drawn series', async (kind) => {
    const { data } = await load(inlineConfig(kind, [{ position: 1, value: 412 }]));
    expect(series(data['G-t']).values).toEqual([{ position: 1, value: 412 }]);
    expect(series(data['G-t'])).toHaveProperty('range');
  });

  it.each([['variants'], ['rna-editing']])(
    '%s: inline variation records become a variants payload',
    async (kind) => {
      const { data } = await load(
        inlineConfig(kind, [{ position: 42, variant: 'K', wildType: 'E' }])
      );
      const payload = data['G-t'] as { variants: Array<{ start: number }> };
      expect(payload.variants).toHaveLength(1);
      expect(payload.variants[0].start).toBe(42);
    }
  );

  it('custom point records become a drawn series too', async () => {
    // The exact call the published contract invites:
    //   setTrackData('G-t', [{ position: 1, value: 412 }])
    const { data } = await loadCustom('linegraph', [
      { position: 1, value: 412 },
    ]);
    expect(series(data['G-t']).values).toEqual([{ position: 1, value: 412 }]);
  });

  it('custom variation records become a variants payload', async () => {
    const { data } = await loadCustom('variants', [
      { position: 7, variant: '*' },
    ]);
    expect((data['G-t'] as { variants: unknown[] }).variants).toHaveLength(1);
  });

  it('reports hasData for an inline record payload', async () => {
    // The empty-state gate must see through the wrapper, or a viewer built
    // solely from inline records parses correctly and still blanks out.
    const { hasData } = await load(
      inlineConfig('variants', [{ position: 1, variant: 'K' }])
    );
    expect(hasData).toBe(true);
  });

  it('surfaces a malformed inline record as a named error, not a blank track', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { data } = await load(
      inlineConfig('linegraph', [{ position: 1, value: '412' }])
    );
    expect(data['G-t']).toBeUndefined();
    expect(warn.mock.calls.flat().join(' ')).toMatch(
      /row 0: .*'value' is a string, not a number/
    );
  });
});

describe('payloads that need no adapting are left alone', () => {
  it('passes through data already in the renderer’s representation', async () => {
    // `setTrackData()`'s originally documented contract: inject exactly what
    // the component renders. Still honoured — the two shapes are disjoint.
    const rendered = [
      { name: 'value', color: '#3d4451', range: [0, 5], values: [{ position: 1, value: 5 }] },
    ];
    const { data } = await loadCustom('linegraph', rendered);
    // `toMatchObject`, not `toEqual`: the tooltip resolver annotates every
    // payload it can, pass-through included. What matters is that the series
    // was not re-wrapped or re-validated as records.
    expect(data['G-t']).toMatchObject([
      { name: 'value', range: [0, 5], values: [{ position: 1, value: 5 }] },
    ]);
  });

  it('passes through a rendered variation payload', async () => {
    const rendered = { sequence: 'MMM', variants: [{ start: 1, variant: 'K' }] };
    const { data } = await loadCustom('variants', rendered);
    expect(data['G-t']).toMatchObject({ sequence: 'MMM' });
  });

  it('does not run features-json over inline feature records', async () => {
    // Feature records are already the renderer's representation, so routing
    // them through the adapter would only strip fields — including any a
    // `dataTooltip` path references. `notes` must survive.
    const { data } = await load(
      inlineConfig('features', [
        { type: 'DOMAIN', start: 1, end: 9, notes: 'keep me' },
      ])
    );
    expect((data['G-t'] as Array<{ notes?: string }>)[0].notes).toBe('keep me');
  });

  it('leaves a provider-only kind’s custom payload untouched', async () => {
    const payload = [{ anything: true }];
    const { data } = await loadCustom('alphafold-confidence', payload);
    expect(data['G-t']).toMatchObject([{ anything: true }]);
  });
});

describe('a track that cannot render its data does not take the others down', () => {
  afterEach(() => vi.restoreAllMocks());

  it('contains a throwing data setter to the one track', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = document.createElement('protvista-uniprot') as never as {
      _assignComponentData: (e: unknown, p: unknown, k: string) => void;
    };
    const exploding = {
      set data(_v: unknown) {
        throw new TypeError('undefined is not iterable');
      },
    };
    const received: unknown[] = [];
    const healthy = {
      set data(v: unknown) {
        received.push(v);
      },
    };

    el._assignComponentData(exploding, [{ position: 1 }], 'G-bad');
    el._assignComponentData(healthy, [{ position: 2 }], 'G-good');

    // The healthy track still got its data — the walk was not aborted.
    expect(received).toEqual([[{ position: 2 }]]);
    expect(error.mock.calls.flat().join(' ')).toContain("track 'G-bad'");
  });
});
