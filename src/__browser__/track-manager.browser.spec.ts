/**
 * Real-DOM accessibility + interaction coverage for the "Customize layout"
 * Track Manager (issue #199), in its flat per-track form: every track can be
 * shown/hidden and reordered individually, a group header reorders/hides the
 * whole group, and a track moved out of its group renders as "Group / Track".
 *
 * Two layers: `<protvista-track-manager>` in isolation (a11y, roving grid,
 * reorder + visibility events), and `<protvista-uniprot>` end to end (the
 * panel drives the real canvas). Mounts for real (Playwright/Chromium) and
 * asserts with axe-core.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { userEvent } from 'vitest/browser';

import '../protvista-track-manager';
import type { ProtvistaTrackManager } from '../protvista-track-manager';
import '../protvista-uniprot';
import type { NormalizedRow } from '../schema/normalize';
import type { ViewerLayout } from '../schema/types';
import { CSS_PREFIX } from '../styles/css-prefix';
import { mount } from './mount';
import { expectNoA11yViolations } from './axe';

// ── Fixtures ────────────────────────────────────────────────

const canvas = 'nightingale-track-canvas';
const t = (id: string, label: string): unknown => ({
  id,
  label,
  component: canvas,
  rendering: {},
  data: [],
});
// DOMAINS group (domain, region) + a standalone "sites" track.
const ROWS = [
  {
    id: 'DOMAINS',
    label: 'Domains',
    component: canvas,
    rendering: {},
    tracks: [t('domain', 'Domain'), t('region', 'Region')],
  },
  {
    id: 'sites',
    label: 'Sites',
    component: canvas,
    rendering: {},
    standalone: true,
    tracks: [t('sites', 'Sites')],
  },
] as unknown as NormalizedRow[];

type Mgr = ProtvistaTrackManager;

async function mountManager(layout: ViewerLayout): Promise<Mgr> {
  const el = mount<Mgr>('protvista-track-manager');
  el.rows = ROWS;
  el.layout = layout;
  await el.updateComplete;
  return el;
}

const byKey = (el: Mgr, key: string) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(`button[data-key="${key}"]`)!;

const tabbable = (el: Mgr) =>
  el.shadowRoot!.querySelectorAll<HTMLButtonElement>(
    'button[data-key][tabindex="0"]'
  );

const activeKey = (el: Mgr) =>
  (el.shadowRoot!.activeElement as HTMLElement | null)?.dataset.key;

const detailOf = <T,>(el: Mgr, type: string): Promise<T> =>
  new Promise((res) =>
    el.addEventListener(type, (e) => res((e as CustomEvent).detail), {
      once: true,
    })
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<protvista-track-manager> — accessibility semantics', () => {
  it('has no axe violations (with a hidden track shown in place)', async () => {
    const el = await mountManager({ order: null, hidden: { 'DOMAINS-region': true } });
    await expectNoA11yViolations(el);
  });

  it('labels the group and track toggles with aria-pressed', async () => {
    const el = await mountManager({ order: null, hidden: { 'DOMAINS-region': true } });
    // The group header hide toggle.
    const group = byKey(el, 'GT:DOMAINS-domain');
    expect(group.getAttribute('aria-pressed')).toBe('false');
    expect(group.getAttribute('aria-label')).toBe('Hide Domains');
    // A visible track toggle.
    const domain = byKey(el, 'T:DOMAINS-domain');
    expect(domain.getAttribute('aria-label')).toBe('Hide Domain');
    // The hidden region track stays in place with a Show toggle (same key).
    const region = byKey(el, 'T:DOMAINS-region');
    expect(region.getAttribute('aria-pressed')).toBe('true');
    expect(region.getAttribute('aria-label')).toBe('Show Region');
  });

  it('keeps a hidden track in place (dimmed, Show-only), no bottom section', async () => {
    const el = await mountManager({ order: null, hidden: { 'DOMAINS-region': true } });
    // No separate "Hidden tracks" section.
    expect(
      el.shadowRoot!.querySelector('section[aria-label="Hidden tracks"]')
    ).toBeNull();
    // The region row is dimmed and offers only a Show toggle (no reorder).
    const region = byKey(el, 'T:DOMAINS-region');
    expect(region.closest('.row')!.classList.contains('row--hidden')).toBe(true);
    expect(
      el.shadowRoot!.querySelector('button[data-key="U:DOMAINS-region"]')
    ).toBeNull();
    expect(
      el.shadowRoot!.querySelector('button[data-key="H:DOMAINS-region"]')
    ).toBeNull();
    // The header shows a count.
    expect(el.shadowRoot!.querySelector('.panel__count')!.textContent).toContain(
      '1 hidden'
    );
  });

  it('groups the Reset control beside the title', async () => {
    const el = await mountManager({ order: null, hidden: {} });
    const head = el.shadowRoot!.querySelector<HTMLElement>('.panel__head')!;
    expect(head.children[0].classList.contains('panel__title')).toBe(true);
    expect(head.children[1].classList.contains('reset')).toBe(true);
    expect(getComputedStyle(head).justifyContent).toBe('flex-start');
  });
});

describe('<protvista-track-manager> — panel actions', () => {
  it('disables Reset until the layout is edited', async () => {
    const clean = await mountManager({ order: null, hidden: {} });
    expect(
      clean.shadowRoot!.querySelector<HTMLButtonElement>('button.reset')!.disabled
    ).toBe(true);

    const edited = await mountManager({
      order: null,
      hidden: { 'DOMAINS-region': true },
    });
    expect(
      edited.shadowRoot!.querySelector<HTMLButtonElement>('button.reset')!
        .disabled
    ).toBe(false);
  });

  it('emits customize-close from the Done button', async () => {
    const el = await mountManager({ order: null, hidden: {} });
    const fired = detailOf<unknown>(el, 'customize-close');
    await userEvent.click(
      el.shadowRoot!.querySelector<HTMLButtonElement>('button.done')!
    );
    await fired;
    expect(true).toBe(true);
  });
});

describe('<protvista-track-manager> — roving-tabindex grid', () => {
  it('keeps one control tabbable and navigates rows + controls with arrows', async () => {
    const el = await mountManager({ order: null, hidden: {} });
    expect(tabbable(el).length).toBe(1);
    // The first control is the group header's hide toggle.
    expect(tabbable(el)[0].dataset.key).toBe('GT:DOMAINS-domain');

    byKey(el, 'GT:DOMAINS-domain').focus();
    // Right moves within the header row (hide → move-down → grip).
    await userEvent.keyboard('{ArrowRight}');
    await el.updateComplete;
    expect(activeKey(el)).toBe('GD:DOMAINS-domain');
    await userEvent.keyboard('{ArrowRight}');
    await el.updateComplete;
    expect(activeKey(el)).toBe('GH:DOMAINS-domain');

    // Home (to the first control), then Down steps through the rows' toggles.
    await userEvent.keyboard('{Home}');
    await el.updateComplete;
    expect(activeKey(el)).toBe('GT:DOMAINS-domain');
    await userEvent.keyboard('{ArrowDown}');
    await el.updateComplete;
    expect(activeKey(el)).toBe('T:DOMAINS-domain');

    // End jumps to the last row (the standalone), Home back to the top.
    await userEvent.keyboard('{End}');
    await el.updateComplete;
    expect(activeKey(el)).toBe('T:sites-sites');
    await userEvent.keyboard('{Home}');
    await el.updateComplete;
    expect(activeKey(el)).toBe('GT:DOMAINS-domain');
  });
});

describe('<protvista-track-manager> — reorder', () => {
  it('disables move-up on the first track and move-down on the last', async () => {
    const el = await mountManager({ order: null, hidden: {} });
    expect(byKey(el, 'U:DOMAINS-domain').disabled).toBe(true); // first visible
    expect(byKey(el, 'D:sites-sites').disabled).toBe(true); // last visible
    expect(byKey(el, 'GU:DOMAINS-domain').disabled).toBe(true); // first block
  });

  it('moves a single track down (pulling it out of its group)', async () => {
    const el = await mountManager({ order: null, hidden: {} });
    const order = detailOf<{ order: string[] }>(el, 'track-order-change');
    await userEvent.click(byKey(el, 'D:DOMAINS-region'));
    // region swaps past the standalone sites track.
    expect((await order).order).toEqual([
      'DOMAINS-domain',
      'sites-sites',
      'DOMAINS-region',
    ]);
  });

  it('moves a whole group down via its header', async () => {
    const el = await mountManager({ order: null, hidden: {} });
    const order = detailOf<{ order: string[] }>(el, 'track-order-change');
    await userEvent.click(byKey(el, 'GD:DOMAINS-domain'));
    // The DOMAINS block moves past the sites block.
    expect((await order).order).toEqual([
      'sites-sites',
      'DOMAINS-domain',
      'DOMAINS-region',
    ]);
  });

  it('reorders via drag-and-drop (drop one track onto another)', async () => {
    const el = await mountManager({ order: null, hidden: {} });
    const order = detailOf<{ order: string[] }>(el, 'track-order-change');
    const dt = new DataTransfer();
    byKey(el, 'H:sites-sites').dispatchEvent(
      new DragEvent('dragstart', { dataTransfer: dt, bubbles: true })
    );
    const target = byKey(el, 'T:DOMAINS-domain').closest('.row')!;
    target.dispatchEvent(
      new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
    );
    // sites moves to sit before DOMAINS-domain.
    expect((await order).order).toEqual([
      'sites-sites',
      'DOMAINS-domain',
      'DOMAINS-region',
    ]);
  });
});

describe('<protvista-track-manager> — visibility events', () => {
  it('emits track-visibility-toggle for a grouped track', async () => {
    const el = await mountManager({ order: null, hidden: {} });
    const detail = detailOf<{ groupId: string; trackId: string; visible: boolean }>(
      el,
      'track-visibility-toggle'
    );
    await userEvent.click(byKey(el, 'T:DOMAINS-domain'));
    expect(await detail).toEqual({
      groupId: 'DOMAINS',
      trackId: 'domain',
      visible: false,
    });
  });

  it('emits row-visibility-toggle from the group header and a standalone', async () => {
    const el = await mountManager({ order: null, hidden: {} });
    const grp = detailOf<{ rowId: string; visible: boolean }>(
      el,
      'row-visibility-toggle'
    );
    await userEvent.click(byKey(el, 'GT:DOMAINS-domain'));
    expect(await grp).toEqual({ rowId: 'DOMAINS', visible: false });

    const el2 = await mountManager({ order: null, hidden: {} });
    const stand = detailOf<{ rowId: string; visible: boolean }>(
      el2,
      'row-visibility-toggle'
    );
    await userEvent.click(byKey(el2, 'T:sites-sites'));
    expect(await stand).toEqual({ rowId: 'sites', visible: false });
  });

  it('emits reset-layout from the reset control', async () => {
    const el = await mountManager({ order: null, hidden: { 'DOMAINS-region': true } });
    const fired = detailOf<unknown>(el, 'reset-layout');
    const reset = el.shadowRoot!.querySelector<HTMLButtonElement>('button.reset')!;
    await userEvent.click(reset);
    await fired;
    expect(true).toBe(true);
  });
});

// ── End-to-end through the viewer ───────────────────────────

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
    { id: 'sites', label: 'Sites', kind: 'features', data: 'https://example.org/c.json' },
  ],
};

type Viewer = HTMLElement & {
  viewerConfig?: unknown;
  accession?: string;
  noPersistLayout?: boolean;
  getLayout(): ViewerLayout;
};

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      const body = url.includes('/proteins/api/proteins/')
        ? { sequence: { sequence: 'MSEQENCE' } }
        : [{ type: 'DOMAIN', start: 1, end: 5 }];
      return {
        ok: true,
        status: 200,
        json: async () => body,
      } as unknown as Response;
    })
  );
}

async function mountViewer(): Promise<Viewer> {
  stubFetch();
  const el = mount<Viewer>('protvista-uniprot', {
    viewerConfig: CONFIG,
    accession: 'P05067',
    // Not testing persistence here (see layout-persistence.browser.spec.ts);
    // opt out so a change cannot leak between tests.
    noPersistLayout: true,
  });
  await vi.waitFor(() => {
    if (!el.querySelector(`.${CSS_PREFIX}-customize-toggle`)) {
      throw new Error('not ready');
    }
  });
  return el;
}

const manager = (el: Viewer) =>
  el.querySelector('protvista-track-manager') as ProtvistaTrackManager | null;

async function openPanel(el: Viewer) {
  await userEvent.click(
    el.querySelector<HTMLButtonElement>(`.${CSS_PREFIX}-customize-toggle`)!
  );
  await vi.waitFor(() => {
    if (!manager(el)) throw new Error('panel not open');
  });
}

const panelBtn = (el: Viewer, key: string) =>
  manager(el)!.shadowRoot!.querySelector<HTMLButtonElement>(
    `button[data-key="${key}"]`
  )!;

describe('<protvista-uniprot> — Customize mode integration', () => {
  it('opens the Track Manager panel and is axe-clean', async () => {
    const el = await mountViewer();
    await openPanel(el);
    await expectNoA11yViolations(el);
  });

  it('the Done button closes the panel and restores focus to the toggle', async () => {
    const el = await mountViewer();
    await openPanel(el);
    const toggle = el.querySelector<HTMLElement>(
      `.${CSS_PREFIX}-customize-toggle`
    )!;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    await userEvent.click(
      manager(el)!.shadowRoot!.querySelector<HTMLButtonElement>('button.done')!
    );
    await vi.waitFor(() => {
      if (manager(el)) throw new Error('panel still open');
    });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await vi.waitFor(() => {
      if (document.activeElement !== toggle) throw new Error('focus not restored');
    });
  });

  it('hiding a whole group removes its lane from the canvas', async () => {
    const el = await mountViewer();
    await openPanel(el);
    expect(el.querySelector(`#${CSS_PREFIX}-group_DOMAINS`)).not.toBeNull();

    await userEvent.click(panelBtn(el, 'GT:DOMAINS-domain'));
    await vi.waitFor(() => {
      if (el.querySelector(`#${CSS_PREFIX}-group_DOMAINS`)) {
        throw new Error('group still on canvas');
      }
    });
    expect(el.getLayout().hidden).toEqual({ DOMAINS: true });
  });

  it('hiding every track of a group removes the group too (item 2)', async () => {
    const el = await mountViewer();
    await openPanel(el);
    expect(el.querySelector(`#${CSS_PREFIX}-group_DOMAINS`)).not.toBeNull();

    await userEvent.click(panelBtn(el, 'T:DOMAINS-domain'));
    await vi.waitFor(() => {
      if (!panelBtn(el, 'T:DOMAINS-region')) throw new Error('panel not settled');
    });
    await userEvent.click(panelBtn(el, 'T:DOMAINS-region'));

    // With no visible tracks left, the group (and its aggregate) vanishes.
    await vi.waitFor(() => {
      if (el.querySelector(`#${CSS_PREFIX}-group_DOMAINS`)) {
        throw new Error('group still on canvas');
      }
    });
    expect(el.getLayout().hidden).toEqual({
      'DOMAINS-domain': true,
      'DOMAINS-region': true,
    });

    // The fully-hidden group still lists a header ("Show"); clicking it brings
    // the whole group — both individually-hidden tracks — back to the canvas.
    await userEvent.click(panelBtn(el, 'GT:DOMAINS-domain'));
    await vi.waitFor(() => {
      if (!el.querySelector(`#${CSS_PREFIX}-group_DOMAINS`)) {
        throw new Error('group not restored');
      }
    });
    expect(el.getLayout().hidden).toEqual({});
  });

  it('moving a track out of its group renders it as "Group / Track"', async () => {
    const el = await mountViewer();
    await openPanel(el);
    // Move region down past the standalone sites → region leaves DOMAINS.
    await userEvent.click(panelBtn(el, 'D:DOMAINS-region'));
    await vi.waitFor(() => {
      const sep = el.querySelector(`#${CSS_PREFIX}-track_DOMAINS-region`);
      if (!sep) throw new Error('separated track not on canvas');
    });
    const sep = el.querySelector(`#${CSS_PREFIX}-track_DOMAINS-region`)!;
    expect(
      sep.querySelector(`.${CSS_PREFIX}-track-label`)!.textContent
    ).toContain('Domains / Region');
  });

  it('follows focus to the hidden item without scrolling (item 3)', async () => {
    const el = await mountViewer();
    await openPanel(el);
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    await userEvent.click(panelBtn(el, 'GT:DOMAINS-domain'));
    await vi.waitFor(() => {
      const ok = focusSpy.mock.calls.some(
        (args) => (args[0] as FocusOptions | undefined)?.preventScroll === true
      );
      if (!ok) throw new Error('no preventScroll focus yet');
    });
  });
});
