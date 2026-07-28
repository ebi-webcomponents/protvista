/**
 * End-to-end coverage for "Customize layout" on `<protvista-uniprot>` in a
 * real browser: the inline per-row controls, their keyboard and pointer
 * operation, drag-to-reorder, and the accessibility contract from #173.
 *
 * A real mount is what makes this worth running in a browser rather than
 * jsdom — focus actually moves, `aria-pressed` is actually computed, drag
 * events actually carry a `dataTransfer`, and axe has a real layout to
 * inspect. The pure ordering logic is covered in `src/__spec__/layout.spec.ts`
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
  updateComplete: Promise<unknown>;
};

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      const body = url.includes('/proteins/api/proteins/')
        ? { sequence: { sequence: 'MSEQENCE' } }
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

/**
 * A `clientY` just below or just above `target`'s midpoint — which is the
 * line the drop index is computed against. Offsetting from the midpoint
 * rather than using a fraction of the height keeps this correct even though
 * the stubbed Nightingale elements give the rows no real height here.
 */
function midpointY(target: Element, half: 'upper' | 'lower'): number {
  const rect = target.getBoundingClientRect();
  return rect.top + rect.height / 2 + (half === 'lower' ? 1 : -1);
}

/** Fire a drag sequence from `source` onto the given half of `target`. */
async function dragOnto(
  el: Viewer,
  source: Element,
  target: Element,
  half: 'upper' | 'lower'
): Promise<void> {
  const dataTransfer = new DataTransfer();
  source.dispatchEvent(
    new DragEvent('dragstart', { bubbles: true, dataTransfer })
  );
  await el.updateComplete;

  target.dispatchEvent(
    new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientY: midpointY(target, half),
    })
  );
  await el.updateComplete;

  target.dispatchEvent(
    new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })
  );
  await el.updateComplete;
}

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
  it('hides a row and leaves a labelled Show control in its place', async () => {
    const el = await mountViewer();
    await enterCustomize(el);

    const hide = control(el, 'PTM', 'Hide');
    expect(hide.getAttribute('aria-label')).toBe('Hide Modifications');
    hide.click();
    await el.updateComplete;

    const stub = el.querySelector(`#${CSS_PREFIX}-group_PTM`)!;
    expect(stub.classList.contains(`${CSS_PREFIX}-row--stub`)).toBe(true);
    const show = control(el, 'PTM', 'Show');
    expect(show.getAttribute('aria-pressed')).toBe('true');
    expect(show.getAttribute('aria-label')).toBe('Show Modifications');
  });

  // WCAG 1.4.1: the eye glyph alone would carry the state by shape/colour.
  it('states the action in words, not only in the icon', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    expect(control(el, 'PTM', 'Hide').textContent).toContain('Hide');
  });

  it('announces the toggle in the live region', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    control(el, 'PTM', 'Hide').click();
    await el.updateComplete;
    expect(liveRegionText(el)).toBe('Modifications hidden.');
  });

  it('removes the row from the canvas once the mode is closed', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    control(el, 'PTM', 'Hide').click();
    await el.updateComplete;

    await enterCustomize(el); // toggles back off
    expect(laneIds(el)).not.toContain('PTM');
  });

  it('reports the hidden count beside the toggle', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    control(el, 'PTM', 'Hide').click();
    await el.updateComplete;
    expect(
      el.querySelector(`.${CSS_PREFIX}-hidden-count`)!.textContent
    ).toContain('1 hidden');
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

describe('drag to reorder', () => {
  it('opens a placeholder gap where the row would land', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    const grip = control(el, 'DOMAINS', 'Reorder');
    const dataTransfer = new DataTransfer();

    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    await el.updateComplete;

    const target = el.querySelector(`#${CSS_PREFIX}-group_sites`)!;
    target.dispatchEvent(
      new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientY: midpointY(target, 'lower'),
      })
    );
    await el.updateComplete;

    expect(el.querySelectorAll(`.${CSS_PREFIX}-drop-gap`)).toHaveLength(1);
  });

  // The old top-edge marker only ever inserted *before* a row, so the last
  // position could not be reached by dragging at all.
  it('can drop past the last row', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    await dragOnto(
      el,
      control(el, 'DOMAINS', 'Reorder'),
      el.querySelector(`#${CSS_PREFIX}-group_sites`)!,
      'lower'
    );
    expect(laneIds(el)).toEqual(['PTM', 'sites', 'DOMAINS']);
  });

  it('drops before a row when the pointer is in its upper half', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    await dragOnto(
      el,
      control(el, 'sites', 'Reorder'),
      el.querySelector(`#${CSS_PREFIX}-group_PTM`)!,
      'upper'
    );
    expect(laneIds(el)).toEqual(['DOMAINS', 'sites', 'PTM']);
  });

  // A nested config cannot express a track that left its group, so the drop
  // is refused rather than silently reinterpreted.
  it('refuses to drop a track outside its own group', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    const grip = trackControl(el, 'domain', 'Reorder');

    const dataTransfer = new DataTransfer();
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    await el.updateComplete;

    const foreign = el.querySelector(`#${CSS_PREFIX}-track_glyco`)!;
    const over = new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientY: midpointY(foreign, 'lower'),
    });
    foreign.dispatchEvent(over);
    await el.updateComplete;

    // Not accepted, and no gap offered.
    expect(over.defaultPrevented).toBe(false);
    expect(el.querySelectorAll(`.${CSS_PREFIX}-drop-gap`)).toHaveLength(0);
  });

  // The old implementation drove its marker from dragenter/dragleave, which
  // fire as the pointer crosses a row's own children — so it flickered.
  it('keeps the gap steady while the pointer crosses a row’s children', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    const grip = control(el, 'DOMAINS', 'Reorder');
    const dataTransfer = new DataTransfer();
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    await el.updateComplete;

    const target = el.querySelector(`#${CSS_PREFIX}-group_sites`)!;
    const clientY = midpointY(target, 'lower');
    const label = target.querySelector(`.${CSS_PREFIX}-track-label`)!;

    for (const node of [target, label, target.querySelector('button')!, label]) {
      node.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientY,
        })
      );
      await el.updateComplete;
      expect(el.querySelectorAll(`.${CSS_PREFIX}-drop-gap`)).toHaveLength(1);
    }
  });

  it('clears the gap when the drag ends without a drop', async () => {
    const el = await mountViewer();
    await enterCustomize(el);
    const grip = control(el, 'DOMAINS', 'Reorder');
    const dataTransfer = new DataTransfer();
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    await el.updateComplete;

    grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
    await el.updateComplete;
    expect(el.querySelectorAll(`.${CSS_PREFIX}-drop-gap`)).toHaveLength(0);
    expect(laneIds(el)).toEqual(['DOMAINS', 'PTM', 'sites']);
  });
});
