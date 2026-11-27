/**
 * Authored colours, shapes and opacity as the real canvas track draws them,
 * from the styled fixture files. Every other browser spec stubs Nightingale
 * (`src/__browser__/setup.ts`), so a record's `color` there is only data;
 * here `nightingale-track-canvas` (and the manager that hands it the
 * coordinates) are real, and every shape it paints is recorded with the
 * context state it was painted in.
 *
 * Network-free: a `sequence:` config, so no UniProt request, and the data
 * file answered from the fixture by the `fetch` stub.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// `vi.unmock` cannot lift a setup file's mock in browser mode, so each mock
// is replaced by the real module (as in `notices-nightingale.browser.spec.ts`).
vi.mock('@nightingale-elements/nightingale-manager', (real) => real());
vi.mock('@nightingale-elements/nightingale-navigation', (real) => real());
vi.mock('@nightingale-elements/nightingale-sequence', (real) => real());
vi.mock('@nightingale-elements/nightingale-track-canvas', (real) => real());

import '../protvista-uniprot.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import { fixtureText } from './playground-page.js';
import { track, unmountAll } from './mount.js';

type El = HTMLElement & {
  viewerConfig?: unknown;
  updateComplete: Promise<unknown>;
};

/** One painted shape: how it was painted, and the context's state then. */
interface Paint {
  /** The id of the `nightingale-track-canvas` it was painted on. */
  track: string;
  op: 'fill' | 'stroke' | 'fillRect' | 'strokeRect';
  fillStyle: string;
  strokeStyle: string;
  globalAlpha: number;
}

const OPS = ['fill', 'stroke', 'fillRect', 'strokeRect'] as const;
let paints: Paint[] = [];

/** Record every paint on any 2D canvas, then paint as usual. */
function recordPaints(): void {
  const proto = CanvasRenderingContext2D.prototype;
  for (const op of OPS) {
    const real = proto[op] as (...args: unknown[]) => void;
    vi.spyOn(proto, op).mockImplementation(function (
      this: CanvasRenderingContext2D,
      ...args: unknown[]
    ) {
      paints.push({
        track: this.canvas.closest('nightingale-track-canvas')?.id ?? '',
        op,
        fillStyle: String(this.fillStyle),
        strokeStyle: String(this.strokeStyle),
        globalAlpha: this.globalAlpha,
      });
      real.apply(this, args);
    } as never);
  }
}

/** 600 residues: room for every fixture feature (the last ends at 565). */
const SEQUENCE = 'M'.repeat(600);

/** A grouped styled track, grey by default, reading the file named. */
const config = (file: string) => ({
  sequence: SEQUENCE,
  rows: [
    {
      id: 'MY_LAB',
      label: 'My lab',
      tracks: [
        {
          id: 'hits',
          label: 'Styled hits',
          kind: 'features',
          data: `./${file}`,
          rendering: { color: '#7f7f7f' },
        },
      ],
    },
  ],
});

afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  paints = [];
});

/**
 * Mount the viewer on `file`, expand the group so its "Styled hits" track
 * shows (a collapsed group row draws its tracks merged, in their type
 * colours), and wait until that track has painted.
 */
async function mountOn(file: string): Promise<void> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith(`/${file}`)
        ? new Response(fixtureText(file))
        : new Response('Not Found', { status: 404 })
    )
  );
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  recordPaints();
  const el = document.createElement('protvista-uniprot') as unknown as El;
  el.viewerConfig = config(file);
  track(el);
  const toggle = await vi.waitFor(
    () => {
      const t = el.querySelector<HTMLElement>(
        `.${CSS_PREFIX}-group-toggle[data-group-toggle="MY_LAB"]`
      );
      if (!t) throw new Error('group not rendered yet');
      return t;
    },
    { timeout: 10000 }
  );
  toggle.click();
  await vi.waitFor(
    () => {
      if (styledHits().length === 0) throw new Error('nothing painted yet');
    },
    { timeout: 10000 }
  );
  await el.updateComplete;
  await new Promise((r) => requestAnimationFrame(r));
}

/** The "Styled hits" track's canvas. */
const hitsTrack = () =>
  document.querySelector<HTMLElement>(
    `#${CSS_PREFIX}-track_hits nightingale-track-canvas`
  );
/** What was painted on the "Styled hits" track. */
const styledHits = () => {
  const id = hitsTrack()?.id;
  return id ? paints.filter((p) => p.track === id) : [];
};

/**
 * "Styled hits" paints whose stroke is `color` (the canvas normalises
 * `#RRGGBB` to lower case).
 */
const strokedIn = (color: string) =>
  styledHits().filter((p) => p.strokeStyle === color);

describe('authored styling on the real canvas track', () => {
  it('paints each feature in its CSV colour, and a blank cell in the track colour', async () => {
    await mountOn('styled.csv');
    // Two DOMAINs blue, BINDING red, REGION in `rendering.color`: each a
    // rectangle, so `fillRect` paints it.
    const rects = (color: string) =>
      strokedIn(color).filter((p) => p.op === 'fillRect');
    expect(rects('#1f77b4').length).toBeGreaterThanOrEqual(2);
    expect(rects('#d62728').length).toBeGreaterThanOrEqual(1);
    expect(rects('#7f7f7f').length).toBeGreaterThanOrEqual(1);
    // The fill matches the colour too: nothing is painted in another one.
    const colours = new Set(
      styledHits()
        .filter((p) => p.op === 'fillRect')
        .map((p) => p.fillStyle)
    );
    expect([...colours].sort()).toEqual(['#1f77b4', '#7f7f7f', '#d62728']);
  });

  it('paints a JSON record’s shape, fill and opacity, and the rest by default', async () => {
    await mountOn('styled.json');
    // The E1 domain: a green diamond (a path, so `fill`) with a light-green fill at 50%.
    expect(strokedIn('#2ca02c')).toContainEqual(
      expect.objectContaining({
        op: 'fill',
        fillStyle: '#98df8a',
        globalAlpha: 0.5,
      })
    );
    // BINDING: a red circle, a path too, at the default opacity.
    const binding = strokedIn('#d62728');
    expect(binding.length).toBeGreaterThan(0);
    for (const p of binding) {
      expect(p.op === 'fill' || p.op === 'stroke').toBe(true);
      expect(p.globalAlpha).toBeCloseTo(0.9);
    }
    // REGION: `color: null` and `opacity: ""` fall back to the track's grey
    // rectangle at the default opacity.
    expect(strokedIn('#7f7f7f')).toContainEqual(
      expect.objectContaining({ op: 'fillRect', fillStyle: '#7f7f7f' })
    );
    for (const p of strokedIn('#7f7f7f')) {
      expect(p.globalAlpha).toBeCloseTo(0.9);
    }
  });

  it('draws a "valueOf" shape as the default, without a TypeError, and keeps drawing on zoom', async () => {
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error);
    window.addEventListener('error', onError);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      await mountOn('shape-valueof.csv');
      // The DOMAIN takes the default rectangle; the REGION its diamond.
      expect(styledHits().some((p) => p.op === 'fillRect')).toBe(true);
      expect(styledHits().some((p) => p.op === 'fill')).toBe(true);

      // Zoom in on the DOMAIN, then all the way out: each redraws.
      const canvas = hitsTrack()!;
      for (const [start, end] of [
        [10, 60],
        [1, 600],
      ]) {
        paints = [];
        canvas.setAttribute('display-start', String(start));
        canvas.setAttribute('display-end', String(end));
        await vi.waitFor(() => {
          if (styledHits().length === 0) throw new Error('no redraw yet');
        });
      }
      expect(errors).toEqual([]);
      expect(
        consoleError.mock.calls.filter((call) =>
          String(call[0]).includes('TypeError')
        )
      ).toEqual([]);
    } finally {
      window.removeEventListener('error', onError);
    }
  });
});
