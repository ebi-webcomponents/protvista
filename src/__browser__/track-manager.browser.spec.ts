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

const tabbable = (el: Mgr) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    'button.toggle[tabindex="0"]'
  );

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

describe('<protvista-track-manager> — roving-tabindex keyboard', () => {
  it('keeps exactly one toggle tabbable and moves focus with the arrows', async () => {
    const el = await mountManager({ order: null, hidden: {} });
    const all = toggles(el);
    // Visible: DOMAINS, its two tracks, and the standalone lane = 4 toggles.
    expect(all.length).toBe(4);
    expect(
      el.shadowRoot!.querySelectorAll('button.toggle[tabindex="0"]').length
    ).toBe(1);

    const first = tabbable(el)!;
    first.focus();
    expect(el.shadowRoot!.activeElement).toBe(first);

    await userEvent.keyboard('{ArrowDown}');
    await el.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(toggles(el)[1]);

    await userEvent.keyboard('{End}');
    await el.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(toggles(el)[3]);

    await userEvent.keyboard('{Home}');
    await el.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(toggles(el)[0]);
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
});
