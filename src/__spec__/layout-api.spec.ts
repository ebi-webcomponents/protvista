/**
 * Runtime layout API on `<protvista-uniprot>`: `setRowOrder`,
 * `setRowVisibility`, `setTrackVisibility`, `resetLayout`, `getLayout`,
 * and the `protvista-layout-change` event.
 *
 * Asserts each call (a) updates the overlay `getLayout()` reports, (b) is
 * reflected by the render loop's DOM output, and (c) dispatches exactly one
 * bubbling `protvista-layout-change` carrying the new overlay — while a
 * no-op call emits nothing. Mirrors `render-target.spec.ts`: a detached
 * instance with frozen state, rendered into a throwaway target (the
 * `@nightingale-elements/*` packages are stubbed via `setupFiles`).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'lit';
import type { NormalizedConfig } from '../schema/normalize';
import type { ViewerLayout } from '../schema/types';
import { CSS_PREFIX } from '../styles/css-prefix';
import '../protvista-uniprot';

const SEQUENCE = 'M'.repeat(100);

function makeConfig(): NormalizedConfig {
  const lane = (id: string) => ({
    id,
    label: id,
    component: 'nightingale-track-canvas' as const,
    rendering: {},
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

function makeData() {
  const d: Record<string, unknown> = {};
  for (const id of ['A', 'B', 'C']) {
    d[id] = [{ type: 'DOMAIN', start: 1, end: 10 }];
    d[`${id}-${id}t1`] = [{ type: 'DOMAIN', start: 1, end: 5 }];
    d[`${id}-${id}t2`] = [{ type: 'DOMAIN', start: 6, end: 10 }];
  }
  return d;
}

interface Api {
  setRowOrder(order: string[]): void;
  setRowVisibility(rowId: string, visible: boolean): void;
  setTrackVisibility(groupId: string, trackId: string, visible: boolean): void;
  resetLayout(): void;
  getLayout(): ViewerLayout;
  render(): unknown;
  addEventListener: HTMLElement['addEventListener'];
}

let el: Api;
let events: ViewerLayout[];

beforeEach(() => {
  const node = document.createElement('protvista-uniprot') as unknown as Record<
    string,
    unknown
  >;
  node.sequence = SEQUENCE;
  node.hasData = true;
  node.loading = false;
  node.suspend = false;
  node.openGroups = ['A', 'B', 'C'];
  node.displayCoordinates = { start: 1, end: 100 };
  node.accession = 'P05067';
  node.config = makeConfig();
  node.data = makeData();
  el = node as unknown as Api;

  events = [];
  el.addEventListener('protvista-layout-change', (e) => {
    events.push((e as CustomEvent<ViewerLayout>).detail);
  });
});

/** Render the current template and return the ordered lane ids in the DOM. */
function laneIds(): string[] {
  const target = document.createElement('div');
  render(el.render(), target);
  return Array.from(
    target.querySelectorAll(`div.${CSS_PREFIX}-group`)
  ).map((d) => d.getAttribute('id')?.replace(`${CSS_PREFIX}-group_`, '') ?? '');
}

function trackIds(): string[] {
  const target = document.createElement('div');
  render(el.render(), target);
  return Array.from(
    target.querySelectorAll(`.${CSS_PREFIX}-group__track`)
  ).map((d) => d.getAttribute('id')?.replace(`${CSS_PREFIX}-track_`, '') ?? '');
}

describe('setRowOrder', () => {
  it('reorders the overlay, the DOM, and emits the new order', () => {
    el.setRowOrder(['C', 'A', 'B']);
    expect(el.getLayout().order).toEqual(['C', 'A', 'B']);
    expect(laneIds()).toEqual(['C', 'A', 'B']);
    expect(events).toHaveLength(1);
    expect(events[0].order).toEqual(['C', 'A', 'B']);
  });

  it('does not emit when the order is unchanged', () => {
    el.setRowOrder(['C', 'A', 'B']);
    el.setRowOrder(['C', 'A', 'B']);
    expect(events).toHaveLength(1);
  });
});

describe('setRowVisibility', () => {
  it('hides a lane, removing it from the DOM, and emits', () => {
    el.setRowVisibility('B', false);
    expect(el.getLayout().hidden).toEqual({ B: true });
    expect(laneIds()).toEqual(['A', 'C']);
    expect(events).toHaveLength(1);
    expect(events[0].hidden).toEqual({ B: true });
  });

  it('does not emit a second time for the same hidden state', () => {
    el.setRowVisibility('B', false);
    el.setRowVisibility('B', false);
    expect(events).toHaveLength(1);
  });

  it('re-shows a hidden lane', () => {
    el.setRowVisibility('B', false);
    el.setRowVisibility('B', true);
    expect(laneIds()).toEqual(['A', 'B', 'C']);
    expect(el.getLayout().hidden).toEqual({ B: false });
    expect(events).toHaveLength(2);
  });
});

describe('setTrackVisibility', () => {
  it('hides one track within a group using the composite key', () => {
    el.setTrackVisibility('A', 'At2', false);
    expect(el.getLayout().hidden).toEqual({ 'A-At2': true });
    expect(trackIds()).toContain('At1');
    expect(trackIds()).not.toContain('At2');
    expect(events).toHaveLength(1);
  });
});

describe('resetLayout', () => {
  it('restores authored order + visibility and emits once', () => {
    el.setRowOrder(['C', 'A', 'B']);
    el.setRowVisibility('B', false);
    events.length = 0;

    el.resetLayout();
    expect(el.getLayout()).toEqual({ order: null, hidden: {} });
    expect(laneIds()).toEqual(['A', 'B', 'C']);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ order: null, hidden: {} });
  });

  it('is a no-op (no event) when already at the authored default', () => {
    el.resetLayout();
    expect(events).toHaveLength(0);
  });
});

describe('getLayout', () => {
  it('returns a copy that cannot mutate internal state', () => {
    el.setRowVisibility('B', false);
    const snapshot = el.getLayout();
    snapshot.hidden.B = false;
    snapshot.order = ['zzz'];
    // Internal state is untouched by mutating the returned copy.
    expect(el.getLayout().hidden).toEqual({ B: true });
    expect(el.getLayout().order).toBeNull();
  });
});
