/**
 * `LoadResult.trackCoordinates` — what the sequence-bounds warning needs
 * about each authored track, handed to the component beside `data`.
 *
 * Pins which tracks get an entry (formatted files/URLs and inline data in
 * the author record contract; never `setTrackData()`, provider adapters, or
 * rendered-form inline payloads), that rows are taken before `filter:` and
 * numbered the way each decoder numbers them, and that nothing leaks into
 * the renderer payload.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { loadProtvistaData } from '../load-data.js';
import { createRegistry } from '../schema/registry.js';
import {
  normalizeConfig,
  type NormalizedConfig,
  type NormalizedTrack,
} from '../schema/normalize.js';
import type { ProtvistaViewerConfig, TrackConfig } from '../schema/types.js';
import '../protvista-uniprot.js';

type FetchOne = Parameters<typeof loadProtvistaData>[2];

const fetchFrom =
  (bodies: Record<string, unknown>): FetchOne =>
  async (url) =>
    bodies[url] ?? null;

const loadNormalized = (
  config: NormalizedConfig,
  bodies: Record<string, unknown> = {},
  custom: Record<string, unknown> = {}
) => {
  const r = createRegistry();
  return loadProtvistaData(
    'P05067',
    config,
    fetchFrom(bodies),
    (name) => r.getAdapter(name),
    custom
  );
};

const load = (
  config: ProtvistaViewerConfig,
  bodies: Record<string, unknown> = {},
  custom: Record<string, unknown> = {}
) =>
  loadNormalized(
    normalizeConfig(config, { registry: createRegistry() }),
    bodies,
    custom
  );

const group = (tracks: TrackConfig[]): ProtvistaViewerConfig => ({
  accession: 'P05067',
  rows: [{ id: 'G', tracks }],
});

const inline = (kind: string, inlineData: unknown, extra = {}) =>
  group([{ id: 't', kind, data: { from: 'inline', inlineData, ...extra } }]);

const CSV = 'type,start,end,description\nDOMAIN,1,10,a\nSITE,5,812,b\n';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadProtvistaData — trackCoordinates', () => {
  it("records every decoded CSV row before the track's filter:", async () => {
    const { trackCoordinates, data } = await load(
      group([
        { id: 't', kind: 'features', data: './hits.csv', filter: 'DOMAIN' },
      ]),
      { './hits.csv': CSV }
    );
    expect(trackCoordinates['G-t'].rows.map((r) => r.row)).toEqual([2, 3]);
    expect(data['G-t']).toHaveLength(1);
    expect((data['G-t'] as Array<{ type: string }>)[0].type).toBe('DOMAIN');
  });

  it("gives each track that shares a file the file's full row set", async () => {
    const { trackCoordinates } = await load(
      group([
        { id: 'a', kind: 'features', data: './hits.csv', filter: 'DOMAIN' },
        { id: 'b', kind: 'features', data: './hits.csv', filter: 'SITE' },
      ]),
      { './hits.csv': CSV }
    );
    expect(trackCoordinates['G-a'].rows).toHaveLength(2);
    expect(trackCoordinates['G-b'].rows).toHaveLength(2);
  });

  it('labels a file track with its substituted path and records the fetched url', async () => {
    const track: NormalizedTrack = {
      id: 'y',
      label: 'y',
      kind: 'features',
      component: 'nightingale-track-canvas',
      rendering: {},
      data: [
        {
          from: 'file',
          url: './{accession}.csv',
          format: 'csv',
          shape: 'feature',
        },
      ],
    };
    const config: NormalizedConfig = {
      version: '1.0',
      sources: {},
      defaults: { rendering: {} },
      rows: [
        {
          id: 'g',
          label: 'G',
          component: 'nightingale-track-canvas',
          rendering: {},
          tracks: [track],
        },
      ],
    };
    const { trackCoordinates } = await loadNormalized(config, {
      './P05067.csv': CSV,
    });
    const coords = trackCoordinates['g-y'];
    expect(coords.label).toBe('./P05067.csv (parsed as CSV)');
    expect(coords.url).toBe('./P05067.csv');
    expect(coords.shape).toBe('feature');
    expect(coords.format).toBe('csv');
  });

  it('numbers CSV rows the way the decoder does', async () => {
    const { trackCoordinates } = await load(
      group([{ id: 't', kind: 'features', data: './hits.csv' }]),
      { './hits.csv': 'type,start,end,description\nA,1,2,a\n\nB,3,4,b\n' }
    );
    expect(trackCoordinates['G-t'].rows.map((r) => r.row)).toEqual([2, 4]);
  });

  it('carries BED physical lines and shifted coordinates', async () => {
    const { trackCoordinates } = await load(
      group([{ id: 't', kind: 'features', data: './r.bed' }]),
      { './r.bed': 'track name=x\nchr1\t0\t812\n' }
    );
    expect(trackCoordinates['G-t'].rows).toEqual([
      {
        row: 2,
        fields: [
          ['start', 1],
          ['end', 812],
        ],
      },
    ]);
    expect(trackCoordinates['G-t'].format).toBe('bed');
  });

  it('numbers fetched JSON point rows by index', async () => {
    const { trackCoordinates } = await load(
      group([{ id: 't', kind: 'linegraph', data: './d.json' }]),
      {
        './d.json': [
          { position: 1, value: 2 },
          { position: 900, value: 3 },
        ],
      }
    );
    expect(trackCoordinates['G-t'].shape).toBe('point');
    expect(trackCoordinates['G-t'].rows).toEqual([
      { row: 0, fields: [['position', 1]] },
      { row: 1, fields: [['position', 900]] },
    ]);
  });

  it('reads inline feature arrays as authored', async () => {
    const { trackCoordinates } = await load(
      inline('features', [
        { type: 'A', begin: 0, end: 5 },
        { type: 'B', start: 3, end: 'x' },
        'junk',
      ])
    );
    const coords = trackCoordinates['G-t'];
    expect(coords.label).toBe('inline data (parsed as JSON)');
    expect(coords.url).toBeUndefined();
    expect(coords.rows).toEqual([
      {
        row: 0,
        fields: [
          ['start', 0],
          ['end', 5],
        ],
      },
      { row: 1, fields: [['start', 3]] },
      { row: 2, fields: [] },
    ]);
  });

  it('labels inline structured point records inline data (parsed as JSON)', async () => {
    const { trackCoordinates } = await load(
      inline('linegraph', [{ position: 5, value: 1 }])
    );
    expect(trackCoordinates['G-t'].label).toBe('inline data (parsed as JSON)');
    expect(trackCoordinates['G-t'].rows).toEqual([
      { row: 0, fields: [['position', 5]] },
    ]);
  });

  it('labels inline text by its format', async () => {
    const { trackCoordinates } = await load(
      inline('variants', 'position,variant\n9,K\n', { format: 'csv' })
    );
    expect(trackCoordinates['G-t'].label).toBe('inline data (parsed as CSV)');
    expect(trackCoordinates['G-t'].rows).toEqual([
      { row: 2, fields: [['position', 9]] },
    ]);
  });

  it('skips inline payloads already in rendered form', async () => {
    const variants = await load(
      inline('variants', { variants: [{ start: 1, end: 1, variant: 'K' }] })
    );
    expect(variants.trackCoordinates).not.toHaveProperty('G-t');
    const series = await load(
      inline('linegraph', [
        { name: 'v', range: [0, 1], values: [{ position: 900, value: 1 }] },
      ])
    );
    expect(series.trackCoordinates).not.toHaveProperty('G-t');
  });

  it('skips setTrackData() payloads', async () => {
    const { trackCoordinates } = await load(
      group([
        { id: 'p', kind: 'linegraph', data: { from: 'custom' } },
        { id: 'f', kind: 'features', data: { from: 'custom' } },
      ]),
      {},
      {
        'G-p': [{ position: 900, value: 1 }],
        'G-f': [{ type: 'A', start: 0, end: 900 }],
      }
    );
    expect(trackCoordinates).not.toHaveProperty('G-p');
    expect(trackCoordinates).not.toHaveProperty('G-f');
  });

  it('skips provider-adapter tracks', async () => {
    const { trackCoordinates } = await load(
      group([
        {
          id: 't',
          kind: 'features',
          data: {
            from: 'url',
            url: 'https://example.org/x.json',
            adapter: 'uniprot-features-json',
          },
        },
      ]),
      { 'https://example.org/x.json': { features: [] } }
    );
    expect(trackCoordinates).not.toHaveProperty('G-t');
  });

  it('records nothing for a track whose decoder throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { trackCoordinates, data } = await load(
      group([{ id: 't', kind: 'features', data: './hits.csv' }]),
      { './hits.csv': 'type,start,end,description\nDOMAIN,5,4,x\n' }
    );
    expect(trackCoordinates).not.toHaveProperty('G-t');
    expect(data['G-t']).toBeUndefined();
  });

  it('keeps row numbers out of the renderer payload', async () => {
    const { data } = await load(
      group([{ id: 't', kind: 'features', data: './hits.csv' }]),
      { './hits.csv': CSV }
    );
    const allowed = [
      'type',
      'start',
      'end',
      'description',
      'score',
      'tooltipContent',
    ];
    for (const item of data['G-t'] as object[]) {
      expect(item).not.toHaveProperty('row');
      for (const key of Object.keys(item)) expect(allowed).toContain(key);
    }
  });
});
