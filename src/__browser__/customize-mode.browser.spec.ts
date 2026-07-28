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

  it('gates Reset until something has actually been changed', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    const reset = () =>
      Array.from(
        el.querySelectorAll<HTMLButtonElement>(`.${CSS_PREFIX}-customize-action`)
      ).find((b) => b.textContent!.trim() === 'Reset')!;
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

  it('reports the hidden count beside the toggle', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    rowSwitch(el, 'PTM').click();
    await el.updateComplete;
    expect(
      el.querySelector(`.${CSS_PREFIX}-hidden-count`)!.textContent
    ).toContain('1 track hidden');
  });

  it('says so instead of rendering an empty frame when everything is hidden', async () => {
    const el = await mountViewer();
    for (const id of ['DOMAINS', 'PTM', 'sites']) el.setRowVisibility(id, false);
    await el.updateComplete;

    const notice = el.querySelector(`.${CSS_PREFIX}-all-hidden`)!;
    expect(notice.textContent).toContain('All tracks are hidden');
    notice.querySelector('button')!.click();
    await el.updateComplete;
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
  it('disables the switch, off, and puts the reason in its name', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    const sw = trackSwitch(el, 'empty');
    expect(sw.disabled).toBe(true);
    // Off follows what the reader sees: nothing is drawn.
    expect(sw.getAttribute('aria-checked')).toBe('false');
    // A disabled control cannot be tabbed to, so the reason has to live in
    // the name rather than in a description.
    expect(sw.getAttribute('aria-label')).toContain('no data');
    expect(sw.getAttribute('title')).toContain('no data');
  });

  it('leaves its move controls working', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    expect(trackControl(el, 'empty', 'Move Empty up').disabled).toBe(false);
  });

  it('is left out of the hidden count', async () => {
    const el = await mountViewer();
    // Only the dataless track exists in a hidden state, so nothing is
    // *user*-hidden and the badge should not appear at all.
    expect(el.querySelector(`.${CSS_PREFIX}-hidden-count`)).toBeNull();
  });
});

describe('the hidden count', () => {
  const badge = (el: Viewer) =>
    el.querySelector<HTMLButtonElement>(`.${CSS_PREFIX}-hidden-count`);

  // Hiding a group of several and hiding one track are not both "1 hidden";
  // the badge answers "how much am I not seeing".
  it('counts tracks, not toggles, when a whole group is hidden', async () => {
    const el = await mountViewer();
    el.setRowVisibility('DOMAINS', false);
    await el.updateComplete;
    // DOMAINS holds three tracks, one of which has no data and is excluded.
    expect(badge(el)!.textContent).toContain('2 tracks hidden');
  });

  it('counts an individually hidden track as one', async () => {
    const el = await mountViewer();
    el.setTrackVisibility('DOMAINS', 'domain', false);
    await el.updateComplete;
    // Singular, so it reads as a sentence rather than a stat.
    expect(badge(el)!.textContent).toContain('1 track hidden');
  });

  it('explains how to bring the tracks back', async () => {
    const el = await mountViewer();
    el.setRowVisibility('PTM', false);
    await el.updateComplete;
    const hint = badge(el)!.getAttribute('title')!;
    expect(hint).toContain('Customize');
    expect(hint).toContain('switch');
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
  // the tracks the badge counted would still be nowhere on screen.
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
