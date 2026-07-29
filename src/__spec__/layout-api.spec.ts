/**
 * Runtime layout API on `<protvista-uniprot>`: `setRowOrder`,
 * `setTrackOrder`, `setRowVisibility`, `setTrackVisibility`, `resetLayout`,
 * `getLayout`, `getConfig`, and the `protvista-layout-change` event.
 *
 * The config is the source of truth, so each call is asserted to (a) rewrite
 * `config.rows`, (b) show up in the render loop's DOM output, (c) be
 * reported by `getLayout()` as a patch against the authored baseline, and
 * (d) dispatch exactly one bubbling `protvista-layout-change` — while a
 * no-op call emits nothing. Mirrors `render-target.spec.ts`: a detached
 * instance with frozen state, rendered into a throwaway target (the
 * `@nightingale-elements/*` packages are stubbed via `setupFiles`).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'lit';
import type { NormalizedConfig } from '../schema/normalize';
import type { LayoutPatch, ProtvistaViewerConfig } from '../schema/types';
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
  setTrackOrder(rowId: string, order: string[]): void;
  setRowVisibility(rowId: string, visible: boolean): void;
  setTrackVisibility(groupId: string, trackId: string, visible: boolean): void;
  resetLayout(): void;
  getLayout(): LayoutPatch;
  getConfig(): ProtvistaViewerConfig | undefined;
  config: NormalizedConfig;
  render(): unknown;
  addEventListener: HTMLElement['addEventListener'];
}

let el: Api;
let events: LayoutPatch[];

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
    events.push((e as CustomEvent<LayoutPatch>).detail);
  });
});

/** Render the current template and return the ordered lane ids in the DOM. */
function laneIds(): string[] {
  const target = document.createElement('div');
  render(el.render(), target);
  return Array.from(target.querySelectorAll(`div.${CSS_PREFIX}-group`)).map(
    (d) => d.getAttribute('id')?.replace(`${CSS_PREFIX}-group_`, '') ?? ''
  );
}

function trackIds(): string[] {
  const target = document.createElement('div');
  render(el.render(), target);
  return Array.from(
    target.querySelectorAll(`.${CSS_PREFIX}-group__track`)
  ).map((d) => d.getAttribute('id')?.replace(`${CSS_PREFIX}-track_`, '') ?? '');
}

const rowIds = () => el.config.rows.map((r) => r.id);

describe('setRowOrder', () => {
  it('reorders the rows, the DOM, and emits the new order', () => {
    el.setRowOrder(['C', 'A', 'B']);
    expect(rowIds()).toEqual(['C', 'A', 'B']);
    expect(laneIds()).toEqual(['C', 'A', 'B']);
    expect(events).toHaveLength(1);
    expect(events[0].order).toEqual(['C', 'A', 'B']);
  });

  it('ignores unknown ids and appends the ones it omits', () => {
    el.setRowOrder(['zzz', 'C']);
    expect(rowIds()).toEqual(['C', 'A', 'B']);
  });

  it('does not emit when the order is unchanged', () => {
    el.setRowOrder(['C', 'A', 'B']);
    el.setRowOrder(['C', 'A', 'B']);
    expect(events).toHaveLength(1);
  });
});

describe('setTrackOrder', () => {
  it('reorders tracks within their row only', () => {
    el.setTrackOrder('A', ['At2', 'At1']);
    expect(el.config.rows[0].tracks.map((t) => t.id)).toEqual(['At2', 'At1']);
    // The row order itself is untouched.
    expect(rowIds()).toEqual(['A', 'B', 'C']);
    expect(events[0].tracks).toEqual({ A: ['At2', 'At1'] });
  });

  it('is a no-op for an unknown row', () => {
    el.setTrackOrder('zzz', ['At2', 'At1']);
    expect(events).toHaveLength(0);
  });
});

describe('setRowVisibility', () => {
  it('hides a lane, removing it from the DOM, and emits', () => {
    el.setRowVisibility('B', false);
    expect(el.getLayout().hidden).toEqual({ rows: { B: true }, tracks: {} });
    expect(laneIds()).toEqual(['A', 'C']);
    expect(events).toHaveLength(1);
    expect(events[0].hidden).toEqual({ rows: { B: true }, tracks: {} });
  });

  it('does not emit a second time for the same hidden state', () => {
    el.setRowVisibility('B', false);
    el.setRowVisibility('B', false);
    expect(events).toHaveLength(1);
  });

  it('re-shows a hidden lane, leaving no trace in the patch', () => {
    el.setRowVisibility('B', false);
    el.setRowVisibility('B', true);
    expect(laneIds()).toEqual(['A', 'B', 'C']);
    expect(el.getLayout().hidden).toEqual({ rows: {}, tracks: {} });
    expect(events).toHaveLength(2);
  });

  it('showing a row also clears per-track hides inside it', () => {
    el.setTrackVisibility('A', 'At1', false);
    el.setTrackVisibility('A', 'At2', false);
    expect(laneIds()).not.toContain('A');

    el.setRowVisibility('A', true);
    expect(laneIds()).toContain('A');
    expect(el.getLayout().hidden).toEqual({ rows: {}, tracks: {} });
  });
});

describe('setTrackVisibility', () => {
  it('hides one track within a group', () => {
    el.setTrackVisibility('A', 'At2', false);
    expect(el.getLayout().hidden).toEqual({
      rows: {},
      tracks: { A: { At2: true } },
    });
    expect(trackIds()).toContain('At1');
    expect(trackIds()).not.toContain('At2');
    expect(events).toHaveLength(1);
  });

  it('hiding every track of a group removes the whole lane', () => {
    el.setTrackVisibility('A', 'At1', false);
    el.setTrackVisibility('A', 'At2', false);
    expect(laneIds()).toEqual(['B', 'C']);
  });
});

describe('resetLayout', () => {
  it('restores authored order + visibility and emits once', () => {
    el.setRowOrder(['C', 'A', 'B']);
    el.setRowVisibility('B', false);
    events.length = 0;

    el.resetLayout();
    expect(el.getLayout()).toEqual({
      order: null,
      tracks: {},
      hidden: { rows: {}, tracks: {} },
    });
    expect(laneIds()).toEqual(['A', 'B', 'C']);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      order: null,
      tracks: {},
      hidden: { rows: {}, tracks: {} },
    });
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
    snapshot.hidden.rows.B = false;
    snapshot.order = ['zzz'];
    expect(el.getLayout().hidden).toEqual({ rows: { B: true }, tracks: {} });
    expect(el.getLayout().order).toBeNull();
  });
});

// The reason the config is the source of truth: an arranged view has to be
// exportable, so an imported dataset can be saved with its arrangement.
describe('getConfig', () => {
  it('is undefined until a config has been loaded through the pipeline', () => {
    // This fixture assigns `config` directly, so there is no authored source.
    expect(el.getConfig()).toBeUndefined();
  });
});
