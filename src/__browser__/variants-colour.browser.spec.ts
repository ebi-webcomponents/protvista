/**
 * Every variants track gets ProtVista's variant colour scheme (#389). Two
 * `kind: variants` tracks used to colour only the first canvas in document
 * order; the second kept Nightingale's default and drew every dot pink.
 * Here `nightingale-variation-canvas` (and the manager that hands it the
 * coordinates) are real, and every `fill()` is recorded with the canvas it
 * was painted on.
 *
 * Network-free: a `sequence:` config, so no UniProt request, and the data
 * files answered by the `fetch` stub.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// `vi.unmock` cannot lift a setup file's mock in browser mode, so each mock
// is replaced by the real module (as in `feature-render.browser.spec.ts`).
vi.mock('@nightingale-elements/nightingale-manager', (real) => real());
vi.mock('@nightingale-elements/nightingale-navigation', (real) => real());
vi.mock('@nightingale-elements/nightingale-sequence', (real) => real());
// The app imports `AminoAcid` as a value, which the real module's bundle does
// not export (only its typings re-export it), so linking fails without these.
vi.mock(
  '@nightingale-elements/nightingale-variation-canvas',
  async (real) => ({
    ...(await real<object>()),
    AminoAcid: { Empty: '-' },
    ClinicalSignificance: {},
  })
);

import '../protvista-uniprot.js';
import filterConfig, { colorConfig } from '../filter-config.js';
import { track, unmountAll } from './mount.js';

type El = HTMLElement & {
  viewerConfig?: unknown;
  updateComplete: Promise<unknown>;
};

type VariationCanvas = HTMLElement & { colorConfig?: unknown };

/** Nightingale's default `colorConfig`, as the canvas normalises it. */
const PINK = '#ffc0cb';

const CSV = [
  'position,wildType,variant,description,consequence',
  '10,M,A,first,missense',
  '20,M,V,second,missense',
  '30,M,*,third,stop_gained',
].join('\n');

/** Fill colours painted on each variation canvas, by canvas id. */
let fills: Record<string, Set<string>> = {};

function recordFills(): void {
  const proto = CanvasRenderingContext2D.prototype;
  const real = proto.fill as (...args: unknown[]) => void;
  vi.spyOn(proto, 'fill').mockImplementation(function (
    this: CanvasRenderingContext2D,
    ...args: unknown[]
  ) {
    const id = this.canvas.closest('nightingale-variation-canvas')?.id;
    if (id) (fills[id] ??= new Set()).add(String(this.fillStyle));
    real.apply(this, args);
  } as never);
}

/** Two standalone variants tracks, each reading its own file. */
const config = (extra: Record<string, unknown> = {}) => ({
  sequence: 'M'.repeat(100),
  rows: [
    { id: 'first', kind: 'variants', data: './a.csv', ...extra },
    { id: 'second', kind: 'variants', data: './b.csv', ...extra },
  ],
});

const canvases = () => [
  ...document.querySelectorAll<VariationCanvas>('nightingale-variation-canvas'),
];

afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fills = {};
});

/** Mount the viewer and wait until both variation canvases have painted. */
async function mount(viewerConfig: unknown): Promise<El> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      /\/[ab]\.csv$/.test(String(input))
        ? new Response(CSV)
        : new Response('Not Found', { status: 404 })
    )
  );
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  recordFills();
  const el = document.createElement('protvista-uniprot') as unknown as El;
  el.viewerConfig = viewerConfig;
  track(el);
  await vi.waitFor(
    () => {
      const ids = canvases().map((c) => c.id);
      if (ids.length !== 2 || !ids.every((id) => fills[id]?.size)) {
        throw new Error('both canvases have not painted yet');
      }
    },
    { timeout: 10000 }
  );
  await el.updateComplete;
  await new Promise((r) => requestAnimationFrame(r));
  return el;
}

describe('two variants tracks', () => {
  it('give every canvas the variant colour scheme, so none paints pink', async () => {
    await mount(config());
    const all = canvases();
    expect(all).toHaveLength(2);
    for (const canvas of all) {
      expect(canvas.colorConfig).toBe(colorConfig);
      expect([...fills[canvas.id]]).not.toContain(PINK);
    }
    // The same rows paint the same colours on both tracks.
    const [a, b] = all.map((c) => [...fills[c.id]].sort());
    expect(b).toEqual(a);
  });

  it('give every filter UI the variant filters', async () => {
    await mount(config({ filterUI: 'nightingale-filter' }));
    const filters = [
      ...document.querySelectorAll<HTMLElement & { filters?: unknown }>(
        'nightingale-filter'
      ),
    ];
    expect(filters).toHaveLength(2);
    for (const f of filters) expect(f.filters).toBe(filterConfig);
  });
});
