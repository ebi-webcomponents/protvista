/**
 * Real-DOM accessibility + interaction coverage for the error surfaces
 * of `<protvista-uniprot>` (light DOM): the mount-level alert panel and
 * the per-track ⚠ badge, plus their Retry affordances.
 *
 * The jsdom suite (`src/__spec__/error-surface.spec.ts`) already proves
 * the wiring; here we additionally verify the surfaces are accessible
 * (axe-core) and that Retry recovers under *real* clicks and focus in a
 * browser. Nightingale is stubbed via the browser setup file, so mounting
 * the element is cheap.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { userEvent } from 'vitest/browser';

import '../protvista-uniprot.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import { mount, unmountAll } from './mount.js';
import { expectNoA11yViolations } from './axe.js';

const PANEL = `.${CSS_PREFIX}-error-panel`;
const RETRY = `.${CSS_PREFIX}-error-retry`;
const BADGE = `.${CSS_PREFIX}-error-badge`;

/** A raw, valid config with one http-URL feature track. */
const VALID_CONFIG = {
  rows: [
    {
      id: 'g',
      tracks: [
        { id: 'y', kind: 'features', data: 'https://example.org/x.json' },
      ],
    },
  ],
};

type El = HTMLElement & {
  viewerConfig?: unknown;
  accession?: string;
  sequence?: string;
  data: Record<string, unknown>;
};

/** Route fetch by URL substring; default 200 with an empty body. */
function stubFetch(handler: (url: string) => { ok: boolean; status: number; body?: unknown }) {
  const fn = vi.fn(async (input: unknown) => {
    const { ok, status, body } = handler(String(input));
    return { ok, status, json: async () => body ?? {} } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  // Unmount before restoring `fetch`: hooks run last-registered-first,
  // so mount.js's own teardown would otherwise leave live components
  // able to reach the real network.
  unmountAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mount-level error panel — accessibility & retry', () => {
  it('a broken (5xx) sequence raises an accessible alert panel with Retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch((url) =>
      url.includes('/proteins/api/proteins/')
        ? { ok: false, status: 503 }
        : { ok: true, status: 200 }
    );

    const el = mount<El>('protvista-uniprot', {
      viewerConfig: VALID_CONFIG,
      accession: 'P05067',
    });

    const panel = await vi.waitFor(() => {
      const p = el.querySelector<HTMLElement>(PANEL);
      if (!p) throw new Error('panel not ready');
      return p;
    });

    expect(panel.getAttribute('role')).toBe('alert');
    expect(panel.textContent).toMatch(/unreachable or failing/);
    expect(panel.querySelector(RETRY)).not.toBeNull();

    // Focus is moved into the panel when it appears.
    expect(document.activeElement).toBe(panel);

    // The alert panel itself is accessible.
    await expectNoA11yViolations(panel);
  });

  it('clicking Retry re-fetches and tears the panel down once the service recovers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let sequenceCalls = 0;
    stubFetch((url) => {
      if (url.includes('/proteins/api/proteins/')) {
        sequenceCalls += 1;
        return sequenceCalls === 1
          ? { ok: false, status: 503 }
          : { ok: true, status: 200, body: { sequence: { sequence: 'MSEQENCE' } } };
      }
      return { ok: true, status: 200 };
    });

    const el = mount<El>('protvista-uniprot', {
      viewerConfig: VALID_CONFIG,
      accession: 'P05067',
    });

    const retry = await vi.waitFor(() => {
      const btn = el.querySelector<HTMLButtonElement>(`${PANEL} ${RETRY}`);
      if (!btn) throw new Error('retry not ready');
      return btn;
    });

    await userEvent.click(retry);

    await vi.waitFor(() => {
      if (el.querySelector(PANEL)) throw new Error('panel still present');
    });
    expect(sequenceCalls).toBe(2);
    expect(el.sequence).toBe('MSEQENCE');
  });
});

describe('per-track error badge — accessibility & retry', () => {
  it('a broken (5xx) track shows an accessible ⚠ badge whose Retry recovers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let trackCalls = 0;
    stubFetch((url) => {
      if (url.includes('/proteins/api/proteins/')) {
        return { ok: true, status: 200, body: { sequence: { sequence: 'MSEQENCE' } } };
      }
      if (url.includes('/x.json')) {
        trackCalls += 1;
        return trackCalls === 1
          ? { ok: false, status: 500 }
          : { ok: true, status: 200, body: { features: [{ type: 'DOMAIN', begin: '1', end: '5' }] } };
      }
      return { ok: true, status: 200 };
    });

    const el = mount<El>('protvista-uniprot', {
      viewerConfig: VALID_CONFIG,
      accession: 'P05067',
    });

    const badge = await vi.waitFor(() => {
      const b = el.querySelector<HTMLElement>(BADGE);
      if (!b) throw new Error('badge not ready');
      return b;
    });

    // Badge semantics: a labelled image with a described-by detail.
    expect(badge.getAttribute('role')).toBe('img');
    expect(badge.getAttribute('tabindex')).toBe('0');
    const descId = badge.getAttribute('aria-describedby')!;
    expect(el.querySelector(`#${CSS.escape(descId)}`)).not.toBeNull();

    await expectNoA11yViolations(el.querySelector(`.${CSS_PREFIX}-group`)!);

    const retry = el.querySelector<HTMLButtonElement>(RETRY)!;
    expect(retry).not.toBeNull();
    await userEvent.click(retry);

    // After recovery the badge is gone.
    await vi.waitFor(() => {
      if (el.querySelector(BADGE)) throw new Error('badge still present');
    });
    expect(trackCalls).toBe(2);
  });
});
