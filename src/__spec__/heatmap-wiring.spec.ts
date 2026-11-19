/**
 * A heatmap track draws in any row.
 *
 * `<nightingale-sequence-heatmap>` ignores `.data`: the push walk
 * (`_loadDataInComponents`) hands it its cells through `setHeatmapData` and
 * its colours through `heatmapInstance.setColor`. That wiring used to run only
 * for a group whose id was `ALPHAMISSENSE_PATHOGENICITY`, fed the first
 * heatmap in the viewer whatever data it found, and threw on a heatmap with no
 * array to read. It now follows the track: any `alphamissense-heatmap` (or
 * `nightingale-sequence-heatmap`) track, grouped or standalone, gets its own
 * data, coloured by its resolved `colorScale`.
 *
 * The element is never connected, so `_init()` never fetches: the spec
 * defines the track tags itself, sets the loaded state, renders into the
 * element and runs the walk. The heatmap stub (`nightingale-mocks.ts`)
 * records each `setHeatmapData` call and the colour function it was given.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from 'lit';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import '../protvista-uniprot.js';
import { RENDERABLE_COMPONENTS } from '../built-in-components.js';
import { loadComponent } from '../utils/index.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import { createRegistry } from '../schema/registry.js';
import type { Registry } from '../schema/registry.js';
import { loadConfig } from '../schema/load.js';
import { normalizeConfig } from '../schema/normalize.js';
import { validateConfig } from '../schema/validate.js';
import type { NormalizedConfig } from '../schema/normalize.js';
import type { ColorStop, ProtvistaViewerConfig } from '../schema/types.js';

type HeatmapStub = HTMLElement & {
  heatmapCalls: Array<{
    xDomain: number[];
    yDomain: string[];
    data: unknown[];
  }>;
  colorFn?: (d: { score: number }) => string;
};

type El = HTMLElement & {
  config: NormalizedConfig;
  sequence: string;
  data: Record<string, unknown>;
  openGroups: string[];
  loading: boolean;
  hasData: boolean;
  displayCoordinates: { start?: number; end?: number };
  _trackErrors: Map<string, { kind: string }>;
  render(): unknown;
  _loadDataInComponents(): Promise<void>;
};

// Normally defined by the connected element's registration walk.
for (const [name, ctor] of RENDERABLE_COMPONENTS) loadComponent(name, ctor);

const SEQUENCE = 'MSEQ';

const cells = (yValues: string[], score: number) =>
  yValues.flatMap((yValue) =>
    [1, 2, 3, 4].map((xValue) => ({ xValue, yValue, score }))
  );

const heatmapTrack = (id: string) => ({
  id,
  kind: 'alphamissense-heatmap' as const,
  data: 'https://example.org/am.json',
});

const featureTrack = (id: string) => ({
  id,
  kind: 'features' as const,
  data: 'https://example.org/features.json',
});

const normalize = (config: ProtvistaViewerConfig) =>
  normalizeConfig(config, { registry: createRegistry() });

afterEach(() => {
  vi.restoreAllMocks();
});

/** Loaded, rendered (into itself) and walked once. */
async function mount(
  config: NormalizedConfig,
  data: Record<string, unknown>,
  openGroups: string[] = config.rows.map((r) => r.id)
): Promise<El> {
  const el = document.createElement('protvista-uniprot') as unknown as El;
  el.config = config;
  el.sequence = SEQUENCE;
  el.loading = false;
  el.hasData = true;
  el.openGroups = openGroups;
  el.displayCoordinates = { start: 1, end: SEQUENCE.length };
  el.data = data;
  render(el.render(), el);
  await el._loadDataInComponents();
  return el;
}

const heatmap = (el: El, key: string) =>
  el.querySelector(`#${CSS_PREFIX}-track-${key}`) as HeatmapStub;

/** The most recent `setHeatmapData` call a heatmap received. */
const lastCall = (hm: HeatmapStub) =>
  hm.heatmapCalls[hm.heatmapCalls.length - 1];

describe('heatmap wiring follows the track, not the group id', () => {
  it('wires a heatmap in a group with a custom id', async () => {
    const config = normalize({
      rows: [
        {
          id: 'MY_AM',
          tracks: [featureTrack('f'), heatmapTrack('hm')],
        },
      ],
    });
    const hmData = cells(['A', 'C'], 0.9);
    const el = await mount(config, {
      MY_AM: [{ type: 'DOMAIN', start: 1, end: 2 }],
      'MY_AM-f': [{ type: 'DOMAIN', start: 1, end: 2 }],
      'MY_AM-hm': hmData,
    });

    const calls = heatmap(el, 'MY_AM-hm').heatmapCalls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1]).toEqual({
      xDomain: [1, 2, 3, 4],
      yDomain: ['A', 'C'],
      data: hmData,
    });
  });

  it('wires a standalone heatmap row', async () => {
    const config = normalize({ rows: [heatmapTrack('hm')] });
    const row = config.rows[0];
    const key = `${row.id}-${row.tracks[0].id}`;
    const hmData = cells(['A'], 0.1);
    const el = await mount(config, { [key]: hmData }, []);

    expect(lastCall(heatmap(el, key))?.data).toBe(hmData);
  });

  it('gives two heatmaps their own data and their own heatmap-id', async () => {
    const config = normalize({
      rows: [
        { id: 'G1', tracks: [featureTrack('f'), heatmapTrack('hm')] },
        { id: 'G2', tracks: [featureTrack('f'), heatmapTrack('hm')] },
      ],
    });
    const one = cells(['A'], 0.2);
    const two = cells(['W', 'Y'], 0.8);
    const el = await mount(config, {
      G1: [{ type: 'DOMAIN', start: 1, end: 2 }],
      'G1-f': [{ type: 'DOMAIN', start: 1, end: 2 }],
      'G1-hm': one,
      G2: [{ type: 'DOMAIN', start: 1, end: 2 }],
      'G2-f': [{ type: 'DOMAIN', start: 1, end: 2 }],
      'G2-hm': two,
    });

    const first = heatmap(el, 'G1-hm');
    const second = heatmap(el, 'G2-hm');
    // Both are fed, not only the last heatmap in the viewer (`every` alone
    // holds for a heatmap that got no call at all).
    expect(first.heatmapCalls.length).toBeGreaterThan(0);
    expect(second.heatmapCalls.length).toBeGreaterThan(0);
    expect(first.heatmapCalls.every((c) => c.data === one)).toBe(true);
    expect(second.heatmapCalls.every((c) => c.data === two)).toBe(true);
    expect(lastCall(first)?.yDomain).toEqual(['A']);
    expect(lastCall(second)?.yDomain).toEqual(['W', 'Y']);

    const ids = [first, second].map((h) => h.getAttribute('heatmap-id'));
    expect(new Set(ids).size).toBe(2);
  });

  it('skips a heatmap with no data without throwing, and still feeds the other tracks', async () => {
    const config = normalize({
      rows: [{ id: 'G', tracks: [heatmapTrack('hm'), featureTrack('f')] }],
    });
    const features = [{ type: 'DOMAIN', start: 1, end: 2 }];
    const el = await mount(config, {
      G: features,
      'G-hm': cells(['A'], 0.5),
      'G-f': features,
    });
    // The data goes away after the heatmap rendered (as a setTrackData
    // clear or a layout rebuild can do): the walk must not throw.
    el.data = { ...el.data, 'G-hm': undefined };
    const f = el.querySelector(`#${CSS_PREFIX}-track-G-f`) as HTMLElement & {
      data?: unknown;
    };
    f.data = undefined;

    await expect(el._loadDataInComponents()).resolves.toBeUndefined();
    expect(f.data).toBe(features);
    expect(el._trackErrors.has('G-hm')).toBe(false);
  });

  it('reports a heatmap whose data is not an array, and still feeds the other tracks', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const config = normalize({
      rows: [{ id: 'G', tracks: [heatmapTrack('hm'), featureTrack('f')] }],
    });
    const features = [{ type: 'DOMAIN', start: 1, end: 2 }];
    const events: CustomEvent[] = [];
    const el = document.createElement('protvista-uniprot') as unknown as El;
    el.addEventListener('protvista-error', (e) =>
      events.push(e as CustomEvent)
    );
    el.config = config;
    el.sequence = SEQUENCE;
    el.loading = false;
    el.hasData = true;
    el.openGroups = ['G'];
    el.displayCoordinates = { start: 1, end: SEQUENCE.length };
    el.data = { G: features, 'G-hm': { not: 'cells' }, 'G-f': features };
    render(el.render(), el);

    await expect(el._loadDataInComponents()).resolves.toBeUndefined();

    expect(heatmap(el, 'G-hm').heatmapCalls).toEqual([]);
    expect(el._trackErrors.get('G-hm')?.kind).toBe('render');
    const f = el.querySelector(`#${CSS_PREFIX}-track-G-f`) as HTMLElement & {
      data?: unknown;
    };
    expect(f.data).toBe(features);

    // Re-running the walk (an expand, a layout edit) does not report again.
    await el._loadDataInComponents();
    const renderEvents = events.filter(
      (e) => e.detail.context?.errorKind === 'render'
    );
    expect(renderEvents).toHaveLength(1);
  });
});

describe('heatmap colours come from the track colorScale', () => {
  it('colours an alphamissense-heatmap with the alphamissense-ramp', async () => {
    const config = normalize({ rows: [heatmapTrack('hm')] });
    const row = config.rows[0];
    const key = `${row.id}-${row.tracks[0].id}`;
    const el = await mount(config, { [key]: cells(['A'], 0.5) }, []);
    const hm = heatmap(el, key);
    await vi.waitFor(() => expect(hm.colorFn).toBeDefined());

    // The values the d3 `amColorScale` the heatmap used before returns.
    expect(hm.colorFn!({ score: 0 })).toBe('rgb(33, 102, 172)');
    expect(hm.colorFn!({ score: 0.5 })).toBe('rgb(230, 219, 212)');
    expect(hm.colorFn!({ score: 1 })).toBe('rgb(178, 24, 43)');
  });

  it('colours a heatmap with explicit colorScale stops', async () => {
    const config = normalize({
      rows: [
        {
          ...heatmapTrack('hm'),
          rendering: {
            colorScale: {
              stops: [
                { value: 0, color: '#000000' },
                { value: 1, color: '#ffffff' },
              ],
            },
          },
        },
      ],
    });
    const row = config.rows[0];
    const key = `${row.id}-${row.tracks[0].id}`;
    const el = await mount(config, { [key]: cells(['A'], 0.5) }, []);
    const hm = heatmap(el, key);
    await vi.waitFor(() => expect(hm.colorFn).toBeDefined());

    expect(hm.colorFn!({ score: 0.5 })).toBe('rgb(128, 128, 128)');
  });

  it('draws the shipped AlphaMissense heatmap as before', async () => {
    const yaml = readFileSync(
      resolve(process.cwd(), 'src/default-config.yaml'),
      'utf8'
    );
    const config = await loadConfig(yaml, { accession: 'P05067' });
    const group = config.rows.find(
      (r) => r.id === 'ALPHAMISSENSE_PATHOGENICITY'
    )!;
    const track = group.tracks.find((t) => t.kind === 'alphamissense-heatmap')!;
    const key = `${group.id}-${track.id}`;
    const hmData = cells(['A', 'C'], 0.25);
    const el = await mount(
      config,
      {
        [group.id]: [{ start: 1, end: 4, score: 0.3 }],
        [`${group.id}-alphamissense_pathogenicity`]: [
          { start: 1, end: 4, score: 0.3 },
        ],
        [key]: hmData,
      },
      [group.id]
    );
    const hm = heatmap(el, key);

    expect(lastCall(hm)?.data).toBe(hmData);
    await vi.waitFor(() => expect(hm.colorFn).toBeDefined());
    expect(hm.colorFn!({ score: 0.75 })).toBe('rgb(229, 147, 116)');
    expect(hm.colorFn!({ score: 0.9 })).toBe('rgb(201, 75, 66)');
  });
});

describe('heatmap-id is unique per track and a valid selector', () => {
  /** The heatmap-id of each per-track heatmap (not the group aggregates). */
  const heatmapIds = (config: ProtvistaViewerConfig): string[] => {
    const normalized = normalize(config);
    const el = document.createElement('protvista-uniprot') as unknown as El;
    el.config = normalized;
    el.sequence = SEQUENCE;
    el.loading = false;
    el.hasData = true;
    el.openGroups = normalized.rows.map((r) => r.id);
    el.displayCoordinates = { start: 1, end: SEQUENCE.length };
    const data: Record<string, unknown> = {};
    for (const row of normalized.rows) {
      data[row.id] = [{ type: 'DOMAIN', start: 1, end: 2 }];
      for (const t of row.tracks) data[`${row.id}-${t.id}`] = cells(['A'], 0.5);
    }
    el.data = data;
    render(el.render(), el);
    return normalized.rows.flatMap((row) =>
      row.tracks.map((t) => {
        const hm = [
          ...el.querySelectorAll('nightingale-sequence-heatmap'),
        ].find((h) => h.id === `${CSS_PREFIX}-track-${row.id}-${t.id}`);
        expect(hm, `heatmap for ${row.id}-${t.id}`).toBeDefined();
        return hm!.getAttribute('heatmap-id') ?? '';
      })
    );
  };

  const expectDistinctSelectors = (ids: string[]) => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      // heatmap-component looks its div up with `d3.select('#' + id)`.
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(() => document.querySelector(`#${id}`)).not.toThrow();
    }
  };

  it('keeps track ids that differ only in a replaced character apart', () => {
    expectDistinctSelectors(
      heatmapIds({
        rows: [
          { id: 'G', tracks: [heatmapTrack('am.v1'), heatmapTrack('am_v1')] },
        ],
      })
    );
  });

  it('keeps non-ASCII track ids apart', () => {
    expectDistinctSelectors(
      heatmapIds({
        rows: [
          { id: 'G', tracks: [heatmapTrack('hm-α'), heatmapTrack('hm-β')] },
        ],
      })
    );
  });

  it('keeps row ids that differ only in a replaced character apart', () => {
    expectDistinctSelectors(
      heatmapIds({
        rows: [
          { id: 'G.1', tracks: [heatmapTrack('hm')] },
          { id: 'G_1', tracks: [heatmapTrack('hm')] },
        ],
      })
    );
  });

  it('gives an id with a colon or a space a usable selector', () => {
    expectDistinctSelectors(
      heatmapIds({
        rows: [
          { id: 'AM v1', tracks: [heatmapTrack('a:b'), heatmapTrack('a b')] },
        ],
      })
    );
  });
});

describe('a heatmap matched by component alone', () => {
  const rawHeatmap = (id: string, rendering?: Record<string, unknown>) => ({
    id,
    component: 'nightingale-sequence-heatmap' as const,
    data: 'https://example.org/am.json',
    ...(rendering ? { rendering } : {}),
  });

  it('is wired in a custom group and keeps the component colouring', async () => {
    const config = normalize({
      rows: [{ id: 'G', tracks: [featureTrack('f'), rawHeatmap('hm')] }],
    });
    expect(config.rows[0].tracks[1].kind).not.toBe('alphamissense-heatmap');
    const hmData = cells(['A', 'C'], 0.4);
    const features = [{ type: 'DOMAIN', start: 1, end: 2 }];
    const el = await mount(config, {
      G: features,
      'G-f': features,
      'G-hm': hmData,
    });
    const hm = heatmap(el, 'G-hm');

    expect(hm.heatmapCalls.length).toBeGreaterThan(0);
    expect(lastCall(hm)).toEqual({
      xDomain: [1, 2, 3, 4],
      yDomain: ['A', 'C'],
      data: hmData,
    });
    await new Promise((r) => setTimeout(r, 0));
    // No colorScale: the component's own colouring stays.
    expect(hm.colorFn).toBeUndefined();
    expect(el._trackErrors.has('G-hm')).toBe(false);
  });

  it('is wired in a standalone row', async () => {
    const config = normalize({ rows: [rawHeatmap('hm')] });
    const row = config.rows[0];
    const key = `${row.id}-${row.tracks[0].id}`;
    const hmData = cells(['A'], 0.1);
    const el = await mount(config, { [key]: hmData }, []);
    const hm = heatmap(el, key);

    expect(hm.heatmapCalls.length).toBeGreaterThan(0);
    expect(lastCall(hm)?.data).toBe(hmData);
    await new Promise((r) => setTimeout(r, 0));
    expect(hm.colorFn).toBeUndefined();
  });

  it('is coloured from its own colorScale', async () => {
    const config = normalize({
      rows: [
        {
          id: 'X',
          tracks: [
            rawHeatmap('hm', { colorScale: { theme: 'alphamissense-ramp' } }),
          ],
        },
      ],
    });
    const el = await mount(config, { 'X-hm': cells(['A'], 0.5) });
    const hm = heatmap(el, 'X-hm');
    await vi.waitFor(() => expect(hm.colorFn).toBeDefined());
    expect(hm.colorFn!({ score: 0.5 })).toBe('rgb(230, 219, 212)');
  });
});

describe('an alphamissense-heatmap whose component is overridden', () => {
  for (const component of [
    'nightingale-track-canvas',
    'nightingale-colored-sequence',
  ] as const) {
    it(`to ${component} takes its data through .data with no render error`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const config = normalize({
        rows: [
          {
            id: 'G',
            tracks: [featureTrack('f'), { ...heatmapTrack('hm'), component }],
          },
        ],
      });
      const track = config.rows[0].tracks[1];
      expect(track.kind).toBe('alphamissense-heatmap');
      expect(track.component).toBe(component);
      const payload = [{ xValue: 1, yValue: 'A', score: 0.5 }];
      const features = [{ type: 'DOMAIN', start: 1, end: 2 }];
      const el = await mount(config, {
        G: features,
        'G-f': features,
        'G-hm': payload,
      });

      const element = el.querySelector(`#${CSS_PREFIX}-track-G-hm`) as
        (HTMLElement & { data?: unknown }) | null;
      expect(element?.tagName.toLowerCase()).toBe(component);
      expect(element?.data).toBe(payload);
      expect(el._trackErrors.has('G-hm')).toBe(false);
    });
  }
});

describe('a theme registered through element.registerTheme()', () => {
  it('colours a heatmap', async () => {
    const el = document.createElement('protvista-uniprot') as unknown as El & {
      registry: Registry;
      registerTheme(name: string, stops: ColorStop[]): void;
    };
    el.registerTheme('mine', [
      { value: 0, color: '#ff0000' },
      { value: 1, color: '#0000ff' },
    ]);
    const config = normalizeConfig(
      {
        rows: [
          {
            ...heatmapTrack('hm'),
            rendering: { colorScale: { theme: 'mine' } },
          },
        ],
      },
      { registry: el.registry }
    );
    const row = config.rows[0];
    const key = `${row.id}-${row.tracks[0].id}`;
    el.config = config;
    el.sequence = SEQUENCE;
    el.loading = false;
    el.hasData = true;
    el.openGroups = [];
    el.displayCoordinates = { start: 1, end: SEQUENCE.length };
    el.data = { [key]: cells(['A'], 0.5) };
    render(el.render(), el);
    await el._loadDataInComponents();
    const hm = heatmap(el, key);

    expect(hm.heatmapCalls.length).toBeGreaterThan(0);
    await vi.waitFor(() => expect(hm.colorFn).toBeDefined());
    expect(hm.colorFn!({ score: 0.5 })).toBe('rgb(128, 0, 128)');
  });
});

describe('a grouped heatmap is drawn once per walk', () => {
  it('calls setHeatmapData and setColor once, though two loops hand it over', async () => {
    const config = normalize({
      rows: [{ id: 'G', tracks: [featureTrack('f'), heatmapTrack('hm')] }],
    });
    const features = [{ type: 'DOMAIN', start: 1, end: 2 }];
    // The loader's key order (load-data.ts): each track's key, then the
    // group aggregate. The walk reaches `G-hm` by its own key first (a new
    // payload), then again from group G's track loop.
    const data: Record<string, unknown> = {};
    data['G-f'] = features;
    data['G-hm'] = cells(['A', 'C'], 0.9);
    data['G'] = features;

    const el = document.createElement('protvista-uniprot') as unknown as El;
    el.config = config;
    el.sequence = SEQUENCE;
    el.loading = false;
    el.hasData = true;
    el.openGroups = ['G'];
    el.displayCoordinates = { start: 1, end: SEQUENCE.length };
    el.data = data;
    render(el.render(), el);
    const hm = heatmap(el, 'G-hm') as HeatmapStub & {
      heatmapInstance: { setColor: (fn: unknown) => void };
    };
    const setColor = vi.spyOn(hm.heatmapInstance, 'setColor');

    await el._loadDataInComponents();
    await new Promise((r) => setTimeout(r, 0));
    expect(hm.heatmapCalls).toHaveLength(1);
    expect(setColor).toHaveBeenCalledTimes(1);

    // A later walk (an expand, a layout edit) draws it again, as before.
    await el._loadDataInComponents();
    await new Promise((r) => setTimeout(r, 0));
    expect(hm.heatmapCalls).toHaveLength(2);
    expect(setColor).toHaveBeenCalledTimes(2);

    // New data is drawn once too.
    const next = cells(['W'], 0.1);
    el.data = { ...el.data, 'G-hm': next };
    await el._loadDataInComponents();
    expect(hm.heatmapCalls).toHaveLength(3);
    expect(lastCall(hm)?.data).toBe(next);
  });
});

describe("a group colorScale that only the group's heatmap aggregate could read", () => {
  it('is not drawn, and the validator warns about it', async () => {
    const raw: ProtvistaViewerConfig = {
      rows: [
        {
          id: 'G',
          rendering: {
            colorScale: {
              stops: [
                { value: 0, color: '#000000' },
                { value: 1, color: '#ffffff' },
              ],
            },
          },
          tracks: [heatmapTrack('am')],
        },
      ],
    };
    expect(
      validateConfig(raw, createRegistry())
        .issues.filter((i) => i.code === 'rendering-field-ignored')
        .map((i) => i.path)
    ).toEqual(['G']);

    const hmData = cells(['A'], 0.5);
    const el = await mount(normalize(raw), { G: hmData, 'G-am': hmData }, []);
    await new Promise((r) => setTimeout(r, 0));
    const aggregate = el.querySelector(`#${CSS_PREFIX}-track-G`) as HeatmapStub;
    expect(aggregate.tagName.toLowerCase()).toBe(
      'nightingale-sequence-heatmap'
    );
    expect(aggregate.heatmapCalls).toEqual([]);
    expect(aggregate.colorFn).toBeUndefined();
  });
});
