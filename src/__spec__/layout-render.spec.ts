/**
 * Render-level coverage for layout: `config.rows` flowing through
 * `<protvista-uniprot>`'s keyed-`repeat` row loop, and what customize mode
 * adds on top of it.
 *
 * Complements the pure-logic tests in `layout.spec.ts` by asserting the
 * actual rendered DOM — that a `hidden` row or track is genuinely absent
 * rather than merely blanked, that a reorder shows up in document order, and
 * that customize mode keeps every row reachable (hidden and dataless rows
 * come back as stubs) without displacing the visualization.
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

/** Three two-track canvas lanes: A, B, C. */
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
  return Array.from(target.querySelectorAll(`div.${CSS_PREFIX}-group`)).map(
    (d) => d.getAttribute('id')?.replace(`${CSS_PREFIX}-group_`, '') ?? ''
  );
}

function trackIds(target: HTMLElement): string[] {
  return Array.from(
    target.querySelectorAll(`.${CSS_PREFIX}-group__track`)
  ).map((d) => d.getAttribute('id')?.replace(`${CSS_PREFIX}-track_`, '') ?? '');
}

function renderInto(el: any): HTMLDivElement {
  const target = document.createElement('div');
  render(el.render(), target);
  return target;
}

describe('hidden rows and tracks', () => {
  it('omits a hidden lane from the rendered DOM', () => {
    const el = buildInstance({ config: makeConfig({ B: true }) });
    expect(laneIds(renderInto(el))).toEqual(['A', 'C']);
  });

  it('omits a hidden track from an expanded lane, keeping its siblings', () => {
    const el = buildInstance({ config: makeConfig({}, true) });
    const ids = trackIds(renderInto(el));
    expect(ids).toContain('At1');
    expect(ids).not.toContain('At2');
  });

  it('renders all lanes in authored order when nothing is hidden', () => {
    expect(laneIds(renderInto(buildInstance()))).toEqual(['A', 'B', 'C']);
  });

  it('drops a lane whose every track is hidden', () => {
    const config = makeConfig();
    config.rows[0].tracks.forEach((t) => (t.hidden = true));
    expect(laneIds(renderInto(buildInstance({ config })))).toEqual(['B', 'C']);
  });
});

describe('reordering', () => {
  it('renders rows in config order', () => {
    const config = makeConfig();
    config.rows = [config.rows[2], config.rows[0], config.rows[1]];
    expect(laneIds(renderInto(buildInstance({ config })))).toEqual([
      'C',
      'A',
      'B',
    ]);
  });

  it('renders a row’s tracks in that row’s track order', () => {
    const config = makeConfig();
    config.rows[0].tracks.reverse();
    const ids = trackIds(renderInto(buildInstance({ config })));
    expect(ids.slice(0, 2)).toEqual(['At2', 'At1']);
  });
});

describe('the all-hidden empty state', () => {
  it('shows a notice instead of an empty frame when every row is hidden', () => {
    const config = makeConfig();
    config.rows.forEach((r) => (r.hidden = true));
    const target = renderInto(buildInstance({ config }));
    const notice = target.querySelector(`.${CSS_PREFIX}-all-hidden`);
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain('All tracks are hidden');
  });

  it('is absent while any row is visible', () => {
    const target = renderInto(buildInstance());
    expect(target.querySelector(`.${CSS_PREFIX}-all-hidden`)).toBeNull();
  });
});

describe('the Customize toggle', () => {
  it('renders inside the nav label cell, so opening the mode cannot shift the viewer', () => {
    const target = renderInto(buildInstance());
    const cell = target.querySelector(`.${CSS_PREFIX}-nav-track-label`);
    expect(cell!.querySelector(`.${CSS_PREFIX}-customize-toggle`)).not.toBeNull();
  });

  it('reports a hidden count outside customize mode, counted per track', () => {
    const el = buildInstance({ config: makeConfig({ B: true }) });
    const target = renderInto(el);
    // B holds two tracks, so hiding the lane hides two.
    expect(
      target.querySelector(`.${CSS_PREFIX}-hidden-count`)!.textContent
    ).toContain('2 hidden');
  });

  it('makes the count a button that explains how to undo the hide', () => {
    const target = renderInto(buildInstance({ config: makeConfig({ B: true }) }));
    const badge = target.querySelector(`.${CSS_PREFIX}-hidden-count`)!;
    expect(badge.tagName).toBe('BUTTON');
    const hint = badge.getAttribute('title')!;
    expect(hint).toContain('Customize');
    expect(hint).toContain('Show');
    // Also the accessible name, so the hint is not mouse-only.
    expect(badge.getAttribute('aria-label')).toBe(hint);
  });

  it('leaves tracks with no data out of the count', () => {
    const data = makeData();
    delete data['A-At1'];
    delete data['A-At2'];
    const target = renderInto(buildInstance({ data }));
    expect(target.querySelector(`.${CSS_PREFIX}-hidden-count`)).toBeNull();
  });

  it('shows no count when nothing is hidden', () => {
    const target = renderInto(buildInstance());
    expect(target.querySelector(`.${CSS_PREFIX}-hidden-count`)).toBeNull();
  });
});

describe('customize mode', () => {
  it('adds no controls to the rows when off', () => {
    const target = renderInto(buildInstance());
    expect(target.querySelector(`.${CSS_PREFIX}-row-controls`)).toBeNull();
  });

  it('puts controls in every row’s label cell', () => {
    const target = renderInto(buildInstance({ _customizeMode: true }));
    const label = target.querySelector(`.${CSS_PREFIX}-group-label`)!;
    expect(label.querySelector(`.${CSS_PREFIX}-row-controls`)).not.toBeNull();
  });

  // Without the panel, a row absent from the canvas would have no control to
  // bring it back — hiding would be a one-way door.
  // A hidden row keeps drawing its features, ghosted, so the user can see
  // what Show would bring back — and so it never looks like a dataless row.
  it('keeps a hidden row reachable, and shows what it holds', () => {
    const el = buildInstance({
      config: makeConfig({ B: true }),
      _customizeMode: true,
    });
    const target = renderInto(el);
    const row = target.querySelector(`#${CSS_PREFIX}-group_B`);
    expect(row).not.toBeNull();
    expect(row!.classList.contains(`${CSS_PREFIX}-row--ghost`)).toBe(true);
    expect(row!.querySelector(`.${CSS_PREFIX}-row-controls`)).not.toBeNull();
    // Its content is drawn, not blanked — a stub would mean nothing to show.
    expect(row!.classList.contains(`${CSS_PREFIX}-row--stub`)).toBe(false);
  });

  it('ghosts an individually hidden track, not its visible siblings', () => {
    const el = buildInstance({
      config: makeConfig({}, true),
      _customizeMode: true,
    });
    const target = renderInto(el);
    const ghost = `${CSS_PREFIX}-row--ghost`;
    expect(
      target.querySelector(`#${CSS_PREFIX}-track_At2`)!.classList.contains(ghost)
    ).toBe(true);
    expect(
      target.querySelector(`#${CSS_PREFIX}-track_At1`)!.classList.contains(ghost)
    ).toBe(false);
  });

  it('ghosts nothing outside customize mode', () => {
    const target = renderInto(buildInstance({ config: makeConfig({ B: true }) }));
    expect(target.querySelector(`.${CSS_PREFIX}-row--ghost`)).toBeNull();
  });

  // Still a stub when there is genuinely nothing to draw.
  it('keeps the stub for a row with no data at all', () => {
    const data = makeData();
    for (const k of ['B', 'B-Bt1', 'B-Bt2']) delete data[k];
    const target = renderInto(buildInstance({ data, _customizeMode: true }));
    const row = target.querySelector(`#${CSS_PREFIX}-group_B`)!;
    expect(row.classList.contains(`${CSS_PREFIX}-row--stub`)).toBe(true);
  });

  it('offers Show (not Hide) on a hidden row', () => {
    const el = buildInstance({
      config: makeConfig({ B: true }),
      _customizeMode: true,
    });
    const stub = renderInto(el).querySelector(`#${CSS_PREFIX}-group_B`)!;
    const toggle = stub.querySelector('button[aria-pressed]')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Show B');
    expect(toggle.textContent).toContain('Show');
  });

  it('keeps a track with no data reachable as a stub', () => {
    const data = makeData();
    delete data['A-At2'];
    const target = renderInto(buildInstance({ data, _customizeMode: true }));
    const stub = target.querySelector(`#${CSS_PREFIX}-track_At2`)!;
    expect(stub.classList.contains(`${CSS_PREFIX}-row--stub`)).toBe(true);
    expect(stub.querySelector(`.${CSS_PREFIX}-row-controls`)).not.toBeNull();
  });

  it('disables move-up on the first row and move-down on the last', () => {
    const target = renderInto(buildInstance({ _customizeMode: true }));
    const lanes = target.querySelectorAll(`div.${CSS_PREFIX}-group`);
    const first = lanes[0].querySelectorAll(
      `.${CSS_PREFIX}-group-label .${CSS_PREFIX}-row-control--move`
    );
    const last = lanes[lanes.length - 1].querySelectorAll(
      `.${CSS_PREFIX}-group-label .${CSS_PREFIX}-row-control--move`
    );
    expect(first[0].hasAttribute('disabled')).toBe(true);
    expect(first[1].hasAttribute('disabled')).toBe(false);
    expect(last[1].hasAttribute('disabled')).toBe(true);
  });

  it('labels every control with the row it acts on', () => {
    const target = renderInto(buildInstance({ _customizeMode: true }));
    const labels = Array.from(
      target
        .querySelector(`#${CSS_PREFIX}-group_A`)!
        .querySelectorAll(`.${CSS_PREFIX}-group-label button`)
    ).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Collapse A',
      'Hide A',
      'Move A up',
      'Move A down',
    ]);
  });

  // Nesting buttons inside the role="button" group label is an axe violation
  // and leaves the inner controls unreachable to some assistive tech, so
  // collapse becomes its own button in the cluster while customizing.
  it('does not leave the group label a button around buttons', () => {
    const target = renderInto(buildInstance({ _customizeMode: true }));
    const label = target.querySelector(`.${CSS_PREFIX}-group-label`)!;
    expect(label.getAttribute('role')).toBeNull();
    expect(label.hasAttribute('tabindex')).toBe(false);
    const collapse = label.querySelector('[data-group-toggle]')!;
    expect(collapse.tagName).toBe('BUTTON');
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the group label a plain toggle outside customize mode', () => {
    const label = renderInto(buildInstance()).querySelector(
      `.${CSS_PREFIX}-group-label`
    )!;
    expect(label.getAttribute('role')).toBe('button');
    expect(label.getAttribute('aria-expanded')).toBe('true');
  });

  // Reordering is button-only; nothing is draggable.
  it('offers no drag affordance', () => {
    const target = renderInto(buildInstance({ _customizeMode: true }));
    expect(target.querySelector('[draggable="true"]')).toBeNull();
    expect(target.querySelector('[data-drop-row]')).toBeNull();
  });

  it('disables the Show toggle on a track with nothing to draw', () => {
    const data = makeData();
    delete data['A-At2'];
    const target = renderInto(buildInstance({ data, _customizeMode: true }));
    const toggle = target
      .querySelector(`#${CSS_PREFIX}-track_At2`)!
      .querySelector('button[aria-pressed]')!;
    expect(toggle.hasAttribute('disabled')).toBe(true);
    expect(toggle.getAttribute('aria-label')).toBe('No data for At2');
  });

  it('keeps the Show toggle live on a track the user hid', () => {
    const target = renderInto(
      buildInstance({ config: makeConfig({}, true), _customizeMode: true })
    );
    const toggle = target
      .querySelector(`#${CSS_PREFIX}-track_At2`)!
      .querySelector('button[aria-pressed]')!;
    expect(toggle.hasAttribute('disabled')).toBe(false);
    expect(toggle.getAttribute('aria-label')).toBe('Show At2');
  });
});

describe('the live region', () => {
  it('is a polite status region so moves and toggles are announced', () => {
    const target = renderInto(buildInstance());
    const region = target.querySelector(`.${CSS_PREFIX}-live-region`)!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('role')).toBe('status');
  });

  it('carries the latest announcement', () => {
    const el = buildInstance({ _announcement: 'A moved to position 2 of 3.' });
    const target = renderInto(el);
    expect(
      target.querySelector(`.${CSS_PREFIX}-live-region`)!.textContent
    ).toContain('A moved to position 2 of 3.');
  });
});

describe('the just-moved highlight', () => {
  it('marks the row named by _movedKey', () => {
    const target = renderInto(
      buildInstance({ _customizeMode: true, _movedKey: 'B' })
    );
    const moved = target.querySelectorAll(`.${CSS_PREFIX}-row--moved`);
    expect(moved).toHaveLength(1);
    expect(moved[0].id).toBe(`${CSS_PREFIX}-group_B`);
  });

  it('marks a moved track by its composite key', () => {
    const target = renderInto(
      buildInstance({ _customizeMode: true, _movedKey: 'A-At2' })
    );
    const moved = target.querySelectorAll(`.${CSS_PREFIX}-row--moved`);
    expect(moved).toHaveLength(1);
    expect(moved[0].id).toBe(`${CSS_PREFIX}-track_At2`);
  });

  it('marks nothing when no move is pending', () => {
    const target = renderInto(buildInstance({ _customizeMode: true }));
    expect(target.querySelectorAll(`.${CSS_PREFIX}-row--moved`)).toHaveLength(0);
  });
});
