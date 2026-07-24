/**
 * Render-level coverage for the runtime layout overlay: the `_layout`
 * state (row order + visibility) flowing through `<protvista-uniprot>`'s
 * keyed-`repeat` render loop.
 *
 * Complements the pure-logic tests in `layout.spec.ts` by asserting the
 * actual rendered DOM: an authored-`hidden` lane/track is absent from the
 * output, a user `_layout` overlay reorders the lane blocks and hides /
 * reveals lanes, and the default (empty) overlay reproduces authored order.
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

describe('layout overlay — user order + visibility', () => {
  it('reorders the lane blocks by _layout.order', () => {
    const el = buildInstance({ _layout: { order: ['C', 'A', 'B'], hidden: {} } });
    expect(laneIds(renderInto(el))).toEqual(['C', 'A', 'B']);
  });

  it('hides a lane the user toggled off (override on an author-visible lane)', () => {
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

  it('combines order and hidden: reorder then drop the hidden lane', () => {
    const el = buildInstance({
      _layout: { order: ['C', 'B', 'A'], hidden: { B: true } },
    });
    expect(laneIds(renderInto(el))).toEqual(['C', 'A']);
  });
});
