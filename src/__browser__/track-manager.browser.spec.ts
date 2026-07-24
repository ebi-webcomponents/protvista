/**
 * Real-DOM accessibility + interaction coverage for the "Customize layout"
 * Track Manager (issue #199 show/hide UI).
 *
 * Two layers:
 *   1. `<protvista-track-manager>` in isolation — the accessible list: axe,
 *      real `<button>` toggles with `aria-pressed` + action labels, the
 *      roving-tabindex keyboard model, the hidden-tracks section, the
 *      aria-live announcement, and the emitted intent events.
 *   2. `<protvista-uniprot>` end to end — the Customize toggle opens the
 *      panel and hiding a lane there reflows the real canvas, proving the
 *      list is the source of truth the canvas mirrors.
 *
 * jsdom can't render Shadow DOM or run roving-tabindex focus the way a
 * browser does, so these mount for real (Playwright/Chromium) and assert
 * with axe-core.
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

const toggles = (el: Mgr) =>
  Array.from(
    el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button.toggle')
  );

const byKey = (el: Mgr, key: string) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    `button[data-key="${key}"]`
  )!;

const tabbableControls = (el: Mgr) =>
  el.shadowRoot!.querySelectorAll<HTMLButtonElement>(
    'button[data-key][tabindex="0"]'
  );

const activeKey = (el: Mgr) =>
  (el.shadowRoot!.activeElement as HTMLElement | null)?.dataset.key;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<protvista-track-manager> — accessibility semantics', () => {
  it('has no axe violations (visible + hidden sections)', async () => {
    const el = await mountManager({ order: null, hidden: { sites: true } });
    await expectNoA11yViolations(el);
  });

  it('renders real toggle buttons with aria-pressed and an action label', async () => {
    const el = await mountManager({ order: null, hidden: { sites: true } });
    const domains = el.shadowRoot!.querySelector<HTMLButtonElement>(
      'button.toggle[data-key="L:DOMAINS"]'
    )!;
    // A visible lane: not pressed, action is "Hide".
    expect(domains.getAttribute('aria-pressed')).toBe('false');
    expect(domains.getAttribute('aria-label')).toBe('Hide Domains');

    const sites = el.shadowRoot!.querySelector<HTMLButtonElement>(
      'button.toggle[data-key="L:sites"]'
    )!;
    // A hidden lane lives in the Hidden section: pressed, action is "Show".
    expect(sites.getAttribute('aria-pressed')).toBe('true');
    expect(sites.getAttribute('aria-label')).toBe('Show Sites');
  });

  it('moves hidden lanes into a labelled Hidden tracks section with a count', async () => {
    const el = await mountManager({ order: null, hidden: { sites: true } });
    const hidden = el.shadowRoot!.querySelector<HTMLElement>(
      'section[aria-label="Hidden tracks"]'
    )!;
    expect(hidden).not.toBeNull();
    expect(hidden.querySelector('.hidden__badge')!.textContent).toContain('1');
  });
});

describe('<protvista-track-manager> — roving-tabindex grid keyboard', () => {
  it('keeps one control tabbable and navigates rows and controls with arrows', async () => {
    const el = await mountManager({ order: null, hidden: {} });
    // Still four show/hide toggles (DOMAINS, its two tracks, the standalone).
    expect(toggles(el).length).toBe(4);
    // Exactly one control is tabbable; it is the first lane's drag handle.
    expect(tabbableControls(el).length).toBe(1);
    expect(tabbableControls(el)[0].dataset.key).toBe('H:DOMAINS');

    byKey(el, 'H:DOMAINS').focus();
    expect(activeKey(el)).toBe('H:DOMAINS');

    // Left/Right move within the row: handle → move-down → toggle. (Move-up
    // is disabled on the first lane, so it is skipped.)
    await userEvent.keyboard('{ArrowRight}');
    await el.updateComplete;
    expect(activeKey(el)).toBe('D:DOMAINS');
    await userEvent.keyboard('{ArrowRight}');
    await el.updateComplete;
    expect(activeKey(el)).toBe('L:DOMAINS');

    // Down moves to the next row (a child track), clamping the column.
    await userEvent.keyboard('{ArrowDown}');
    await el.updateComplete;
    expect(activeKey(el)).toBe('T:DOMAINS:domain');

    // End jumps to the last row's first control; Home back to the top.
    await userEvent.keyboard('{End}');
    await el.updateComplete;
    expect(activeKey(el)).toBe('H:sites');
    await userEvent.keyboard('{Home}');
    await el.updateComplete;
    expect(activeKey(el)).toBe('H:DOMAINS');
  });
});

describe('<protvista-track-manager> — reorder controls', () => {
  it('disables move-up on the first lane and move-down on the last', async () => {
    const el = await mountManager({ order: null, hidden: {} });
    expect(byKey(el, 'U:DOMAINS').disabled).toBe(true);
    expect(byKey(el, 'D:sites').disabled).toBe(true);
    // The interior directions stay enabled.
    expect(byKey(el, 'D:DOMAINS').disabled).toBe(false);
    expect(byKey(el, 'U:sites').disabled).toBe(false);
  });

  it('emits a reordered list and announces when moving a lane down', async () => {
    const el = await mountManager({ order: null, hidden: {} });
    const order = new Promise<string[]>((res) =>
      el.addEventListener(
        'row-order-change',
        (e) => res((e as CustomEvent).detail.order),
        { once: true }
      )
    );
    await userEvent.click(byKey(el, 'D:DOMAINS'));
    expect(await order).toEqual(['sites', 'DOMAINS']);
    await el.updateComplete;
    const live = el.shadowRoot!.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toContain('Domains moved to position 2 of 2');
  });

  it('reorders via drag-and-drop (drop a lane onto another)', async () => {
    const el = await mountManager({ order: null, hidden: {} });
    const order = new Promise<string[]>((res) =>
      el.addEventListener(
        'row-order-change',
        (e) => res((e as CustomEvent).detail.order),
        { once: true }
      )
    );
    const handleSites = byKey(el, 'H:sites');
    const domainsRow = byKey(el, 'H:DOMAINS').closest('.row')!;
    const dt = new DataTransfer();
    handleSites.dispatchEvent(
      new DragEvent('dragstart', { dataTransfer: dt, bubbles: true })
    );
    domainsRow.dispatchEvent(
      new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })
    );
    domainsRow.dispatchEvent(
      new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
    );
    // Dropping "sites" onto "DOMAINS" puts sites first.
    expect(await order).toEqual(['sites', 'DOMAINS']);
  });
});

describe('<protvista-track-manager> — events + announcements', () => {
  it('emits row-visibility-toggle and announces when hiding a lane', async () => {
    const el = await mountManager({ order: null, hidden: {} });
    const detail = new Promise<{ rowId: string; visible: boolean }>((res) =>
      el.addEventListener(
        'row-visibility-toggle',
        (e) => res((e as CustomEvent).detail),
        { once: true }
      )
    );
    const domains = el.shadowRoot!.querySelector<HTMLButtonElement>(
      'button.toggle[data-key="L:DOMAINS"]'
    )!;
    await userEvent.click(domains);

    expect(await detail).toEqual({ rowId: 'DOMAINS', visible: false });
    await el.updateComplete;
    const live = el.shadowRoot!.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toContain('Domains hidden');
  });

  it('emits track-visibility-toggle for a child track', async () => {
    const el = await mountManager({ order: null, hidden: {} });
    const detail = new Promise<{
      groupId: string;
      trackId: string;
      visible: boolean;
    }>((res) =>
      el.addEventListener(
        'track-visibility-toggle',
        (e) => res((e as CustomEvent).detail),
        { once: true }
      )
    );
    const track = el.shadowRoot!.querySelector<HTMLButtonElement>(
      'button.toggle[data-key="T:DOMAINS:region"]'
    )!;
    await userEvent.click(track);
    expect(await detail).toEqual({
      groupId: 'DOMAINS',
      trackId: 'region',
      visible: false,
    });
  });

  it('emits reset-layout from the reset control', async () => {
    const el = await mountManager({ order: null, hidden: { sites: true } });
    const fired = new Promise<boolean>((res) =>
      el.addEventListener('reset-layout', () => res(true), { once: true })
    );
    const reset = el.shadowRoot!.querySelector<HTMLButtonElement>(
      'button.reset'
    )!;
    await userEvent.click(reset);
    expect(await fired).toBe(true);
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
  });
  await vi.waitFor(() => {
    const btn = el.querySelector(`.${CSS_PREFIX}-customize-toggle`);
    if (!btn) throw new Error('customize toggle not ready');
  });
  return el;
}

const manager = (el: Viewer) =>
  el.querySelector('protvista-track-manager') as ProtvistaTrackManager | null;

/** Order of lane ids as rendered on the canvas (groups + standalone). */
const canvasLaneOrder = (el: Viewer) =>
  Array.from(el.querySelectorAll(`.${CSS_PREFIX}-group`)).map((d) =>
    d.getAttribute('id')?.replace(`${CSS_PREFIX}-group_`, '')
  );

describe('<protvista-uniprot> — Customize mode integration', () => {
  it('opens the Track Manager panel and is axe-clean', async () => {
    const el = await mountViewer();
    const btn = el.querySelector<HTMLButtonElement>(
      `.${CSS_PREFIX}-customize-toggle`
    )!;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(manager(el)).toBeNull();

    await userEvent.click(btn);
    await vi.waitFor(() => {
      if (!manager(el)) throw new Error('panel not open');
    });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    await expectNoA11yViolations(el);
  });

  it('hiding a lane in the panel reflows the canvas and reset restores it', async () => {
    const el = await mountViewer();
    await userEvent.click(
      el.querySelector<HTMLButtonElement>(`.${CSS_PREFIX}-customize-toggle`)!
    );
    await vi.waitFor(() => {
      if (!manager(el)) throw new Error('panel not open');
    });

    // The DOMAINS group lane is present on the canvas.
    expect(el.querySelector(`#${CSS_PREFIX}-group_DOMAINS`)).not.toBeNull();

    const hide = manager(el)!.shadowRoot!.querySelector<HTMLButtonElement>(
      'button.toggle[data-key="L:DOMAINS"]'
    )!;
    await userEvent.click(hide);

    // Canvas reflows: the group lane is gone; runtime state records it.
    await vi.waitFor(() => {
      if (el.querySelector(`#${CSS_PREFIX}-group_DOMAINS`)) {
        throw new Error('group still on canvas');
      }
    });
    expect(el.getLayout().hidden).toEqual({ DOMAINS: true });

    // It now sits in the panel's Hidden section, ready to restore.
    const shown = manager(el)!.shadowRoot!.querySelector<HTMLButtonElement>(
      'button.toggle[data-key="L:DOMAINS"]'
    )!;
    expect(shown.getAttribute('aria-pressed')).toBe('true');
    expect(shown.getAttribute('aria-label')).toBe('Show Domains');

    // Reset brings it back.
    await userEvent.click(
      manager(el)!.shadowRoot!.querySelector<HTMLButtonElement>('button.reset')!
    );
    await vi.waitFor(() => {
      if (!el.querySelector(`#${CSS_PREFIX}-group_DOMAINS`)) {
        throw new Error('group not restored');
      }
    });
    expect(el.getLayout()).toEqual({ order: null, hidden: {} });
  });

  it('reordering a lane in the panel reorders the canvas and keeps focus', async () => {
    const el = await mountViewer();
    await userEvent.click(
      el.querySelector<HTMLButtonElement>(`.${CSS_PREFIX}-customize-toggle`)!
    );
    await vi.waitFor(() => {
      if (!manager(el)) throw new Error('panel not open');
    });
    expect(canvasLaneOrder(el)).toEqual(['DOMAINS', 'sites']);

    // Move the DOMAINS lane down via its keyboard-operable button.
    const down = manager(el)!.shadowRoot!.querySelector<HTMLButtonElement>(
      'button[data-key="D:DOMAINS"]'
    )!;
    await userEvent.click(down);

    await vi.waitFor(() => {
      if (el.getLayout().order?.[0] !== 'sites') throw new Error('not reordered');
    });
    expect(el.getLayout().order).toEqual(['sites', 'DOMAINS']);
    // Canvas mirrors the new order.
    expect(canvasLaneOrder(el)).toEqual(['sites', 'DOMAINS']);
    // The panel's lane list mirrors it too.
    const laneKeys = Array.from(
      manager(el)!.shadowRoot!.querySelectorAll(
        '.lane-list > li > .row button.toggle'
      )
    ).map((b) => (b as HTMLElement).dataset.key);
    expect(laneKeys).toEqual(['L:sites', 'L:DOMAINS']);
    // Focus stays with the moved lane — its drag handle, now that it is
    // last (its move-down button became disabled). WCAG 2.4.7.
    await vi.waitFor(() => {
      const active = manager(el)!.shadowRoot!.activeElement as HTMLElement | null;
      if (active?.dataset.key !== 'H:DOMAINS') {
        throw new Error(`focus lost (on ${active?.dataset.key ?? 'nothing'})`);
      }
    });
  });
});
