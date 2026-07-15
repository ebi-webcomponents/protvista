/**
 * Coverage for the user-facing error-surfacing layer.
 *
 * Three surfaces sit on top of the unchanged `console.*` developer
 * channel: the mount-level alert panel (config / sequence failures),
 * the per-track `⚠` badge for *broken* data (network / 5xx / parse — a
 * 4xx is "missing", hidden like an empty response), and the bubbling
 * `protvista-error` event. This file exercises each, plus `strict`
 * promotion, focus management, and the lazy `errors/format` helper.
 *
 * Two harness styles, mirroring the existing specs:
 *   - Mount-panel + focus tests append the element and let the real
 *     `connectedCallback → _init()` lifecycle run (fetch is stubbed).
 *   - Badge / strict tests drive `_loadData()` directly and render the
 *     template into a detached target (as `render-target.spec.ts` does),
 *     avoiding the `loadEntry()` → real-API path.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from 'lit';

// Registers <protvista-uniprot>; nightingale packages are stubbed
// globally via `src/__spec__/nightingale-mocks.ts` (setupFiles).
import '../protvista-uniprot';
import { loadProtvistaData, type AdapterMap } from '../load-data';
import { CSS_PREFIX } from '../styles/css-prefix';
import { formatValidationIssues } from '../errors/format';
import type { ValidationIssue } from '../schema/errors';
import type { NormalizedConfig, NormalizedTrack } from '../schema/normalize';

// jsdom in this environment ships without the `CSS.escape` global that
// the component's `findById()` relies on (real browsers all have it).
// Polyfill it so the full connectedCallback → updated() lifecycle can
// run in the mount-panel tests.
if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
  (globalThis as { CSS?: { escape(s: string): string } }).CSS = {
    escape: (s: string) => String(s).replace(/([^\w-])/g, '\\$1'),
  };
}

const PANEL = `.${CSS_PREFIX}-error-panel`;
const BADGE = `.${CSS_PREFIX}-error-badge`;
const ISSUES = `.${CSS_PREFIX}-error-issues`;

type ErrorEvent = CustomEvent<{
  phase: string;
  issues: ValidationIssue[];
  context: Record<string, unknown>;
}>;

type El = HTMLElement & {
  config?: NormalizedConfig;
  viewerConfig?: unknown;
  accession?: string;
  sequence?: string;
  data: Record<string, unknown>;
  customTrackData: Record<string, unknown>;
  loading: boolean;
  hasData: boolean;
  openGroups: string[];
  _mountError: { phase: string; summary: string } | null;
  _trackErrors: Map<string, { status: number; url: string }>;
  _groupErrors: Set<string>;
  _init(): Promise<void>;
  _loadData(only?: Set<string>): Promise<void>;
  setTrackData(groupId: string, trackId: string, data: unknown): void;
  render(): unknown;
  updateComplete: Promise<boolean>;
};

// ── config-object builders ────────────────────────────────────────

/** A raw (un-normalized) config with a single bad source-key reference. */
const INVALID_CONFIG = {
  groups: [{ id: 'FOO', tracks: [{ id: 'bar', kind: 'features', data: 'missingKey' }] }],
};

/** A raw, valid config with one http-URL feature track. */
const VALID_CONFIG = {
  groups: [
    { id: 'g', tracks: [{ id: 'y', kind: 'features', data: 'https://example.org/x.json' }] },
  ],
};

const urlTrack = (id: string, url: string): NormalizedTrack => ({
  id,
  label: id,
  kind: 'features',
  component: 'nightingale-track-canvas',
  rendering: {},
  data: [{ from: 'url', url, adapter: 'uniprot-features-json' }],
});

const customTrack = (id: string): NormalizedTrack => ({
  id,
  label: id,
  kind: 'features',
  component: 'nightingale-track-canvas',
  rendering: {},
  data: [{ from: 'custom' }],
});

function normConfig(
  tracks: NormalizedTrack[],
  opts: { strict?: boolean } = {}
): NormalizedConfig {
  return {
    version: '1.0',
    sources: {},
    defaults: { rendering: {} },
    ...(opts.strict !== undefined ? { strict: opts.strict } : {}),
    groups: [
      {
        id: 'g',
        label: 'G',
        component: 'nightingale-track-canvas',
        rendering: {},
        tracks,
      },
    ],
  };
}

/** Detached element with the state `_loadData()` needs, ready to render. */
function buildLoaded(
  config: NormalizedConfig,
  overrides: Partial<El> = {}
): El {
  const el = document.createElement('protvista-uniprot') as unknown as El;
  el.config = config;
  el.accession = 'P05067';
  el.sequence = 'MSEQENCE';
  el.data = {};
  el.customTrackData = {};
  el.loading = false;
  el.hasData = false;
  el.openGroups = [];
  Object.assign(el, overrides);
  return el;
}

function renderTarget(el: El): HTMLElement {
  const target = document.createElement('div');
  render(el.render(), target);
  return target;
}

/** Route fetch by URL substring; default 200 with an empty body. */
function stubFetch(
  routes: Array<[match: string, res: { ok: boolean; status: number }]>
) {
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input);
    const hit = routes.find(([m]) => url.includes(m));
    const { ok, status } = hit ? hit[1] : { ok: true, status: 200 };
    return { ok, status, json: async () => ({}) } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const appended: HTMLElement[] = [];
function mountEl(props: Partial<El>): El {
  const el = document.createElement('protvista-uniprot') as unknown as El;
  Object.assign(el, props);
  document.body.append(el);
  appended.push(el);
  return el;
}

afterEach(() => {
  for (const el of appended.splice(0)) el.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Mount-level panel: config validation ──────────────────────────

describe('mount-level error panel — config validation', () => {
  it('renders the alert panel, lists issues, and fires phase:config', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const events: ErrorEvent[] = [];
    const el = mountEl({ viewerConfig: INVALID_CONFIG, accession: 'P05067' });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await vi.waitFor(() => {
      if (!el.querySelector(ISSUES)) throw new Error('panel not ready');
    });

    const panel = el.querySelector(PANEL)!;
    expect(panel.getAttribute('role')).toBe('alert');
    expect(panel.textContent).toMatch(/Config validation failed \(\d+ issue/);
    expect(panel.textContent).toMatch(/unknown-source-key/);

    // Developer channel preserved verbatim.
    expect(errorSpy).toHaveBeenCalledWith(
      '[protvista-uniprot] Failed to load config.',
      expect.anything()
    );

    const cfg = events.find((e) => e.detail.phase === 'config');
    expect(cfg).toBeDefined();
    expect(cfg!.detail.issues.length).toBeGreaterThan(0);
    expect(cfg!.bubbles).toBe(true);
  });

  it('offers no dismiss control for a fatal config error (nothing to reveal)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = mountEl({ viewerConfig: INVALID_CONFIG, accession: 'P05067' });
    await vi.waitFor(() => {
      if (!el.querySelector(ISSUES)) throw new Error('panel not ready');
    });

    const buttons = [
      ...el.querySelectorAll<HTMLButtonElement>(`${PANEL} button`),
    ];
    // No Copy button anywhere, and no Dismiss for an unrenderable component.
    expect(buttons.some((b) => b.textContent?.trim() === 'Copy')).toBe(false);
    expect(
      el.querySelector(`${PANEL} button[aria-label="Dismiss error"]`)
    ).toBeNull();
  });
});

// ── Mount-level panel: sequence ───────────────────────────────────

describe('mount-level error panel — sequence', () => {
  it('a 4xx sequence (missing accession) shows the "no entry" panel, no Retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A 404 on the sequence endpoint = "this accession has no entry".
    stubFetch([['/proteins/api/proteins/', { ok: false, status: 404 }]]);
    const events: ErrorEvent[] = [];

    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067X' });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await vi.waitFor(() => {
      if (!el.querySelector(PANEL)) throw new Error('panel not ready');
    });

    const panel = el.querySelector(PANEL)!;
    expect(panel.getAttribute('role')).toBe('alert');
    // "Missing" wording points at the identifier, not the service…
    expect(panel.textContent).toMatch(
      /No UniProt entry found for 'P05067X'/
    );
    // …and a 404 is deterministic, so no Retry is offered.
    expect(panel.querySelector(`.${CSS_PREFIX}-error-retry`)).toBeNull();

    const seq = events.find((e) => e.detail.phase === 'sequence');
    expect(seq).toBeDefined();
    expect(seq!.detail.context.accession).toBe('P05067X');
    expect(seq!.detail.context.errorKind).toBe('http');
    expect(seq!.detail.context.status).toBe(404);
  });

  it('a broken (5xx) sequence fetch shows the "unreachable" panel with Retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/proteins/api/proteins/', { ok: false, status: 503 }]]);
    const events: ErrorEvent[] = [];

    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067' });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await vi.waitFor(() => {
      if (!el.querySelector(PANEL)) throw new Error('panel not ready');
    });

    const panel = el.querySelector(PANEL)!;
    // "Broken" wording blames the service, not the identifier…
    expect(panel.textContent).toMatch(/data service is unreachable or failing/);
    // …and a transient failure offers Retry.
    expect(panel.querySelector(`.${CSS_PREFIX}-error-retry`)).not.toBeNull();

    const seq = events.find((e) => e.detail.phase === 'sequence');
    expect(seq!.detail.context.errorKind).toBe('http');
    expect(seq!.detail.context.status).toBe(503);
  });

  it('a network-error sequence fetch is broken (unreachable panel + Retry)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    const events: ErrorEvent[] = [];

    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067' });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await vi.waitFor(() => {
      if (!el.querySelector(PANEL)) throw new Error('panel not ready');
    });

    const panel = el.querySelector(PANEL)!;
    expect(panel.textContent).toMatch(/data service is unreachable or failing/);
    expect(panel.querySelector(`.${CSS_PREFIX}-error-retry`)).not.toBeNull();
    expect(
      events.find((e) => e.detail.phase === 'sequence')!.detail.context.errorKind
    ).toBe('network');
  });

  it('Retry re-fetches the sequence and recovers once the service is back', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Fail the sequence once (503), then succeed on the retry.
    let sequenceCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/proteins/api/proteins/')) {
          sequenceCalls += 1;
          if (sequenceCalls === 1) {
            return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ sequence: { sequence: 'MSEQENCE' } }),
          } as unknown as Response;
        }
        // Tracks: return empty-but-ok so the viewer mounts cleanly.
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      })
    );

    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067' });

    const retry = await vi.waitFor(() => {
      const btn = el.querySelector<HTMLButtonElement>(`${PANEL} .${CSS_PREFIX}-error-retry`);
      if (!btn) throw new Error('retry not ready');
      return btn;
    });

    retry.click();

    // After the retry the sequence loads, so the panel is gone.
    await vi.waitFor(() => {
      if (el.querySelector(PANEL)) throw new Error('panel still present');
    });
    expect(sequenceCalls).toBe(2);
    expect(el.sequence).toBe('MSEQENCE');
  });
});

// ── Focus management ──────────────────────────────────────────────

describe('mount panel — focus management', () => {
  it('captures focus on appear and restores it on dismiss (dismissible panel)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A strict-mode track failure: config + sequence load fine, so the
    // panel is dismissible and dismissing reveals the working viewer.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/proteins/api/proteins/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ sequence: { sequence: 'MSEQENCE' } }),
          } as unknown as Response;
        }
        // A "broken" (5xx) track failure so the strict panel is raised.
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      })
    );

    const sibling = document.createElement('button');
    document.body.append(sibling);
    appended.push(sibling);
    sibling.focus();
    expect(document.activeElement).toBe(sibling);

    const el = mountEl({
      viewerConfig: {
        strict: true,
        groups: [
          { id: 'g', tracks: [{ id: 'bad', kind: 'features', data: 'https://example.org/bad.json' }] },
        ],
      },
      accession: 'P05067',
    });

    // Wait until the panel is present AND dismissible (both config and
    // sequence have loaded and the strict panel has been raised).
    await vi.waitFor(() => {
      if (!el.querySelector(`${PANEL} button[aria-label="Dismiss error"]`)) {
        throw new Error('dismissible panel not ready');
      }
    });
    await el.updateComplete;

    const panel = el.querySelector<HTMLElement>(PANEL)!;
    expect(document.activeElement).toBe(panel);

    const dismiss = panel.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss error"]'
    )!;
    dismiss.click();
    await el.updateComplete;

    expect(document.activeElement).toBe(sibling);
  });

  it('preserves the focus-restore target across a re-entrant strict re-raise', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/proteins/api/proteins/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ sequence: { sequence: 'MSEQENCE' } }),
          } as unknown as Response;
        }
        // Persistently-broken (5xx) track so the strict panel stays up.
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      })
    );

    const sibling = document.createElement('button');
    document.body.append(sibling);
    appended.push(sibling);
    sibling.focus();
    expect(document.activeElement).toBe(sibling);

    const el = mountEl({
      viewerConfig: {
        strict: true,
        groups: [
          { id: 'g', tracks: [{ id: 'bad', kind: 'features', data: 'https://example.org/bad.json' }] },
        ],
      },
      accession: 'P05067',
    });

    await vi.waitFor(() => {
      if (!el.querySelector(`${PANEL} button[aria-label="Dismiss error"]`)) {
        throw new Error('dismissible panel not ready');
      }
    });
    await el.updateComplete;

    // Focus has moved into the panel on appear.
    const panel = el.querySelector<HTMLElement>(PANEL)!;
    expect(document.activeElement).toBe(panel);

    // Re-entrant load while the panel is open and still failing: strict
    // re-raises the aggregated panel via `_setMountError`. This must NOT
    // re-capture the focus-restore target — which is now the panel itself.
    await el._loadData();
    await el.updateComplete;

    // Dismiss and confirm focus returns to the ORIGINAL pre-error element,
    // not lost to <body> because `_prevFocus` was clobbered to the (now
    // removed) panel.
    const dismiss = el.querySelector<HTMLButtonElement>(
      `${PANEL} button[aria-label="Dismiss error"]`
    )!;
    dismiss.click();
    await el.updateComplete;

    expect(document.activeElement).toBe(sibling);
  });
});

// ── Per-track badges ──────────────────────────────────────────────

describe('per-track error badge', () => {
  it('shows a ⚠ badge + fires an event for a broken (5xx) track', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);
    const events: ErrorEvent[] = [];

    const el = buildLoaded(
      normConfig([customTrack('ok'), urlTrack('bad', 'https://example.org/bad.json')]),
      {
        customTrackData: { 'g-ok': [{ type: 'DOMAIN', start: 1, end: 10 }] },
        hasData: true,
        openGroups: ['g'],
      }
    );
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    const badges = target.querySelectorAll(BADGE);
    expect(badges.length).toBe(1);
    const badge = badges[0];
    expect(badge.getAttribute('tabindex')).toBe('0');
    expect(badge.getAttribute('role')).toBe('img');

    const descId = badge.getAttribute('aria-describedby')!;
    const desc = target.querySelector(`[id="${descId}"]`)!;
    expect(desc.textContent).toMatch(/HTTP 500/);
    expect(desc.textContent).toMatch(/example\.org\/bad/);

    const tf = events.find((e) => e.detail.phase === 'track-fetch');
    expect(tf).toBeDefined();
    expect(tf!.detail.context.status).toBe(500);
    expect(tf!.detail.context.trackId).toBe('bad');

    // console.warn fired once (closure), not doubled by reportError.
    const httpWarns = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes('HTTP error status: 500')
    );
    expect(httpWarns.length).toBe(1);
  });

  it('hides a 4xx track (missing, not broken) with no badge and no event', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 404 }]]);
    const events: ErrorEvent[] = [];

    const el = buildLoaded(normConfig([urlTrack('bad', 'https://example.org/bad.json')]), {
      openGroups: ['g'],
    });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    expect(target.querySelector(BADGE)).toBeNull();
    expect(target.querySelector('.protvista-no-results')).not.toBeNull();
    // A 4xx is "no data", not an error — the event does NOT fire.
    expect(events.some((e) => e.detail.phase === 'track-fetch')).toBe(false);
    expect(el._trackErrors.has('g-bad')).toBe(false);
  });

  it('shows a group-level badge when every track in the group fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([
      ['/a.json', { ok: false, status: 500 }],
      ['/b.json', { ok: false, status: 500 }],
    ]);

    const el = buildLoaded(
      normConfig([
        urlTrack('a', 'https://example.org/a.json'),
        urlTrack('b', 'https://example.org/b.json'),
      ])
    );

    await el._loadData();
    const target = renderTarget(el);

    expect(el._groupErrors.has('g')).toBe(true);
    expect(target.querySelector(BADGE)).not.toBeNull();
  });

  it('sanitizes the badge id so ids with whitespace keep a valid aria-describedby', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);

    // Schema permits any non-empty id string, including spaces.
    const el = buildLoaded(
      normConfig([customTrack('ok'), urlTrack('bad track', 'https://example.org/bad.json')]),
      {
        customTrackData: { 'g-ok': [{ type: 'DOMAIN', start: 1, end: 10 }] },
        hasData: true,
        openGroups: ['g'],
      }
    );

    await el._loadData();
    const target = renderTarget(el);

    const badge = target.querySelector(BADGE)!;
    const descId = badge.getAttribute('aria-describedby')!;
    expect(descId).not.toMatch(/\s/); // no whitespace → valid HTML id / token
    // The referenced description element actually exists under that id.
    expect(target.querySelector(`[id="${descId}"]`)).not.toBeNull();
  });
});

// ── default visibility of transport / server errors ───────────────

describe('broken vs missing', () => {
  function loadedWith(badUrl: string, failer: () => Response) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) =>
        String(input).includes('/bad')
          ? failer()
          : ({ ok: true, status: 200, json: async () => ({}) } as unknown as Response)
      )
    );
    return buildLoaded(
      normConfig([customTrack('ok'), urlTrack('bad', badUrl)]),
      {
        customTrackData: { 'g-ok': [{ type: 'DOMAIN', start: 1, end: 10 }] },
        hasData: true,
        openGroups: ['g'],
      }
    );
  }

  it('surfaces a network (blocked/offline) failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const events: ErrorEvent[] = [];
    const el = loadedWith('https://example.org/bad.json', () => {
      throw new TypeError('Failed to fetch'); // what a blocked/offline fetch throws
    });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    // A transport failure is "broken" → surfaced.
    expect(target.querySelector(BADGE)).not.toBeNull();
    const tf = events.find((e) => e.detail.phase === 'track-fetch')!;
    expect(tf.detail.context.errorKind).toBe('network');
    expect(tf.detail.context.status).toBeUndefined();
  });

  it('surfaces a 5xx server error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const el = loadedWith(
      'https://example.org/bad.json',
      () => ({ ok: false, status: 503, json: async () => ({}) } as unknown as Response)
    );
    await el._loadData();
    const target = renderTarget(el);
    expect(target.querySelector(BADGE)).not.toBeNull();
  });

  it('treats a 4xx as missing — hidden, with no badge and no event', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const events: ErrorEvent[] = [];
    const el = loadedWith(
      'https://example.org/bad.json',
      () => ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response)
    );
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    // 4xx ≈ "no data for this entity": no badge, and no track-fetch event.
    expect(target.querySelector(BADGE)).toBeNull();
    expect(events.some((e) => e.detail.phase === 'track-fetch')).toBe(false);
  });
});

// ── retry ─────────────────────────────────────────────────────────

describe('retry affordance', () => {
  it('re-runs the data load when the badge Retry button is clicked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);

    const el = buildLoaded(
      normConfig([urlTrack('bad', 'https://example.org/bad.json')])
    );

    await el._loadData();
    const target = renderTarget(el);

    const retry = target.querySelector<HTMLButtonElement>(`.${CSS_PREFIX}-error-retry`)!;
    expect(retry).not.toBeNull();

    const loadSpy = vi
      .spyOn(el, '_loadData')
      .mockImplementation(() => Promise.resolve());
    retry.click();
    expect(loadSpy).toHaveBeenCalledTimes(1);
    // Targeted: reloads only the failed track, not the whole viewer.
    const arg = loadSpy.mock.calls[0][0] as Set<string> | undefined;
    expect(arg).toBeInstanceOf(Set);
    expect([...(arg as Set<string>)]).toEqual(['g-bad']);
  });

  it('re-fetches only the target track, not its siblings', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      return url.includes('/bad')
        ? ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
        : ({
            ok: true,
            status: 200,
            json: async () => ({ features: [{ type: 'X', begin: '1', end: '2' }] }),
          } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const config: NormalizedConfig = {
      version: '1.0',
      sources: {},
      defaults: { rendering: {} },

      groups: [
        {
          id: 'g1',
          label: 'G1',
          component: 'nightingale-track-canvas',
          rendering: {},
          tracks: [urlTrack('a', 'https://example.org/a.json')],
        },
        {
          id: 'g2',
          label: 'G2',
          component: 'nightingale-track-canvas',
          rendering: {},
          tracks: [urlTrack('bad', 'https://example.org/bad.json')],
        },
      ],
    };
    const el = buildLoaded(config, { hasData: true });
    await el._loadData();
    expect(el._trackErrors.has('g2-bad')).toBe(true);

    fetchMock.mockClear();
    await el._loadData(new Set(['g2-bad']));

    const fetched = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(fetched.some((u) => u.includes('/bad.json'))).toBe(true);
    expect(fetched.some((u) => u.includes('/a.json'))).toBe(false); // sibling untouched
  });

  it('clears a track error when a retry succeeds, leaving other errors intact', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let badAttempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/bad')) {
          badAttempts += 1;
          return badAttempts === 1
            ? ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
            : ({
                ok: true,
                status: 200,
                json: async () => ({ features: [{ type: 'X', begin: '1', end: '2' }] }),
              } as unknown as Response);
        }
        // a second, independently-failing track
        return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      })
    );

    const config: NormalizedConfig = {
      version: '1.0',
      sources: {},
      defaults: { rendering: {} },

      groups: [
        {
          id: 'g1',
          label: 'G1',
          component: 'nightingale-track-canvas',
          rendering: {},
          tracks: [urlTrack('bad', 'https://example.org/bad.json')],
        },
        {
          id: 'g2',
          label: 'G2',
          component: 'nightingale-track-canvas',
          rendering: {},
          tracks: [urlTrack('down', 'https://example.org/down.json')],
        },
      ],
    };
    const el = buildLoaded(config, { hasData: false });
    await el._loadData();
    expect(el._trackErrors.has('g1-bad')).toBe(true);
    expect(el._trackErrors.has('g2-down')).toBe(true);

    await el._loadData(new Set(['g1-bad']));
    // Retried track cleared; the untouched track's error survives.
    expect(el._trackErrors.has('g1-bad')).toBe(false);
    expect(el._trackErrors.has('g2-down')).toBe(true);
  });

  it('clears stale track data when a reload produces none (no ghost data under a badge)', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A `from: custom` track: has data initially, then the injected data
    // is removed. On reload the loader early-returns without writing
    // `data[key]` — the merge must NOT keep the previous value.
    const el = buildLoaded(normConfig([customTrack('c')]), {
      customTrackData: { 'g-c': [{ type: 'DOMAIN', start: 1, end: 10 }] },
      hasData: true,
    });
    await el._loadData();
    expect(el.data['g-c']).toBeDefined();

    el.customTrackData = {};
    await el._loadData(new Set(['g-c'])); // targeted reload
    expect(el.data['g-c']).toBeUndefined();
  });

  it('a full reload also drops a track that no longer produces data', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('c')]), {
      customTrackData: { 'g-c': [{ type: 'DOMAIN', start: 1, end: 10 }] },
      hasData: true,
    });
    await el._loadData();
    expect(el.data['g-c']).toBeDefined();

    el.customTrackData = {};
    await el._loadData(); // full reload
    expect(el.data['g-c']).toBeUndefined();
  });

  it('offers Retry only for recoverable failures (network / 5xx), not 4xx', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/gone')) {
          return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
        }
        if (url.includes('/down')) {
          return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
        }
        if (url.includes('/blocked')) {
          throw new TypeError('Failed to fetch');
        }
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      })
    );

    const el = buildLoaded(
      normConfig([
        urlTrack('gone', 'https://example.org/gone.json'), // 404 → missing, hidden entirely
        urlTrack('down', 'https://example.org/down.json'), // 503 → broken, recoverable
        urlTrack('blocked', 'https://example.org/blocked.json'), // network → broken, recoverable
      ]),
      { openGroups: ['g'] }
    );

    await el._loadData();
    const target = renderTarget(el);

    // The 404 is "missing" → no badge; only the two "broken" tracks surface…
    expect(target.querySelectorAll(BADGE).length).toBe(2);
    // …and both the 503 and network failures offer a Retry button.
    expect(
      target.querySelectorAll(`.${CSS_PREFIX}-error-retry`).length
    ).toBe(2);
  });

  it('two disjoint targeted retries do not cancel each other', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let healthy = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        healthy
          ? ({
              ok: true,
              status: 200,
              json: async () => ({ features: [{ type: 'X', begin: '1', end: '2' }] }),
            } as unknown as Response)
          : ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
      )
    );

    const config: NormalizedConfig = {
      version: '1.0',
      sources: {},
      defaults: { rendering: {} },
      groups: [
        {
          id: 'g1',
          label: 'G1',
          component: 'nightingale-track-canvas',
          rendering: {},
          tracks: [urlTrack('a', 'https://example.org/a.json')],
        },
        {
          id: 'g2',
          label: 'G2',
          component: 'nightingale-track-canvas',
          rendering: {},
          tracks: [urlTrack('b', 'https://example.org/b.json')],
        },
      ],
    };
    const el = buildLoaded(config, { hasData: true });

    await el._loadData();
    expect(el._trackErrors.has('g1-a')).toBe(true);
    expect(el._trackErrors.has('g2-b')).toBe(true);

    // Service recovers, then fire two targeted retries for tracks in
    // different groups "simultaneously" (no await between). A single
    // shared AbortController would abort the first before it committed —
    // its badge would silently stay stale. Disjoint key-sets must run
    // concurrently instead.
    healthy = true;
    const p1 = el._loadData(new Set(['g1-a']));
    const p2 = el._loadData(new Set(['g2-b']));
    await Promise.all([p1, p2]);

    // Neither retry was dropped: both errors cleared and both tracks
    // committed their data.
    expect(el._trackErrors.has('g1-a')).toBe(false);
    expect(el._trackErrors.has('g2-b')).toBe(false);
    expect(el.data['g1-a']).toBeDefined();
    expect(el.data['g2-b']).toBeDefined();
  });
});

// ── strict mode ───────────────────────────────────────────────────

describe('strict mode', () => {
  it('promotes a per-track fetch failure to the mount panel', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);

    const el = buildLoaded(
      normConfig([urlTrack('bad', 'https://example.org/bad.json')], { strict: true })
    );

    await el._loadData();
    const target = renderTarget(el);

    const panel = target.querySelector(PANEL)!;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('role')).toBe('alert');
  });

  it('aggregates multiple failures into a single panel (no last-writer-wins)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([
      ['/a.json', { ok: false, status: 502 }],
      ['/b.json', { ok: false, status: 500 }],
    ]);
    const events: ErrorEvent[] = [];

    const el = buildLoaded(
      normConfig(
        [urlTrack('a', 'https://example.org/a.json'), urlTrack('b', 'https://example.org/b.json')],
        { strict: true }
      )
    );
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    // One panel summarising both, not just the last track's message.
    const panels = target.querySelectorAll(PANEL);
    expect(panels.length).toBe(1);
    expect(panels[0].textContent).toMatch(/2 tracks failed to load/);
    // But still one event per failed track for embedders.
    expect(events.filter((e) => e.detail.phase === 'track-fetch').length).toBe(2);
  });

  it('offers Retry on the aggregated panel for a recoverable (5xx) failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 503 }]]);

    const el = buildLoaded(
      normConfig([urlTrack('bad', 'https://example.org/bad.json')], {
        strict: true,
      })
    );

    await el._loadData();
    const target = renderTarget(el);

    // A transient failure is retryable everywhere else — the strict panel
    // must offer the same affordance rather than only Dismiss.
    const panel = target.querySelector(PANEL)!;
    expect(panel).not.toBeNull();
    expect(panel.querySelector(`.${CSS_PREFIX}-error-retry`)).not.toBeNull();
  });

  it('omits Retry on the aggregated panel when every failure is non-recoverable (parse)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // 200 OK but an unparseable body → `parse` kind: deterministic, so no
    // Retry (re-parsing the same bytes changes nothing).
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError('bad json');
            },
          }) as unknown as Response
      )
    );

    const el = buildLoaded(
      normConfig([urlTrack('bad', 'https://example.org/bad.json')], {
        strict: true,
      })
    );

    await el._loadData();
    const target = renderTarget(el);

    const panel = target.querySelector(PANEL)!;
    expect(panel).not.toBeNull();
    expect(panel.querySelector(`.${CSS_PREFIX}-error-retry`)).toBeNull();
  });
});

// ── collapsed / partial-failure surfacing ─────────────────────────

describe('collapsed group surfacing', () => {
  it('shows a group badge for a partial failure on a collapsed, dataless group (no blank viewer)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // One track 5xx-fails (visible), the other returns 200-but-empty
    // (not a failure) → group is NOT "all failed", and it's collapsed.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) =>
        String(input).includes('/bad')
          ? ({ ok: false, status: 503, json: async () => ({}) } as unknown as Response)
          : ({ ok: true, status: 200, json: async () => ({}) } as unknown as Response)
      )
    );

    const el = buildLoaded(
      normConfig([
        urlTrack('bad', 'https://example.org/bad.json'),
        urlTrack('empty', 'https://example.org/empty.json'),
      ]),
      { hasData: false, openGroups: [] } // collapsed
    );

    await el._loadData();
    const target = renderTarget(el);

    expect(el._groupErrors.has('g')).toBe(false); // not all failed
    // …but the failure is still surfaced, and not as the blank no-results.
    expect(target.querySelector(BADGE)).not.toBeNull();
    expect(target.querySelector('.protvista-no-results')).toBeNull();
  });
});

// ── per-instance id uniqueness ────────────────────────────────────

describe('badge id uniqueness across instances', () => {
  it('gives two viewers distinct aria-describedby ids for the same track', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);

    const describedById = async () => {
      const el = buildLoaded(
        normConfig([urlTrack('bad', 'https://example.org/bad.json')]),
        { openGroups: [] }
      );
      await el._loadData();
      const target = renderTarget(el);
      return target.querySelector(BADGE)!.getAttribute('aria-describedby')!;
    };

    const [id1, id2] = [await describedById(), await describedById()];
    expect(id1).not.toBe(id2);
    expect(id1).not.toMatch(/\s/);
  });
});

// ── setTrackData misuse ───────────────────────────────────────────

describe('setTrackData misuse', () => {
  it('fires phase:set-track-data for an unknown track', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('ok')]));
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    el.setTrackData('g', 'does-not-exist', [{ type: 'X' }]);

    const ev = events.find((e) => e.detail.phase === 'set-track-data');
    expect(ev).toBeDefined();
    expect(ev!.detail.context.trackId).toBe('does-not-exist');
  });

  it('fires phase:set-track-data for a primitive value', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('ok')]));
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    el.setTrackData('g', 'ok', 42);

    expect(events.some((e) => e.detail.phase === 'set-track-data')).toBe(true);
  });
});

// ── format helper ─────────────────────────────────────────────────

describe('formatValidationIssues', () => {
  it('groups issues by path in first-seen order', () => {
    const issues: ValidationIssue[] = [
      { path: 'g/y', message: 'bad kind', code: 'unknown-semantic-kind' },
      { path: 'g/z', message: 'no source', code: 'unknown-source-key' },
      { path: 'g/y', message: 'also bad', code: 'schema' },
    ];
    const f = formatValidationIssues(issues);
    expect(f.summary).toBe('Config validation failed (3 issues):');
    expect(f.groups.map((g) => g.path)).toEqual(['g/y', 'g/z']);
    expect(f.groups[0].items).toHaveLength(2);
    expect(f.raw).toBe(issues);
  });

  it('uses the singular summary for a single issue', () => {
    const f = formatValidationIssues([{ path: 'a', message: 'm', code: 'schema' }]);
    expect(f.summary).toBe('Config validation failed (1 issue):');
  });
});

// ── adapter-throw resilience ──────────────────────────────────────

describe('adapter throw resilience', () => {
  it('a throwing adapter degrades only its own track — the load completes so errors still surface', async () => {
    const config: NormalizedConfig = {
      version: '1.0',
      sources: {},
      defaults: { rendering: {} },
      groups: [
        {
          id: 'GOOD',
          label: 'Good',
          component: 'nightingale-track-canvas',
          rendering: {},
          tracks: [
            {
              id: 'ok',
              label: 'ok',
              kind: 'features',
              component: 'nightingale-track-canvas',
              rendering: {},
              data: [{ from: 'url', url: 'https://x/ok.json', adapter: 'good' }],
            },
          ],
        },
        {
          id: 'BOOM',
          label: 'Boom',
          component: 'nightingale-track-canvas',
          rendering: {},
          tracks: [
            {
              id: 'bang',
              label: 'bang',
              kind: 'features',
              component: 'nightingale-track-canvas',
              rendering: {},
              data: [{ from: 'url', url: 'https://x/boom.json', adapter: 'boom' }],
            },
          ],
        },
      ],
    };

    const fetchOne = vi.fn(async () => ({ features: [{ type: 'X' }] }));
    const adapters: AdapterMap = {
      good: (d: { features?: unknown[] }) => d.features ?? [],
      boom: () => {
        throw new Error('adapter blew up');
      },
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Must NOT reject even though the `boom` adapter throws.
    const res = await loadProtvistaData('P05067', config, fetchOne, adapters);

    expect(res.data['GOOD-ok']).toBeDefined(); // healthy track loaded
    expect(res.data['BOOM-bang']).toBeUndefined(); // throwing track degraded to empty
  });
});

// ── full-config integration: a blocked track surfaces, doesn't vanish ──

describe('blocked track in the bundled default config', () => {
  it('keeps the group present with an error badge (canvas + linegraph groups)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // No viewerConfig → the element loads the bundled default-config.yaml.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/proteins/api/proteins/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ sequence: { sequence: 'MSEQENCE' } }),
          } as unknown as Response;
        }
        // Block the two tracks the user reported vanishing.
        if (url.includes('/antigen/') || url.includes('/variation/')) {
          throw new TypeError('Failed to fetch');
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            features: [{ type: 'DOMAIN', begin: '1', end: '5' }],
            sequence: 'MSEQENCE',
          }),
        } as unknown as Response;
      })
    );

    // Broken (network) failures surface by default — no opt-in needed.
    // The accession attribute MUST be set before the element connects, or
    // `_init()` runs without an accession.
    const el = document.createElement('protvista-uniprot');
    el.setAttribute('accession', 'P05067');
    document.body.append(el);
    appended.push(el);

    await vi.waitFor(
      () => {
        if (el.querySelectorAll(BADGE).length < 2) {
          throw new Error('badges not ready');
        }
      },
      { timeout: 3000 }
    );

    // ANTIGEN (single features track → canvas group) stays present…
    const antigen = el.querySelector<HTMLElement>(
      `#${CSS_PREFIX}-group_ANTIGEN`
    );
    // …and VARIATION (a linegraph group whose aggregate is undefined when
    // blocked) is rendered via the group-error row rather than vanishing.
    const variation = el.querySelector<HTMLElement>(
      `#${CSS_PREFIX}-group_VARIATION`
    );
    expect(antigen).not.toBeNull();
    expect(variation).not.toBeNull();
    // Both carry a ⚠ badge.
    expect(el.querySelectorAll(BADGE).length).toBeGreaterThanOrEqual(2);

    // Critically: groups are `display: none` by default and revealed
    // imperatively; an error-only group must be revealed too, or its
    // badge is in the DOM but invisible (the "it disappeared" bug).
    await vi.waitFor(
      () => {
        if (
          antigen!.style.display !== 'flex' ||
          variation!.style.display !== 'flex'
        ) {
          throw new Error('error groups not revealed yet');
        }
      },
      { timeout: 3000 }
    );
  });
});
