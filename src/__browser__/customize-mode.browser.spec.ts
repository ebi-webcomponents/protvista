/**
 * End-to-end coverage for "Customize layout" on `<protvista-uniprot>` in a
 * real browser: the inline per-row controls, their operation, and the
 * accessibility contract from #173.
 *
 * A real mount is what makes this worth running in a browser rather than
 * jsdom — focus actually moves, `aria-pressed` and `disabled` are actually
 * computed, and axe has a real layout to inspect. The pure ordering logic is covered in `src/__spec__/layout.spec.ts`
 * and the render output in `layout-render.spec.ts`; this file is about
 * whether a person can drive the thing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import '../protvista-uniprot';
import type { LayoutPatch } from '../schema/types';
import { CSS_PREFIX } from '../styles/css-prefix';
import { mount } from './mount';
import { expectNoA11yViolations } from './axe';

const CONFIG = {
  rows: [
    {
      id: 'DOMAINS',
      label: 'Domains',
      tracks: [
        { id: 'domain', kind: 'features', data: 'https://example.org/a.json' },
        { id: 'region', kind: 'features', data: 'https://example.org/b.json' },
        // Served an empty array, so this one never has anything to draw.
        { id: 'empty', kind: 'features', data: 'https://example.org/empty.json' },
      ],
    },
    {
      id: 'PTM',
      label: 'Modifications',
      tracks: [
        { id: 'glyco', kind: 'features', data: 'https://example.org/c.json' },
      ],
    },
    {
      id: 'sites',
      label: 'Sites',
      kind: 'features',
      data: 'https://example.org/d.json',
    },
  ],
};

type Viewer = HTMLElement & {
  viewerConfig?: unknown;
  accession?: string;
  noPersistLayout?: boolean;
  openGroups?: string[];
  getLayout(): LayoutPatch;
  setRowVisibility(rowId: string, visible: boolean): void;
  setTrackVisibility(groupId: string, trackId: string, visible: boolean): void;
  updateComplete: Promise<unknown>;
};

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      const body = url.includes('/proteins/api/proteins/')
        ? { sequence: { sequence: 'MSEQENCE' } }
        : url.includes('empty.json')
          ? []
          : [{ type: 'DOMAIN', start: 1, end: 5 }];
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    })
  );
}

/** Mount a viewer, wait for its config, and expand every group. */
async function mountViewer(): Promise<Viewer> {
  const el = mount<Viewer>('protvista-uniprot', {
    viewerConfig: CONFIG,
    accession: 'P05067',
    // Persistence has its own spec; keep it out of this one's way.
    noPersistLayout: true,
  });
  await vi.waitFor(() => {
    if (!el.querySelector(`.${CSS_PREFIX}-customize-toggle`)) {
      throw new Error('not ready');
    }
  });
  el.openGroups = ['DOMAINS', 'PTM'];
  await el.updateComplete;
  return el;
}

const toggle = (el: Viewer) =>
  el.querySelector<HTMLButtonElement>(`.${CSS_PREFIX}-customize-toggle`)!;

async function enterCustomize(el: Viewer): Promise<void> {
  toggle(el).click();
  await el.updateComplete;
}

const laneIds = (el: Viewer) =>
  Array.from(el.querySelectorAll(`div.${CSS_PREFIX}-group`)).map(
    (d) => d.id.replace(`${CSS_PREFIX}-group_`, '')
  );

/** Every row-level control button inside a given row's label cell. */
function rowControls(el: Viewer, rowId: string): HTMLButtonElement[] {
  const row = el.querySelector(`#${CSS_PREFIX}-group_${rowId}`)!;
  return Array.from(
    row.querySelectorAll<HTMLButtonElement>(
      `.${CSS_PREFIX}-row-controls button`
    )
  );
}

/**
 * One control of a row, found by what its accessible name starts with —
 * group rows carry a collapse button the others don't, so positional lookup
 * would silently address the wrong control.
 */
function control(el: Viewer, rowId: string, action: string): HTMLButtonElement {
  const found = rowControls(el, rowId).find((b) =>
    b.getAttribute('aria-label')!.startsWith(action)
  );
  if (!found) throw new Error(`no "${action}" control on row ${rowId}`);
  return found;
}

/**
 * A row's visibility switch. Looked up by role rather than by name: the
 * switch's accessible name is its purpose and no longer flips with state.
 */
function rowSwitch(el: Viewer, rowId: string): HTMLButtonElement {
  return el.querySelector<HTMLButtonElement>(
    `#${CSS_PREFIX}-group_${rowId} .${CSS_PREFIX}-row-controls button[role="switch"]`
  )!;
}

function trackSwitch(el: Viewer, trackId: string): HTMLButtonElement {
  return el.querySelector<HTMLButtonElement>(
    `#${CSS_PREFIX}-track_${trackId} button[role="switch"]`
  )!;
}

/** The same, for a track row inside a group. */
function trackControl(
  el: Viewer,
  trackId: string,
  action: string
): HTMLButtonElement {
  const row = el.querySelector(`#${CSS_PREFIX}-track_${trackId}`)!;
  const found = Array.from(
    row.querySelectorAll<HTMLButtonElement>(`.${CSS_PREFIX}-row-controls button`)
  ).find((b) => b.getAttribute('aria-label')!.startsWith(action));
  if (!found) throw new Error(`no "${action}" control on track ${trackId}`);
  return found;
}

const liveRegionText = (el: Viewer) =>
  el.querySelector(`.${CSS_PREFIX}-live-region`)!.textContent!.trim();

beforeEach(() => {
  stubFetch();
});

describe('entering and leaving customize mode', () => {
  it('shows no row controls until the mode is on', async () => {
    const el = await mountViewer();
    expect(el.querySelector(`.${CSS_PREFIX}-row-controls`)).toBeNull();

    await enterCustomize(el);
    expect(el.querySelector(`.${CSS_PREFIX}-row-controls`)).not.toBeNull();
  });

  it('reports the mode through aria-pressed', async () => {
    const el = await mountViewer();
    expect(toggle(el).getAttribute('aria-pressed')).toBe('false');
    await enterCustomize(el);
    expect(toggle(el).getAttribute('aria-pressed')).toBe('true');
  });

  // The whole reason for inline editing over a panel or modal: the tracks
  // must not move when you start arranging them.
  it('does not shift the visualization when the mode opens', async () => {
    const el = await mountViewer();
    const before = el
      .querySelector('nightingale-manager')!
      .getBoundingClientRect().top;
    await enterCustomize(el);
    const after = el
      .querySelector('nightingale-manager')!
      .getBoundingClientRect().top;
    expect(after).toBe(before);
  });

  // The mode wraps each row in a different template, so Lit rebuilds the row
  // subtrees — Nightingale elements included. Without a data re-push on that
  // tick every track blanks out the instant you press Customize.
  it('keeps the tracks drawn when the mode opens', async () => {
    const el = await mountViewer();
    const data = () =>
      Array.from(
        el.querySelectorAll<HTMLElement & { data?: unknown }>(
          `.${CSS_PREFIX}-track-content > *`
        )
      ).filter((n) => Array.isArray(n.data) && n.data.length > 0).length;

    const before = data();
    expect(before).toBeGreaterThan(0);

    await enterCustomize(el);
    // `_loadDataInComponents` awaits a frame, so the push lands a tick after
    // the render it was triggered by.
    await vi.waitFor(() => {
      expect(data()).toBeGreaterThanOrEqual(before);
    });
  });

  // A group's header row is display:none until its aggregate loads, and that
  // header is where the row's controls live.
  it('shows controls for every row, including groups with no aggregate', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    for (const id of ['DOMAINS', 'PTM', 'sites']) {
      const row = el.querySelector(`#${CSS_PREFIX}-group_${id}`)!;
      expect(row.querySelector(`.${CSS_PREFIX}-row-controls`)).not.toBeNull();
      expect(getComputedStyle(row).display).not.toBe('none');
    }
  });

  it('Done leaves the mode and returns focus to the toggle', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    const done = Array.from(
      el.querySelectorAll<HTMLButtonElement>(`.${CSS_PREFIX}-customize-action`)
    ).find((b) => b.textContent!.trim() === 'Done')!;

    done.click();
    await el.updateComplete;
    expect(toggle(el).getAttribute('aria-pressed')).toBe('false');
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(toggle(el));
    });
  });

  it('gates Reset to default until something has actually been changed', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    const reset = () =>
      Array.from(
        el.querySelectorAll<HTMLButtonElement>(`.${CSS_PREFIX}-customize-action`)
      ).find((b) => b.textContent!.trim() === 'Reset to default')!;
    expect(reset().disabled).toBe(true);

    el.setRowVisibility('PTM', false);
    await el.updateComplete;
    expect(reset().disabled).toBe(false);

    reset().click();
    await el.updateComplete;
    expect(laneIds(el)).toContain('PTM');
  });

  it('has no axe violations while customizing', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    await expectNoA11yViolations(el);
  });

  it('puts Toggle all, Reset to default and Done on the Customize line, right-aligned', async () => {
    const el = await mountViewer();
    // Wide enough for the whole toolbar on one line; the test page is narrow.
    el.style.setProperty('--protvista-label-width', '480px');
    await enterCustomize(el);
    const line = toggle(el).closest(`.${CSS_PREFIX}-toolbar-row`)!;
    const actions = Array.from(
      line.querySelectorAll<HTMLButtonElement>(`.${CSS_PREFIX}-customize-action`)
    );
    expect(actions.map((b) => b.textContent!.trim())).toEqual([
      'Toggle all off',
      'Reset to default',
      'Done',
    ]);
    // Done ends flush with the line — the group is pushed right.
    const lineBox = line.getBoundingClientRect();
    const doneBox = actions[2].getBoundingClientRect();
    expect(Math.round(lineBox.right - doneBox.right)).toBeLessThanOrEqual(1);
    const toggleBox = toggle(el).getBoundingClientRect();
    expect(doneBox.left).toBeGreaterThan(toggleBox.right);
    // Same line as the toggle, not wrapped below it.
    expect(Math.abs(actions[0].getBoundingClientRect().top - toggleBox.top)).toBeLessThanOrEqual(2);
  });

  // The default label column is 20vw — ~220px on a 1100px screen — and the
  // whole line still has to fit, tightened rather than wrapped.
  it('keeps all four buttons on one line in a narrow label column', async () => {
    const el = await mountViewer();
    el.style.setProperty('--protvista-label-width', '220px');
    await enterCustomize(el);
    const line = toggle(el).closest(`.${CSS_PREFIX}-toolbar-row`)!;
    const lineBox = line.getBoundingClientRect();
    const buttons = Array.from(line.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent!.trim()).slice(1)).toEqual([
      'Toggle all off',
      'Reset to default',
      'Done',
    ]);
    const top = toggle(el).getBoundingClientRect().top;
    for (const b of buttons) {
      const box = b.getBoundingClientRect();
      expect(Math.abs(box.top - top)).toBeLessThanOrEqual(2);
      expect(box.right).toBeLessThanOrEqual(lineBox.right + 0.5);
    }
    // The pressed toggle drops to its icon here, but keeps its name.
    expect(toggle(el).textContent!.trim()).toBe('Customize');
  });

  it('Toggle all names the way it will go, and hides or shows everything', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    const showHideAll = () =>
      Array.from(
        el.querySelectorAll<HTMLButtonElement>(`.${CSS_PREFIX}-customize-action`)
      ).find((b) => /^Toggle all (on|off)$/.test(b.textContent!.trim()))!;

    // Nothing hidden yet, so the label offers the action that would change
    // that.
    expect(showHideAll().textContent!.trim()).toBe('Toggle all off');

    showHideAll().click();
    await el.updateComplete;
    expect(showHideAll().textContent!.trim()).toBe('Toggle all on');
    await enterCustomize(el); // close, so the hides actually leave the canvas
    expect(laneIds(el)).toEqual([]);

    await enterCustomize(el); // reopen
    showHideAll().click();
    await el.updateComplete;
    expect(showHideAll().textContent!.trim()).toBe('Toggle all off');
    await enterCustomize(el); // close
    expect(laneIds(el)).toEqual(['DOMAINS', 'PTM', 'sites']);
  });
});

describe('show / hide', () => {
  it('flips the switch off and ghosts the row', async () => {
    const el = await mountViewer();
    await enterCustomize(el);

    const sw = rowSwitch(el, 'PTM');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('aria-label')).toBe('Show Modifications');
    sw.click();
    await el.updateComplete;

    const row = el.querySelector(`#${CSS_PREFIX}-group_PTM`)!;
    // Ghosted, not blanked: the features stay on screen, desaturated, so the
    // user can see what they would be restoring.
    expect(row.classList.contains(`${CSS_PREFIX}-row--ghost`)).toBe(true);
    // The name is the purpose and does not flip; only the state does.
    expect(rowSwitch(el, 'PTM').getAttribute('aria-checked')).toBe('false');
    expect(rowSwitch(el, 'PTM').getAttribute('aria-label')).toBe(
      'Show Modifications'
    );
  });

  // WCAG 1.4.1: state rides on the thumb's position, not on colour.
  it('moves the thumb, so state is not carried by colour alone', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    const thumb = () =>
      getComputedStyle(
        rowSwitch(el, 'PTM').querySelector(`.${CSS_PREFIX}-switch__thumb`)!
      ).transform;

    const on = thumb();
    rowSwitch(el, 'PTM').click();
    await el.updateComplete;
    // The thumb slides over ~120ms, so the computed transform is still
    // mid-interpolation on the tick the render finishes.
    await vi.waitFor(() => {
      expect(thumb()).not.toBe(on);
    });
  });

  it('announces the toggle in the live region', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    rowSwitch(el, 'PTM').click();
    await el.updateComplete;
    expect(liveRegionText(el)).toBe('Modifications hidden.');
  });

  it('removes the row from the canvas once the mode is closed', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    rowSwitch(el, 'PTM').click();
    await el.updateComplete;

    await enterCustomize(el); // toggles back off
    expect(laneIds(el)).not.toContain('PTM');
  });

  it('reports the hidden count below the toggle', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    rowSwitch(el, 'PTM').click();
    await el.updateComplete;
    const status = el.querySelector(`.${CSS_PREFIX}-change-status`)!;
    expect(status.textContent).toContain('1 track hidden');
    expect(status.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      toggle(el).getBoundingClientRect().bottom
    );
  });

  it('says so instead of rendering an empty frame when everything is hidden', async () => {
    const el = await mountViewer();
    for (const id of ['DOMAINS', 'PTM', 'sites']) el.setRowVisibility(id, false);
    await el.updateComplete;

    const notice = el.querySelector(`.${CSS_PREFIX}-all-hidden`)!;
    expect(notice.textContent).toContain('All tracks are hidden');
    expect(notice.textContent).toContain('Open Customize');
    // No button of its own — Reset and Toggle all already live in Customize,
    // and a second Reset out here would be one more place for it to drift.
    expect(notice.querySelector('button')).toBeNull();

    await enterCustomize(el);
    const showAll = Array.from(
      el.querySelectorAll<HTMLButtonElement>(`.${CSS_PREFIX}-customize-action`)
    ).find((b) => b.textContent!.trim() === 'Toggle all on')!;
    showAll.click();
    await el.updateComplete;
    await enterCustomize(el); // close, so the shows actually land on the canvas
    expect(laneIds(el)).toEqual(['DOMAINS', 'PTM', 'sites']);
  });
});

describe('move up / down', () => {
  // WCAG 2.5.7: reordering must not require a drag.
  it('reorders rows without a pointer drag', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    expect(laneIds(el)).toEqual(['DOMAINS', 'PTM', 'sites']);

    control(el, 'PTM', 'Move Modifications down').click();
    await el.updateComplete;
    expect(laneIds(el)).toEqual(['DOMAINS', 'sites', 'PTM']);
  });

  it('disables the move that would run off the end', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    expect(control(el, 'DOMAINS', 'Move Domains up').disabled).toBe(true);
    expect(control(el, 'DOMAINS', 'Move Domains down').disabled).toBe(false);
  });

  it('announces the new position', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    control(el, 'PTM', 'Move Modifications down').click();
    await el.updateComplete;
    expect(liveRegionText(el)).toBe('Modifications moved to position 3 of 3.');
  });

  it('reorders tracks within their own group', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    trackControl(el, 'region', 'Move Region up').click();
    await el.updateComplete;
    const trackIds = Array.from(
      el.querySelectorAll(`#${CSS_PREFIX}-group_DOMAINS ~ .${CSS_PREFIX}-group__track`)
    ).map((d) => d.id.replace(`${CSS_PREFIX}-track_`, ''));
    expect(trackIds.slice(0, 2)).toEqual(['region', 'domain']);
  });
});

// Tracks with no data are absent from the canvas whatever the toggle says, so
// offering a working Show would be a button that visibly does nothing.
describe('tracks with no data', () => {
  it('shows a not-applicable sign in place of the switch, with the reason as its name', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    expect(trackSwitch(el, 'empty')).toBeNull();
    const sign = el.querySelector(
      `#${CSS_PREFIX}-track_empty .${CSS_PREFIX}-no-data`
    )!;
    expect(sign.getAttribute('role')).toBe('img');
    // Not a control, so nothing to tab to — the reason is its name.
    expect(sign.getAttribute('aria-label')).toContain('no data');
    expect(sign.getAttribute('title')).toContain('no data');
    // Same footprint as a switch, so the move buttons stay in column.
    const signBox = sign.getBoundingClientRect();
    const swBox = trackSwitch(el, 'domain').getBoundingClientRect();
    expect(signBox.width).toBeCloseTo(swBox.width, 0);
  });

  it('leaves its move controls working', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    expect(trackControl(el, 'empty', 'Move Empty up').disabled).toBe(false);
  });

  it('is left out of the hidden count', async () => {
    const el = await mountViewer();
    // Only the dataless track has nothing to draw, so nothing is
    // *user*-hidden and the status should say nothing at all.
    await enterCustomize(el);
    expect(
      el.querySelector(`.${CSS_PREFIX}-change-status`)!.textContent!.trim()
    ).toBe('');
  });
});

describe('the change status', () => {
  const badge = (el: Viewer) =>
    el.querySelector<HTMLButtonElement>(`.${CSS_PREFIX}-change-status`);

  // Hiding a group of several and hiding one track are not both "1 hidden";
  // the badge answers "how much am I not seeing".
  it('counts tracks, not toggles, when a whole group is hidden', async () => {
    const el = await mountViewer();
    el.setRowVisibility('DOMAINS', false);
    await enterCustomize(el);
    // DOMAINS holds three tracks, one of which has no data and is excluded.
    expect(badge(el)!.textContent).toContain('2 tracks hidden');
  });

  it('counts an individually hidden track as one', async () => {
    const el = await mountViewer();
    el.setTrackVisibility('DOMAINS', 'domain', false);
    await enterCustomize(el);
    // Singular, so it reads as a sentence rather than a stat.
    expect(badge(el)!.textContent).toContain('1 track hidden');
  });

  it('says only "Modified view" outside the mode, and how to see more', async () => {
    const el = await mountViewer();
    el.setRowVisibility('PTM', false);
    await el.updateComplete;
    expect(badge(el)!.tagName).toBe('BUTTON');
    expect(badge(el)!.textContent!.trim()).toBe('Modified view');
    const hint = badge(el)!.getAttribute('title')!;
    expect(hint).toContain('Customize');
    // The same text is the accessible name, so the hint is not mouse-only.
    expect(badge(el)!.getAttribute('aria-label')).toBe(hint);
  });

  it('opens customize mode when pressed', async () => {
    const el = await mountViewer();
    el.setRowVisibility('PTM', false);
    await el.updateComplete;

    badge(el)!.click();
    await el.updateComplete;
    expect(toggle(el).getAttribute('aria-pressed')).toBe('true');
  });

  // Entering the mode is not enough: a hidden group collapses to one stub, so
  // the hidden tracks would still be nowhere on screen.
  it('opens the hidden group so its tracks are reachable', async () => {
    const el = await mountViewer();
    el.openGroups = [];
    el.setRowVisibility('DOMAINS', false);
    await el.updateComplete;
    // Collapsed and hidden: only the group's own stub is on screen.
    expect(el.querySelector(`#${CSS_PREFIX}-track_domain`)).toBeNull();

    badge(el)!.click();
    await el.updateComplete;

    const track = el.querySelector(`#${CSS_PREFIX}-track_domain`)!;
    expect(track).not.toBeNull();
    expect(track.classList.contains(`${CSS_PREFIX}-row--ghost`)).toBe(true);
    // And it carries a working Show, so one track of a hidden group can be
    // restored on its own.
    const sw = trackSwitch(el, 'domain');
    expect(sw.disabled).toBe(false);

    sw.click();
    await el.updateComplete;
    expect(laneIds(el)).toContain('DOMAINS');
  });

  it('opens a visible group that merely contains a hidden track', async () => {
    const el = await mountViewer();
    el.openGroups = [];
    el.setTrackVisibility('DOMAINS', 'domain', false);
    await el.updateComplete;

    badge(el)!.click();
    await el.updateComplete;
    expect(el.openGroups).toContain('DOMAINS');
  });

  it('opens a group whose tracks were reordered', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    trackControl(el, 'region', 'Move Region up').click();
    await enterCustomize(el); // close
    el.openGroups = [];
    await el.updateComplete;

    badge(el)!.click();
    await el.updateComplete;
    expect(el.openGroups).toContain('DOMAINS');
  });

  it('leaves already-open groups alone', async () => {
    const el = await mountViewer();
    el.setRowVisibility('DOMAINS', false);
    await el.updateComplete;
    const before = [...el.openGroups!];

    badge(el)!.click();
    await el.updateComplete;
    expect(el.openGroups).toEqual(before);
  });
});

describe('the moved asterisk', () => {
  const marks = (el: Viewer) =>
    Array.from(
      el.querySelectorAll(`.${CSS_PREFIX}-row-controls .${CSS_PREFIX}-moved-mark`)
    );

  it('marks the row the user moved, not the one it stepped past', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    control(el, 'PTM', 'Move Modifications down').click();
    await el.updateComplete;
    expect(marks(el)).toHaveLength(1);
    expect(marks(el)[0].closest(`#${CSS_PREFIX}-group_PTM`)).not.toBeNull();
    expect(
      el.querySelector(`.${CSS_PREFIX}-change-status`)!.textContent!.replace(/\s+/g, ' ')
    ).toContain('1 track moved *');
  });

  it('sits immediately left of the switch, vertically centred on it', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    control(el, 'PTM', 'Move Modifications down').click();
    await el.updateComplete;
    const mark = marks(el)[0] as HTMLElement;
    const sw = rowSwitch(el, 'PTM');
    expect(mark.nextElementSibling).toBe(sw);
    const m = mark.getBoundingClientRect();
    const s = sw.getBoundingClientRect();
    expect(m.right).toBeLessThanOrEqual(s.left);
    expect(Math.abs((m.top + m.bottom) / 2 - (s.top + s.bottom) / 2)).toBeLessThanOrEqual(2);
  });

  it('clears when the row is moved back, and on reset', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    control(el, 'PTM', 'Move Modifications down').click();
    await el.updateComplete;
    control(el, 'PTM', 'Move Modifications up').click();
    await el.updateComplete;
    expect(marks(el)).toHaveLength(0);

    trackControl(el, 'region', 'Move Region up').click();
    await el.updateComplete;
    expect(marks(el)).toHaveLength(1);
    Array.from(
      el.querySelectorAll<HTMLButtonElement>(`.${CSS_PREFIX}-customize-action`)
    )
      .find((b) => b.textContent!.trim() === 'Reset to default')!
      .click();
    await el.updateComplete;
    expect(marks(el)).toHaveLength(0);
  });
});

describe('the just-moved highlight', () => {
  it('marks the row that moved', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    control(el, 'PTM', 'Move Modifications down').click();
    await el.updateComplete;

    const moved = el.querySelectorAll(`.${CSS_PREFIX}-row--moved`);
    expect(moved).toHaveLength(1);
    expect(moved[0].id).toBe(`${CSS_PREFIX}-group_PTM`);
  });

  it('marks only the most recent move', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    control(el, 'PTM', 'Move Modifications down').click();
    await el.updateComplete;
    control(el, 'DOMAINS', 'Move Domains down').click();
    await el.updateComplete;

    const moved = el.querySelectorAll(`.${CSS_PREFIX}-row--moved`);
    expect(moved).toHaveLength(1);
    expect(moved[0].id).toBe(`${CSS_PREFIX}-group_DOMAINS`);
  });

  // The pressed button is disabled once the row lands at an end, so focus
  // has to go somewhere rather than fall back to <body>.
  it('hands focus to the opposite move button at the ends', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    const down = control(el, 'PTM', 'Move Modifications down');
    down.click();
    await el.updateComplete;

    expect(down.disabled).toBe(true);
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        control(el, 'PTM', 'Move Modifications up')
      );
    });
  });
});
