/**
 * Render-level coverage for the runtime layout overlay: the `_layout`
 * state (flat per-track order + visibility) flowing through
 * `<protvista-uniprot>`'s keyed-`repeat` block render loop.
 *
 * Complements the pure-logic tests in `layout.spec.ts` by asserting the
 * actual rendered DOM: an authored-`hidden` lane/track is absent from the
 * output, a user `_layout` overlay reorders groups and splits a track out as
 * a "Group / Track" row, and the default (empty) overlay reproduces authored
 * order.
 *
 * Mirrors `render-target.spec.ts`: build an instance with frozen state
 * (never appended to the document, so `connectedCallback`/`_init` stays
 * dormant) and render its template into a detached target. The
 * `@nightingale-elements/*` packages are stubbed globally via
 * `src/__spec__/nightingale-mocks.ts` (wired through `setupFiles`).
 */
import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import type { NormalizedConfig } from '../schema/normalize';
import { CSS_PREFIX } from '../styles/css-prefix';
import '../protvista-uniprot';

const SEQ_LEN = 100;
const SEQUENCE = 'M'.repeat(SEQ_LEN);

/** Three single-track canvas lanes: A, B, C. */
function makeConfig(
  rowHidden: Partial<Record<'A' | 'B' | 'C', boolean>> = {},
  trackHidden = false
): NormalizedConfig {
  const lane = (id: 'A' | 'B' | 'C') => ({
    id,
    label: id,
    component: 'nightingale-track-canvas' as const,
    rendering: {},
    ...(rowHidden[id] !== undefined ? { hidden: rowHidden[id] } : {}),
    tracks: [
      {
        id: `${id}t1`,
        label: `${id}t1`,
        component: 'nightingale-track-canvas' as const,
        rendering: {},
        data: [{ from: 'url' as const, url: 'stub://x' }],
      },
      {
        id: `${id}t2`,
        label: `${id}t2`,
        component: 'nightingale-track-canvas' as const,
        rendering: {},
        ...(trackHidden ? { hidden: true } : {}),
        data: [{ from: 'url' as const, url: 'stub://y' }],
      },
    ],
  });
  return {
    version: '1.0',
    sources: {},
    defaults: { rendering: {} },
    rows: [lane('A'), lane('B'), lane('C')],
  };
}

/** Non-empty data for every lane + its two tracks, so rows render. */
function makeData() {
  const d: Record<string, unknown> = {};
  for (const id of ['A', 'B', 'C']) {
    d[id] = [{ type: 'DOMAIN', start: 1, end: 10 }];
    d[`${id}-${id}t1`] = [{ type: 'DOMAIN', start: 1, end: 5 }];
    d[`${id}-${id}t2`] = [{ type: 'DOMAIN', start: 6, end: 10 }];
  }
  return d;
}

function buildInstance(overrides: Record<string, unknown> = {}) {
  const el = document.createElement('protvista-uniprot') as any;
  el.sequence = SEQUENCE;
  el.hasData = true;
  el.loading = false;
  el.suspend = false;
  el.openGroups = ['A', 'B', 'C'];
  el.displayCoordinates = { start: 1, end: SEQ_LEN };
  el.accession = 'P05067';
  el.config = makeConfig();
  el.data = makeData();
  Object.assign(el, overrides);
  return el;
}

function laneIds(target: HTMLElement): string[] {
  return Array.from(
    target.querySelectorAll(`div.${CSS_PREFIX}-group`)
  ).map((d) => d.getAttribute('id')?.replace(`${CSS_PREFIX}-group_`, '') ?? '');
}

function renderInto(el: any): HTMLDivElement {
  const target = document.createElement('div');
  render(el.render(), target);
  return target;
}

describe('layout overlay — authored hidden default', () => {
  it('omits an authored-hidden lane from the rendered DOM', () => {
    const el = buildInstance({ config: makeConfig({ B: true }) });
    expect(laneIds(renderInto(el))).toEqual(['A', 'C']);
  });

  it('omits an authored-hidden track from an expanded lane, keeping siblings', () => {
    const el = buildInstance({ config: makeConfig({}, true) });
    const target = renderInto(el);
    // Lane A still renders; its hidden t2 track is gone, t1 remains.
    const trackIds = Array.from(
      target.querySelectorAll(`.${CSS_PREFIX}-group__track`)
    ).map((d) => d.getAttribute('id'));
    expect(trackIds).toContain(`${CSS_PREFIX}-track_At1`);
    expect(trackIds).not.toContain(`${CSS_PREFIX}-track_At2`);
  });

  it('renders all lanes in authored order under the empty overlay', () => {
    expect(laneIds(renderInto(buildInstance()))).toEqual(['A', 'B', 'C']);
  });
});

// Full-block track-key orders (each lane is a group of two tracks).
const keys = (id: 'A' | 'B' | 'C') => [`${id}-${id}t1`, `${id}-${id}t2`];

describe('layout overlay — user order + visibility', () => {
  it('reorders whole intact groups by moving their track keys as a block', () => {
    const el = buildInstance({
      _layout: { order: [...keys('C'), ...keys('A'), ...keys('B')], hidden: {} },
    });
    expect(laneIds(renderInto(el))).toEqual(['C', 'A', 'B']);
  });

  it('hides a lane the user toggled off (group hide override)', () => {
    const el = buildInstance({ _layout: { order: null, hidden: { A: true } } });
    expect(laneIds(renderInto(el))).toEqual(['B', 'C']);
  });

  it('reveals an author-hidden lane the user toggled on', () => {
    const el = buildInstance({
      config: makeConfig({ B: true }),
      _layout: { order: null, hidden: { B: false } },
    });
    expect(laneIds(renderInto(el))).toEqual(['A', 'B', 'C']);
  });

  it('combines order and hidden: reorder then drop the group-hidden lane', () => {
    const el = buildInstance({
      _layout: {
        order: [...keys('C'), ...keys('B'), ...keys('A')],
        hidden: { B: true },
      },
    });
    expect(laneIds(renderInto(el))).toEqual(['C', 'A']);
  });

  it('renders a partial group bracket for a split group\'s contiguous run', () => {
    // Group G (x, y, z); move z out after a standalone, leaving [x, y] together.
    const canvas = 'nightingale-track-canvas' as const;
    const trk = (id: string) => ({
      id,
      label: id,
      component: canvas,
      rendering: {},
      data: [{ from: 'url' as const, url: 'stub://x' }],
    });
    const config = {
      version: '1.0' as const,
      sources: {},
      defaults: { rendering: {} },
      rows: [
        { id: 'G', label: 'Gee', component: canvas, rendering: {}, tracks: [trk('x'), trk('y'), trk('z')] },
        { id: 'S', label: 'Ess', component: canvas, rendering: {}, standalone: true, tracks: [trk('S')] },
      ],
    } as unknown as NormalizedConfig;
    const data: Record<string, unknown> = {
      G: [{ type: 'DOMAIN', start: 1, end: 9 }],
      'G-x': [{ type: 'DOMAIN', start: 1, end: 3 }],
      'G-y': [{ type: 'DOMAIN', start: 4, end: 6 }],
      'G-z': [{ type: 'DOMAIN', start: 7, end: 9 }],
      'S-S': [{ type: 'DOMAIN', start: 1, end: 9 }],
    };
    const el = buildInstance({
      config,
      data,
      openGroups: ['G'],
      _layout: { order: ['G-x', 'G-y', 'S-S', 'G-z'], hidden: {} },
    });
    const target = renderInto(el);
    // A non-collapsible partial bracket header, plus x and y as tracks.
    expect(
      target.querySelector(`.${CSS_PREFIX}-group-label--partial`)
    ).not.toBeNull();
    expect(target.querySelector(`#${CSS_PREFIX}-track_x`)).not.toBeNull();
    expect(target.querySelector(`#${CSS_PREFIX}-track_y`)).not.toBeNull();
    // z is isolated → a separated "Gee / z" row.
    const z = target.querySelector(`#${CSS_PREFIX}-track_G-z`);
    expect(z).not.toBeNull();
    expect(z!.querySelector(`.${CSS_PREFIX}-track-label`)!.textContent).toContain(
      'Gee / z'
    );
  });

  it('renders a track moved out of its group as an individual "Group / Track" row', () => {
    // Split A: pull At2 out (after B), leaving At1 also isolated.
    const el = buildInstance({
      _layout: {
        order: ['A-At1', ...keys('B'), 'A-At2', ...keys('C')],
        hidden: {},
      },
    });
    const target = renderInto(el);
    // A no longer has an intact group wrapper; B and C still do.
    expect(laneIds(target)).toEqual(['B', 'C']);
    // Its tracks render as standalone rows labelled "A / At1" and "A / At2".
    const sep = target.querySelector(`#${CSS_PREFIX}-track_A-At2`);
    expect(sep).not.toBeNull();
    expect(sep!.querySelector(`.${CSS_PREFIX}-track-label`)!.textContent).toContain(
      'A / At2'
    );
  });
});
