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
import '../protvista-uniprot.js';
import { loadProtvistaData, type AdapterMap } from '../load-data.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import { formatValidationIssues } from '../errors/format.js';
import type { ValidationIssue } from '../schema/errors.js';
import type { NormalizedConfig, NormalizedTrack } from '../schema/normalize.js';

const PANEL = `.${CSS_PREFIX}-error-panel`;
const BADGE = `.${CSS_PREFIX}-error-badge`;
const ISSUES = `.${CSS_PREFIX}-error-issues`;

type ErrorEvent = CustomEvent<{
  phase: string;
  /** How bad it is — the routing table's severity. */
  severity: 'error' | 'warning';
  /** The text the visible surface carries, without the console's tag. */
  message: string;
  /** The URL or path the failure came from, when it had one. */
  source?: string;
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
  _trackErrors: Map<
    string,
    { status: number; url: string; message?: string; kind?: string; trackId?: string | null }
  >;
  _assignComponentData(element: unknown, payload: unknown, key: string): void;
  _groupErrors: Set<string>;
  _init(): Promise<void>;
  _loadData(only?: Set<string>): Promise<void>;
  setConfig(config: unknown): Promise<void>;
  setTrackData(groupId: string, trackId: string, data: unknown): void;
  render(): unknown;
  requestUpdate(): void;
  updateComplete: Promise<boolean>;
};

// ── config-object builders ────────────────────────────────────────

/** A raw (un-normalized) config with a single bad source-key reference. */
const INVALID_CONFIG = {
  rows: [{ id: 'FOO', tracks: [{ id: 'bar', kind: 'features', data: 'missingKey' }] }],
};

/** A raw, valid config with one http-URL feature track. */
const VALID_CONFIG = {
  rows: [
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

/**
 * A `from: file` CSV track — what `data: "./hits.csv"` normalises to. The
 * author wrote that path themselves and the extension states the encoding, so
 * the loader runs the computed decode → validate pipeline over the body.
 */
const fileTrack = (id: string, url: string): NormalizedTrack => ({
  id,
  label: id,
  kind: 'features',
  component: 'nightingale-track-canvas',
  rendering: {},
  data: [{ from: 'file', url, format: 'csv', shape: 'feature' }],
});

/** A track over any one data source — for the descriptor forms above don't cover. */
const sourceTrack = (
  id: string,
  source: NormalizedTrack['data'][number]
): NormalizedTrack => ({
  id,
  label: id,
  kind: 'features',
  component: 'nightingale-track-canvas',
  rendering: {},
  data: [source],
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
    rows: [
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

/**
 * A single *standalone* row — the shape the normalizer produces for a
 * top-level `rows:` entry with no `tracks:`, and the default in the starter
 * kits. Its one track is wrapped in a synthetic row flagged `standalone`, and
 * the row id matches the track id as the normalizer sets it.
 */
function standaloneConfig(
  track: NormalizedTrack,
  opts: { strict?: boolean } = {}
): NormalizedConfig {
  return {
    version: '1.0',
    sources: {},
    defaults: { rendering: {} },
    ...(opts.strict !== undefined ? { strict: opts.strict } : {}),
    rows: [
      {
        id: track.id,
        label: track.label,
        component: track.component,
        rendering: {},
        standalone: true,
        tracks: [track],
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

/**
 * Route fetch by URL substring; default 200 with an empty body. `body` is
 * served from both `.json()` and `.text()`, so one route covers a provider
 * endpoint and a delimited `from: file` source alike.
 */
function stubFetch(
  routes: Array<
    [
      match: string,
      res: {
        ok: boolean;
        status: number;
        body?: unknown;
        /** Fail the body read, producing a `parse` classification. */
        unreadable?: boolean;
      },
    ]
  >
) {
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input);
    const hit = routes.find(([m]) => url.includes(m));
    const res = hit ? hit[1] : { ok: true, status: 200 };
    const { ok, status, body, unreadable } = res;
    const read = async () => {
      if (unreadable) throw new SyntaxError('Unexpected token < in JSON');
      return body;
    };
    return {
      ok,
      status,
      json: async () => (await read()) ?? {},
      text: async () => {
        const v = await read();
        return typeof v === 'string' ? v : '';
      },
    } as unknown as Response;
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

  it('surfaces a config warning without blocking the mount', async () => {
    // A warning names something legal, so the viewer loads — but it still has
    // to reach a user. Dropped on the valid path, it reached nothing: not the
    // console, not this event, not the ⚠ badge, not CI. That is the whole
    // reason warnings are issues rather than `console.warn` calls.
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const events: ErrorEvent[] = [];
    const el = mountEl({
      viewerConfig: {
        rows: [
          {
            id: 'g',
            tracks: [
              {
                id: 'y',
                kind: 'features',
                data: { from: 'file', url: './hits.tsv', format: 'csv' },
              },
            ],
          },
        ],
      },
      accession: 'P05067',
    });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await vi.waitFor(() => {
      if (!events.some((e) => e.detail.phase === 'config')) {
        throw new Error('no config event yet');
      }
    });

    const cfg = events.find((e) => e.detail.phase === 'config')!;
    expect(cfg.detail.issues.map((i: { code: string }) => i.code)).toEqual([
      'format-overrides-extension',
    ]);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('1 warning');
    // Not a mount failure: no panel, and the config is in place.
    expect(el.querySelector(PANEL)).toBeNull();
    expect(el.config).toBeDefined();
  });

  it('keeps a config warning off the panel under strict', async () => {
    // `strict` makes broken states fail loudly. A warning names something
    // legal that loads as written, so raising the panel would hide a working
    // viewer. The event still fires, marked by each issue's severity.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Spy on every raise rather than reading `_mountError` afterwards: the
    // stubbed sequence fetch raises its own panel and would mask this one.
    const proto = customElements.get('protvista-uniprot')!.prototype as {
      _setMountError(phase: string): void;
    };
    const raise = vi.spyOn(proto, '_setMountError');
    const events: ErrorEvent[] = [];
    const el = mountEl({
      viewerConfig: {
        strict: true,
        rows: [
          {
            id: 'g',
            tracks: [
              {
                id: 'y',
                kind: 'features',
                data: { from: 'file', url: './hits.tsv', format: 'csv' },
              },
            ],
          },
        ],
      },
      accession: 'P05067',
    });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await vi.waitFor(() => {
      if (!events.some((e) => e.detail.phase === 'config')) {
        throw new Error('no config event yet');
      }
    });

    const cfg = events.find((e) => e.detail.phase === 'config')!;
    expect(cfg.detail.issues.map((i) => i.severity)).toEqual(['warning']);
    expect(el.config?.strict).toBe(true);
    expect(raise.mock.calls.map(([phase]) => phase)).not.toContain('config');
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
        rows: [
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
        rows: [
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

    // The developer channel still carries it, exactly once — the router makes
    // the only console call, so there is no second line from the fetch
    // closure to double it.
    const httpWarns = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes('HTTP 500')
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

// ── malformed data files and wrong file paths ─────────────────────

describe('parse / adapter failures on screen', () => {
  // A CSV whose `start` cell is not a number. The decoder names the author's
  // own path and the offending row, which is the whole value of surfacing it.
  const BAD_CSV = 'type,start,end,description\nDOMAIN,abc,25,Kinase domain';
  const BAD_ROW = /row 2, column "start": expected a number, got "abc"/;

  it('shows the row-named parse message as badge text and on the event', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/hits.csv', { ok: true, status: 200, body: BAD_CSV }]]);
    const events: ErrorEvent[] = [];

    const el = buildLoaded(normConfig([fileTrack('hits', './hits.csv')]), {
      openGroups: ['g'],
    });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    const badge = target.querySelector(BADGE)!;
    expect(badge).not.toBeNull();
    const descId = badge.getAttribute('aria-describedby')!;
    const detail = target.querySelector(`[id="${descId}"]`)!.textContent!;
    expect(detail).toMatch(BAD_ROW);
    expect(detail).toContain('./hits.csv');

    // The event carries the identical text, so an embedder's listener sees
    // exactly what the badge says. Asserting the *event* matters: the internal
    // map holding the same string is not a channel anyone outside can read.
    const tf = events.find((e) => e.detail.phase === 'track-fetch')!;
    expect(tf).toBeDefined();
    expect(tf.detail.message).toBe(detail);
    expect(tf.detail.message).toMatch(BAD_ROW);
    expect(tf.detail.source).toBe('./hits.csv');
    expect(tf.detail.context.errorKind).toBe('adapter');
    expect(tf.detail.context.trackId).toBe('hits');
    expect(el._trackErrors.get('g-hits')!.message).toBe(detail);
  });

  it('offers no Retry for a parse failure (re-running is deterministic)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/hits.csv', { ok: true, status: 200, body: BAD_CSV }]]);

    const el = buildLoaded(normConfig([fileTrack('hits', './hits.csv')]), {
      openGroups: ['g'],
    });
    await el._loadData();
    const target = renderTarget(el);

    expect(target.querySelector(BADGE)).not.toBeNull();
    expect(target.querySelector(`.${CSS_PREFIX}-error-retry`)).toBeNull();
  });

  it('surfaces a parse failure on a standalone row too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/hits.csv', { ok: true, status: 200, body: BAD_CSV }]]);

    const el = buildLoaded(standaloneConfig(fileTrack('hits', './hits.csv')));
    await el._loadData();
    const target = renderTarget(el);

    const badge = target.querySelector(BADGE)!;
    expect(badge).not.toBeNull();
    const descId = badge.getAttribute('aria-describedby')!;
    expect(target.querySelector(`[id="${descId}"]`)!.textContent).toMatch(
      BAD_ROW
    );
  });

  it('promotes a parse failure to the panel under strict', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/hits.csv', { ok: true, status: 200, body: BAD_CSV }]]);

    const el = buildLoaded(
      normConfig([fileTrack('hits', './hits.csv')], { strict: true })
    );
    await el._loadData();

    expect(el._mountError?.phase).toBe('track-fetch');
    expect(el._mountError?.summary).toMatch(BAD_ROW);
  });

  it('reads an empty file as no data, not as an error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A served-but-empty file parses to zero records. That is "nothing to
    // draw", which the viewer already has a surface for — not a failure.
    stubFetch([['/hits.csv', { ok: true, status: 200, body: '' }]]);

    const el = buildLoaded(normConfig([fileTrack('hits', './hits.csv')]), {
      openGroups: ['g'],
    });
    await el._loadData();
    const target = renderTarget(el);

    expect(el._trackErrors.size).toBe(0);
    expect(target.querySelector(BADGE)).toBeNull();
    expect(target.querySelector('.protvista-no-results')).not.toBeNull();
  });

  it('lets a failed fetch explain itself rather than the adapter throw it caused', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A 404 on a provider endpoint is deliberately silent. The empty body it
    // leaves behind can make the adapter throw, and that throw must not
    // resurrect the failure the classification just decided to swallow.
    stubFetch([['/bad.json', { ok: false, status: 404 }]]);
    const events: ErrorEvent[] = [];

    const config = normConfig([urlTrack('bad', 'https://example.org/bad.json')]);
    config.rows[0].tracks[0].data[0].adapter = 'nope-not-registered';
    const el = buildLoaded(config, { openGroups: ['g'] });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();

    expect(el._trackErrors.size).toBe(0);
    expect(events.some((e) => e.detail.phase === 'track-fetch')).toBe(false);
  });
});

describe('file-source 404s on screen', () => {
  const PATH_HINT = /could not be found \(HTTP 404\) — check the path is relative to the page/;

  it('names the path and the gotcha for a from: file 404', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/hits.csv', { ok: false, status: 404 }]]);
    const events: ErrorEvent[] = [];

    const el = buildLoaded(normConfig([fileTrack('hits', './hits.csv')]), {
      openGroups: ['g'],
    });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    const badge = target.querySelector(BADGE)!;
    expect(badge).not.toBeNull();
    const descId = badge.getAttribute('aria-describedby')!;
    const detail = target.querySelector(`[id="${descId}"]`)!.textContent!;
    expect(detail).toContain('./hits.csv');
    expect(detail).toMatch(PATH_HINT);

    const tf = events.find((e) => e.detail.phase === 'track-fetch')!;
    expect(tf.detail.context.status).toBe(404);
    expect(tf.detail.context.errorKind).toBe('http');
    // Retry *is* offered, unlike a provider 4xx or a malformed file. Refetching
    // changes nothing on its own — but the author is the one who can fix a
    // wrong path, and once they have, this reloads the one track rather than
    // making them reload the page.
    expect(
      target.querySelector(`.${CSS_PREFIX}-error-retry`)
    ).not.toBeNull();
  });

  it('logs only the routed line for a failed text file, not a decoder line too', async () => {
    // The decoder used to run on the empty placeholder a failed fetch leaves,
    // and printed "expected a text body; got object" beside the 404 — pointing
    // at the body when the path was the problem.
    for (const format of ['csv', 'tsv', 'bed'] as const) {
      const path = `./hits.${format}`;
      vi.restoreAllMocks();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      stubFetch([[path.slice(1), { ok: false, status: 404 }]]);

      const el = buildLoaded(
        normConfig([
          sourceTrack('hits', { from: 'file', url: path, format, shape: 'feature' }),
        ]),
        { openGroups: ['g'] }
      );
      await el._loadData();

      expect(warn.mock.calls.map((c) => String(c[0])), path).toEqual([
        expect.stringMatching(PATH_HINT),
      ]);
    }
  });

  it('keeps an API-source 404 silent (missing, not broken)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad.json', { ok: false, status: 404 }]]);
    const events: ErrorEvent[] = [];

    const el = buildLoaded(
      normConfig([urlTrack('bad', 'https://example.org/bad.json')]),
      { openGroups: ['g'] }
    );
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    expect(target.querySelector(BADGE)).toBeNull();
    expect(events.some((e) => e.detail.phase === 'track-fetch')).toBe(false);
  });

  it('surfaces a from: file 404 on a standalone row too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/hits.csv', { ok: false, status: 404 }]]);

    const el = buildLoaded(standaloneConfig(fileTrack('hits', './hits.csv')));
    await el._loadData();
    const target = renderTarget(el);

    const badge = target.querySelector(BADGE)!;
    expect(badge).not.toBeNull();
    const descId = badge.getAttribute('aria-describedby')!;
    expect(target.querySelector(`[id="${descId}"]`)!.textContent).toMatch(
      PATH_HINT
    );
  });

  it('still reports a from: file 5xx as a server failure, with Retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/hits.csv', { ok: false, status: 503 }]]);

    const el = buildLoaded(normConfig([fileTrack('hits', './hits.csv')]), {
      openGroups: ['g'],
    });
    await el._loadData();
    const target = renderTarget(el);

    const descId = target
      .querySelector(BADGE)!
      .getAttribute('aria-describedby')!;
    const detail = target.querySelector(`[id="${descId}"]`)!.textContent!;
    expect(detail).toMatch(/HTTP 503/);
    expect(detail).not.toMatch(PATH_HINT);
    expect(target.querySelector(`.${CSS_PREFIX}-error-retry`)).not.toBeNull();
  });
});

// ── standalone rows ───────────────────────────────────────────────

describe('standalone row error badge', () => {
  const ALL_HIDDEN = `.${CSS_PREFIX}-all-hidden`;

  it('keeps a broken standalone row on the canvas with a badge and Retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);
    const events: ErrorEvent[] = [];

    const el = buildLoaded(
      standaloneConfig(urlTrack('solo', 'https://example.org/bad.json'))
    );
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    // The row is still here, carrying the same badge a grouped track gets…
    expect(target.querySelector(`#${CSS_PREFIX}-group_solo`)).not.toBeNull();
    const badge = target.querySelector(BADGE)!;
    expect(badge).not.toBeNull();
    expect(badge.getAttribute('role')).toBe('img');
    const descId = badge.getAttribute('aria-describedby')!;
    expect(target.querySelector(`[id="${descId}"]`)!.textContent).toMatch(
      /HTTP 500/
    );
    // …a 5xx is transient, so Retry is offered here too…
    expect(
      target.querySelector(`.${CSS_PREFIX}-error-retry`)
    ).not.toBeNull();
    // …and the event fires naming the standalone track.
    const tf = events.find((e) => e.detail.phase === 'track-fetch');
    expect(tf!.detail.context.trackId).toBe('solo');
  });

  it('does not claim "All tracks are hidden" for a failed standalone row', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);

    const el = buildLoaded(
      standaloneConfig(urlTrack('solo', 'https://example.org/bad.json'))
    );
    await el._loadData();
    const target = renderTarget(el);

    // The notice (and its Reset layout button, which would fix nothing) is
    // for a canvas the *user* emptied — not for a load failure.
    expect(target.querySelector(ALL_HIDDEN)).toBeNull();
  });

  it('still shows the hidden notice when the row is genuinely hidden', async () => {
    const config = standaloneConfig(customTrack('solo'));
    config.rows[0].hidden = true;
    config.rows[0].tracks[0].hidden = true;
    const el = buildLoaded(config, {
      customTrackData: { 'solo-solo': [{ type: 'DOMAIN', start: 1, end: 10 }] },
      hasData: true,
    });

    await el._loadData();
    const target = renderTarget(el);

    expect(target.querySelector(ALL_HIDDEN)).not.toBeNull();
  });

  it('says there is no data, not that tracks are hidden, when a filter matches nothing', async () => {
    // The raw response has features, so `hasData` is set — but none of them
    // are the track's `filter:` type, so no row draws. Nothing is hidden, and
    // a Reset-layout button would fix nothing.
    const track = {
      ...urlTrack('solo', 'https://example.org/f.json'),
      filter: 'DOMAIN',
    };
    stubFetch([
      [
        '/f.json',
        {
          ok: true,
          status: 200,
          body: { features: [{ type: 'CHAIN', begin: '1', end: '8' }] },
        },
      ],
    ]);
    const el = buildLoaded(standaloneConfig(track));

    await el._loadData();
    const target = renderTarget(el);

    expect(el.hasData).toBe(true);
    expect(target.querySelector(ALL_HIDDEN)).toBeNull();
    expect(target.querySelector('.protvista-no-results')).not.toBeNull();
  });

  it('does not carry hasData over to a full load that finds nothing', async () => {
    // An accession change is a full load. The previous entry's `hasData` used
    // to stick, so an entry whose every track was missing claimed its tracks
    // were hidden.
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 404 }]]);
    const el = buildLoaded(
      standaloneConfig(urlTrack('solo', 'https://example.org/bad.json')),
      { hasData: true }
    );

    await el._loadData();
    const target = renderTarget(el);

    expect(el.hasData).toBe(false);
    expect(target.querySelector(ALL_HIDDEN)).toBeNull();
    expect(target.querySelector('.protvista-no-results')).not.toBeNull();
  });

  it('drops a 4xx standalone row silently (missing, not broken)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 404 }]]);

    const el = buildLoaded(
      standaloneConfig(urlTrack('solo', 'https://example.org/bad.json'))
    );
    await el._loadData();
    const target = renderTarget(el);

    expect(target.querySelector(BADGE)).toBeNull();
    expect(target.querySelector('.protvista-no-results')).not.toBeNull();
  });

  it('renders no content cell under the badge (no empty canvas to mislead)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);

    const el = buildLoaded(
      standaloneConfig(urlTrack('solo', 'https://example.org/bad.json'))
    );
    await el._loadData();
    const target = renderTarget(el);

    const row = target.querySelector(`#${CSS_PREFIX}-group_solo`)!;
    expect(
      row.querySelector(`[data-id="${CSS_PREFIX}-track_solo"]`)
    ).toBeNull();
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

      rows: [
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

      rows: [
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
      rows: [
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

  it('two concurrent per-track retries in the SAME group keep both in the aggregate', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let healthy = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (!healthy) {
          return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
        }
        // Distinct feature per track so we can tell them apart in the aggregate.
        const type = url.includes('/a.json') ? 'A' : 'B';
        return {
          ok: true,
          status: 200,
          json: async () => ({ features: [{ type, begin: '1', end: '2' }] }),
        } as unknown as Response;
      })
    );

    // ONE group with TWO url tracks. Their per-track retry keys (g-a, g-b)
    // are disjoint, so the two retries run concurrently — but they share a
    // group aggregate `data['g']`.
    const el = buildLoaded(
      normConfig([
        urlTrack('a', 'https://example.org/a.json'),
        urlTrack('b', 'https://example.org/b.json'),
      ]),
      { hasData: true }
    );

    await el._loadData();
    expect(el._trackErrors.has('g-a')).toBe(true);
    expect(el._trackErrors.has('g-b')).toBe(true);

    // Both recover; fire both per-track retries with no await between. Each
    // snapshots `this.data` before the other commits, so a snapshot-derived
    // group aggregate would clobber to the last writer, dropping one track.
    healthy = true;
    await Promise.all([
      el._loadData(new Set(['g-a'])),
      el._loadData(new Set(['g-b'])),
    ]);

    // Per-track keys correct AND the group aggregate holds BOTH tracks.
    expect(el.data['g-a']).toBeDefined();
    expect(el.data['g-b']).toBeDefined();
    const aggregate = el.data['g'] as Array<{ type?: string }>;
    expect(Array.isArray(aggregate)).toBe(true);
    const types = aggregate.map((f) => f.type).sort();
    expect(types).toEqual(['A', 'B']);
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

  it('clicking the aggregated-panel Retry re-runs the load and tears the panel down on recovery', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let trackHealthy = false;
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
        // The one track: 5xx until the service recovers. Its data is an
        // authored `.json` URL, so the healthy body is the bare array the
        // `features-json` decoder reads — a wrapped object would now fail it.
        return trackHealthy
          ? ({
              ok: true,
              status: 200,
              json: async () => [{ type: 'X', start: 1, end: 2 }],
            } as unknown as Response)
          : ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);
      })
    );

    const el = mountEl({
      viewerConfig: {
        strict: true,
        rows: [
          { id: 'g', tracks: [{ id: 'bad', kind: 'features', data: 'https://example.org/bad.json' }] },
        ],
      },
      accession: 'P05067',
    });

    // Strict raises the aggregated panel with a Retry (5xx is recoverable).
    const retry = await vi.waitFor(() => {
      const btn = el.querySelector<HTMLButtonElement>(
        `${PANEL} .${CSS_PREFIX}-error-retry`
      );
      if (!btn) throw new Error('strict retry not ready');
      return btn;
    });

    // Service recovers, then the user clicks Retry → _retryMount re-runs the
    // whole load; the track succeeds, so the strict panel is cleared.
    trackHealthy = true;
    retry.click();

    await vi.waitFor(() => {
      if (el.querySelector(PANEL)) throw new Error('panel still present');
    });
    expect((el as unknown as El)._mountError).toBeNull();
    expect((el as unknown as El)._trackErrors.size).toBe(0);
    expect(el.data['g-bad']).toBeDefined();
  });

  it('a successful reload clears a previously-raised aggregated panel (track-fetch clear branch)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let healthy = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        healthy
          ? ({
              ok: true,
              status: 200,
              json: async () => [{ type: 'X', start: 1, end: 2 }],
            } as unknown as Response)
          : ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
      )
    );

    const el = buildLoaded(
      normConfig([urlTrack('bad', 'https://example.org/bad.json')], {
        strict: true,
      }),
      { hasData: true }
    );

    await el._loadData();
    // Panel is up under strict while the track is failing.
    expect(el._mountError).not.toBeNull();
    expect(el._mountError!.phase).toBe('track-fetch');

    // A subsequent successful reload must clear the aggregated panel via the
    // `phase === 'track-fetch'` clear branch in _collectTrackErrors.
    healthy = true;
    await el._loadData();
    expect(el._mountError).toBeNull();
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

// ── aggregate data hygiene ────────────────────────────────────────

describe('aggregate data hygiene', () => {
  it('an all-failed canvas group renders the minimal error row, not an aggregate over holes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);

    // A standard (canvas) group whose only track 5xx-fails. Its flattened
    // aggregate is `[undefined]` before filtering — truthy-but-holey.
    const el = buildLoaded(
      normConfig([urlTrack('bad', 'https://example.org/bad.json')]),
      { hasData: false, openGroups: [] }
    );

    await el._loadData();

    // The aggregate is a clean empty array — no `undefined` slot leaks to
    // Nightingale's `.data` setter.
    expect(el.data['g']).toEqual([]);

    const target = renderTarget(el);
    // Routed through `renderGroupErrorRow`: header + ⚠ badge, and crucially
    // NO aggregate content track (which the normal path would render).
    expect(target.querySelector(BADGE)).not.toBeNull();
    expect(
      target.querySelector(`.${CSS_PREFIX}-aggregate-track-content`)
    ).toBeNull();
  });

  it('a partial canvas-group failure leaves the surviving features but no holes', async () => {
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

    // One group, two tracks: one succeeds, one 5xx-fails. The aggregate
    // used to be `[...features, undefined]`.
    const el = buildLoaded(
      normConfig([
        urlTrack('ok', 'https://example.org/ok.json'),
        urlTrack('bad', 'https://example.org/bad.json'),
      ]),
      { hasData: true }
    );

    await el._loadData();

    const aggregate = el.data['g'] as unknown[];
    expect(Array.isArray(aggregate)).toBe(true);
    expect(aggregate).not.toContain(undefined);
    expect(aggregate.length).toBeGreaterThan(0);
  });

  it('an EXPANDED all-failed group shows per-track badges and no populated aggregate track', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([
      ['/a.json', { ok: false, status: 500 }],
      ['/b.json', { ok: false, status: 500 }],
    ]);

    // Expanded (openGroups) all-failed group: falls through to the normal
    // per-track render, not the collapsed error row. Its aggregate is `[]`.
    const el = buildLoaded(
      normConfig([
        urlTrack('a', 'https://example.org/a.json'),
        urlTrack('b', 'https://example.org/b.json'),
      ]),
      { hasData: false, openGroups: ['g'] }
    );

    await el._loadData();
    expect(el.data['g']).toEqual([]);

    const target = renderTarget(el);
    // Per-track rows each carry a ⚠ badge (the group badge is suppressed
    // while expanded).
    expect(target.querySelectorAll(BADGE).length).toBe(2);
    // The aggregate content div is present but renders NO inner track over
    // the empty `[]` (the gate is `hasRenderableData`, not a bare truthy
    // check — an empty array is truthy but has nothing to draw).
    const aggregate = target.querySelector(
      `.${CSS_PREFIX}-aggregate-track-content`
    );
    expect(aggregate).not.toBeNull();
    expect(aggregate!.querySelector('*')).toBeNull();
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

// ── render handover ───────────────────────────────────────────────

describe('a component rejecting its payload', () => {
  /** An element whose `data` setter throws, like a real mismatched track. */
  const exploding = () => ({
    set data(_v: unknown) {
      throw new TypeError('undefined is not iterable');
    },
  });

  it('badges the row and fires the event, not just a console line', async () => {
    // The last step of the pipeline, and the one that used to be console-only:
    // the payload was built fine and the Nightingale element could not read
    // it. The message ends with advice for whoever wrote the data, which is
    // exactly the audience a console-only report misses.
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    // An expanded group with an aggregate: the group badge stands down there,
    // so the badge under test is unambiguously the track's own.
    const el = buildLoaded(normConfig([customTrack('t')]), {
      openGroups: ['g'],
      hasData: true,
      data: { g: [{ type: 'DOMAIN' }], 'g-t': [{ type: 'DOMAIN' }] },
    });
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    el._assignComponentData(exploding(), [{ type: 'DOMAIN' }], 'g-t');
    const target = renderTarget(el);

    const badges = target.querySelectorAll(BADGE);
    expect(badges).toHaveLength(1);
    const badge = badges[0];
    expect(badge).not.toBeNull();
    const descId = badge.getAttribute('aria-describedby')!;
    expect(target.querySelector(`[id="${descId}"]`)!.textContent).toContain(
      "track 'g-t' could not render the data it was given"
    );
    // Deterministic — the same payload will not read better on a second go.
    expect(target.querySelector(`.${CSS_PREFIX}-error-retry`)).toBeNull();

    const tf = events.find((e) => e.detail.phase === 'track-fetch')!;
    expect(tf.detail.context.errorKind).toBe('render');
    expect(tf.detail.context.trackId).toBe('t');
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('does not take the other tracks down with it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = buildLoaded(
      normConfig([customTrack('bad'), customTrack('good')])
    );
    const received: unknown[] = [];
    const healthy = {
      set data(v: unknown) {
        received.push(v);
      },
    };

    el._assignComponentData(exploding(), [{ position: 1 }], 'g-bad');
    el._assignComponentData(healthy, [{ position: 2 }], 'g-good');

    expect(received).toEqual([[{ position: 2 }]]);
    expect(el._trackErrors.has('g-bad')).toBe(true);
    expect(el._trackErrors.has('g-good')).toBe(false);
  });

  it('reports once, not on every re-push', async () => {
    // The push walk re-runs whenever a group expands or data changes, and the
    // same payload fails the same way each time. Re-firing the event on every
    // expand would be noise over a badge that is already up.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('t')]));
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    for (let i = 0; i < 3; i += 1) {
      el._assignComponentData(exploding(), [{ type: 'DOMAIN' }], 'g-t');
    }

    expect(events).toHaveLength(1);
  });

  it('promotes to the panel under strict', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('t')], { strict: true }));

    el._assignComponentData(exploding(), [{ type: 'DOMAIN' }], 'g-t');

    expect(el._mountError?.phase).toBe('track-fetch');
    expect(el._mountError?.summary).toContain("Track 'g/t' failed to load");
  });

  it("attributes a collapsed group's aggregate to the row, not to a track", async () => {
    // The push walk hands over two key shapes. A bare row id is the aggregate
    // a collapsed group draws every track from — there is no one track to
    // blame, so the group badge carries the message and the event omits
    // `trackId` rather than reporting it as null.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('t')]), {
      data: { g: [{ type: 'DOMAIN' }] },
      hasData: true,
    });
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    el._assignComponentData(exploding(), [{ type: 'DOMAIN' }], 'g');
    const target = renderTarget(el);

    expect(el._trackErrors.get('g')!.trackId).toBeNull();
    const tf = events.find((e) => e.detail.phase === 'track-fetch')!;
    expect(tf.detail.context.groupId).toBe('g');
    expect('trackId' in tf.detail.context).toBe(false);

    const badge = target.querySelector(BADGE)!;
    expect(badge).not.toBeNull();
    const descId = badge.getAttribute('aria-describedby')!;
    // The aggregate's own message, not the generic "Some tracks…" count.
    expect(target.querySelector(`[id="${descId}"]`)!.textContent).toContain(
      'could not render the data it was given'
    );
  });

  it('still reports a key that matches no row, without promising a badge', async () => {
    // The walk and the config disagreeing should not happen — and if it does,
    // going unreported is the one outcome worse than having no row to badge.
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('t')]));
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    el._assignComponentData(exploding(), [{ type: 'DOMAIN' }], 'nonexistent');

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);
    expect(el._trackErrors.has('nonexistent')).toBe(false);
    expect(el._mountError).toBeNull();
  });
});

// ── what the event itself carries ─────────────────────────────────

describe('the protvista-error payload', () => {
  it('carries the message the track badge shows', async () => {
    // One listener covers every flavour — so every flavour has to say what
    // happened, not just which bucket it fell into. The badge, the panel, the
    // console line and this field all come from one string.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad.json', { ok: false, status: 503 }]]);
    const events: ErrorEvent[] = [];

    const el = buildLoaded(
      normConfig([urlTrack('bad', 'https://example.org/bad.json')]),
      { openGroups: ['g'] }
    );
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    const tf = events.find((e) => e.detail.phase === 'track-fetch')!;
    const descId = target
      .querySelector(BADGE)!
      .getAttribute('aria-describedby')!;
    expect(tf.detail.message).toBe(
      target.querySelector(`[id="${descId}"]`)!.textContent
    );
    expect(tf.detail.source).toBe('https://example.org/bad.json');
  });

  it('carries the sequence-panel wording an embedder would otherwise re-invent', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/proteins/api/proteins/', { ok: false, status: 404 }]]);
    const events: ErrorEvent[] = [];

    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067X' });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await vi.waitFor(() => {
      if (!events.some((e) => e.detail.phase === 'sequence')) {
        throw new Error('no sequence event yet');
      }
    });

    const seq = events.find((e) => e.detail.phase === 'sequence')!;
    // Exactly the panel's text — not the developer line, which says
    // "loadEntry returned no usable sequence" and is no use to a reader.
    await vi.waitFor(() => {
      if (!el.querySelector(PANEL)) throw new Error('panel not ready');
    });
    expect(seq.detail.message).toBe(
      el.querySelector(`.${CSS_PREFIX}-error-panel__summary`)!.textContent
    );
    expect(seq.detail.message).toContain('P05067X');
    expect(seq.detail.message).not.toContain('[protvista');
    expect(seq.detail.severity).toBe('error');
    // A fetch failure names where the sequence was asked for, as the
    // documented `source` and `context.url` say it does.
    const entry = 'https://www.ebi.ac.uk/proteins/api/proteins/P05067X';
    expect(seq.detail.source).toBe(entry);
    expect(seq.detail.context.url).toBe(entry);
  });

  it('names the source of a payload its component could not draw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubFetch([['/x.json', { ok: true, status: 200, body: { features: [] } }]]);
    const events: ErrorEvent[] = [];
    const el = buildLoaded(
      normConfig([urlTrack('t', 'https://example.org/x.json')]),
      { openGroups: ['g'] }
    );
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));
    await el._loadData();

    el._assignComponentData(
      {
        set data(_v: unknown) {
          throw new TypeError('undefined is not iterable');
        },
      },
      [{ bad: true }],
      'g-t'
    );

    const render = events.find((e) => e.detail.context.errorKind === 'render')!;
    expect(render.detail.source).toBe('https://example.org/x.json');
    expect(render.detail.context.url).toBe('https://example.org/x.json');
  });

  it('carries the config panel\'s summary for a rejected config', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const events: ErrorEvent[] = [];
    const el = mountEl({ viewerConfig: INVALID_CONFIG, accession: 'P05067' });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await vi.waitFor(() => {
      if (!events.some((e) => e.detail.phase === 'config')) {
        throw new Error('no config event yet');
      }
    });

    const cfg = events.find((e) => e.detail.phase === 'config')!;
    expect(cfg.detail.message).toMatch(/^Config validation failed \(\d+ issue/);
    expect(cfg.detail.severity).toBe('error');
  });

  it('omits source when the failure had no URL or path to name', async () => {
    // An adapter failure on an inline / custom source has nowhere to point.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const events: ErrorEvent[] = [];
    const el = buildLoaded(normConfig([customTrack('t')]));
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    el.setTrackData('g', 'nope', [{ type: 'DOMAIN' }]);

    expect(events[0].detail.message).toContain('setTrackData');
    expect('source' in events[0].detail).toBe(false);
  });
});

// ── routing matrix ────────────────────────────────────────────────

/**
 * Every failure class the viewer has, and the channels each one reaches.
 *
 * This is the test the old ad-hoc routing could not have: routing lived as a
 * conditional at each failure site, so "which failures reach a user" was only
 * answerable by reading eight call sites and hoping. Several of them answered
 * "none" — a 4xx reaching nothing, an adapter throw reaching only the console,
 * a badge appearing on grouped rows but not standalone ones. Now one table in
 * `src/errors/router.ts` decides, and this walks every class through it.
 *
 * `src/errors/__spec__/router.spec.ts` pins the table itself (totality, the
 * published documentation, the one place `strict` is read). This pins that the
 * failures actually get there. The two classes that cannot be driven through
 * `_loadData` have their own blocks: the render handover above, and the
 * viewer-scoped config / sequence / `setTrackData` failures below.
 */

/** The channels a class is expected to reach, lax and under `strict`. */
type Expected = {
  /** `protvista-error` phase, or `null` for a class that deliberately fires none. */
  phase: string | null;
  /** The `⚠` badge, when there is a viewer to draw it in (see below). */
  badge: boolean;
  retry: boolean;
  /** Panel without `strict`, and with it. */
  panel: [lax: boolean, strict: boolean];
  consoleLevel: 'error' | 'warn' | 'info';
  /** The routed console line, which must appear exactly once at that level. */
  consoleMatch: RegExp;
};

describe('routing matrix — track-scoped failures', () => {
  const BAD_CSV = 'type,start,end,description\nDOMAIN,abc,25,Kinase domain';

  const cases: Array<{
    name: string;
    config: (strict: boolean) => NormalizedConfig;
    routes: Parameters<typeof stubFetch>[0];
    expected: Expected;
  }> = [
    {
      name: 'network error (unreachable, blocked, CORS)',
      config: (strict) =>
        normConfig([urlTrack('t', 'https://example.org/x.json')], { strict }),
      // No route matches, so the stub resolves 200 — overridden below.
      routes: [],
      expected: {
        phase: 'track-fetch',
        badge: true,
        retry: true,
        panel: [false, true],
        consoleLevel: 'warn',
        consoleMatch: /Couldn't reach https:\/\/example\.org\/x\.json/,
      },
    },
    {
      name: 'HTTP 5xx (server failing)',
      config: (strict) =>
        normConfig([urlTrack('t', 'https://example.org/x.json')], { strict }),
      routes: [['/x.json', { ok: false, status: 503 }]],
      expected: {
        phase: 'track-fetch',
        badge: true,
        retry: true,
        panel: [false, true],
        consoleLevel: 'warn',
        consoleMatch: /HTTP 503 — https:\/\/example\.org\/x\.json/,
      },
    },
    {
      name: 'HTTP 4xx from a provider endpoint (missing, not broken)',
      config: (strict) =>
        normConfig([urlTrack('t', 'https://example.org/x.json')], { strict }),
      routes: [['/x.json', { ok: false, status: 404 }]],
      expected: {
        phase: null,
        badge: false,
        retry: false,
        panel: [false, false],
        consoleLevel: 'info',
        consoleMatch: /track g\/t: no data \(HTTP 404\)/,
      },
    },
    {
      name: 'HTTP 4xx from a from: file path (broken path)',
      config: (strict) =>
        normConfig([fileTrack('t', './hits.csv')], { strict }),
      routes: [['/hits.csv', { ok: false, status: 404 }]],
      expected: {
        phase: 'track-fetch',
        badge: true,
        // Retryable in place once the author fixes the path.
        retry: true,
        panel: [false, true],
        consoleLevel: 'warn',
        consoleMatch: /\.\/hits\.csv could not be found \(HTTP 404\)/,
      },
    },
    {
      name: 'HTTP 4xx from an absolute URL to the author\'s own file',
      // The troubleshooting page suggests an absolute URL as the fix for a
      // relative-path mix-up; a typo in it must not go silent.
      config: (strict) =>
        normConfig(
          [
            sourceTrack('t', {
              from: 'url',
              url: 'https://example.org/hits.csv',
              format: 'csv',
              shape: 'feature',
            }),
          ],
          { strict }
        ),
      routes: [['/hits.csv', { ok: false, status: 404 }]],
      expected: {
        phase: 'track-fetch',
        badge: true,
        retry: true,
        panel: [false, true],
        consoleLevel: 'warn',
        consoleMatch:
          /https:\/\/example\.org\/hits\.csv could not be found \(HTTP 404\) — check the URL\./,
      },
    },
    {
      name: 'HTTP 4xx from the { url } object form of an authored file',
      config: (strict) =>
        normConfig(
          [
            sourceTrack('t', {
              from: 'url',
              url: './hits.csv',
              format: 'csv',
              shape: 'feature',
            }),
          ],
          { strict }
        ),
      routes: [['/hits.csv', { ok: false, status: 404 }]],
      expected: {
        phase: 'track-fetch',
        badge: true,
        retry: true,
        panel: [false, true],
        consoleLevel: 'warn',
        consoleMatch: /\.\/hits\.csv could not be found \(HTTP 404\) — check the URL\./,
      },
    },
    {
      name: 'HTTP 4xx from a from: file path with an explicit adapter',
      // The descriptor the validator recommends for a file it cannot sniff.
      // It has no `format`, but the path is still the author's to get wrong.
      config: (strict) =>
        normConfig(
          [
            sourceTrack('t', {
              from: 'file',
              url: './plddt.json',
              adapter: 'uniprot-features-json',
            }),
          ],
          { strict }
        ),
      routes: [['/plddt.json', { ok: false, status: 404 }]],
      expected: {
        phase: 'track-fetch',
        badge: true,
        retry: true,
        panel: [false, true],
        consoleLevel: 'warn',
        consoleMatch:
          /\.\/plddt\.json could not be found \(HTTP 404\) — check the path is relative to the page\./,
      },
    },
    {
      name: 'unparseable body',
      config: (strict) =>
        normConfig([urlTrack('t', 'https://example.org/x.json')], { strict }),
      routes: [['/x.json', { ok: true, status: 200, unreadable: true }]],
      expected: {
        phase: 'track-fetch',
        badge: true,
        retry: false,
        panel: [false, true],
        consoleLevel: 'warn',
        // The parser's own complaint rides along: on an author's file it is
        // the position that makes the file fixable.
        consoleMatch:
          /Unparseable response from https:\/\/example\.org\/x\.json \(Unexpected token < in JSON\)/,
      },
    },
    {
      name: 'malformed file the decoder rejected',
      config: (strict) =>
        normConfig([fileTrack('t', './hits.csv')], { strict }),
      routes: [['/hits.csv', { ok: true, status: 200, body: BAD_CSV }]],
      expected: {
        phase: 'track-fetch',
        badge: true,
        retry: false,
        panel: [false, true],
        consoleLevel: 'warn',
        consoleMatch: /row 2, column "start": expected a number, got "abc"/,
      },
    },
    {
      name: 'JSON file whose top level is not an array',
      // `{ "features": [...] }` — the commonest wrong container. It used to
      // warn and render an empty track, with no badge to say why.
      config: (strict) =>
        normConfig(
          [
            sourceTrack('t', {
              from: 'file',
              url: './hits.json',
              format: 'json',
              shape: 'feature',
            }),
          ],
          { strict }
        ),
      routes: [
        ['/hits.json', { ok: true, status: 200, body: { features: [] } }],
      ],
      expected: {
        phase: 'track-fetch',
        badge: true,
        retry: false,
        panel: [false, true],
        consoleLevel: 'warn',
        consoleMatch:
          /\.\/hits\.json \(parsed as JSON\): expected an array of feature records; got object\./,
      },
    },
    {
      name: 'provider adapter whose own request failed',
      // The AlphaFold confidence adapter fetches a second file the loader
      // never sees. Its outage is as transient as a 5xx, and there is no file
      // for the reader to fix — so it gets a Retry and says where the data
      // came from.
      config: (strict) =>
        normConfig(
          [
            sourceTrack('t', {
              from: 'url',
              url: [
                'https://alphafold.example/api/prediction/P05067',
                'https://example.org/proteins/P05067',
              ],
              adapter: 'alphafold-prediction-json',
            }),
          ],
          { strict }
        ),
      routes: [
        [
          '/api/prediction/',
          {
            ok: true,
            status: 200,
            body: [
              {
                sequence: 'MSEQENCE',
                cifUrl:
                  'https://alphafold.example/files/AF-P05067-F1-model_v4.cif',
              },
            ],
          },
        ],
        [
          '/proteins/P05067',
          { ok: true, status: 200, body: { sequence: { sequence: 'MSEQENCE' } } },
        ],
        ['-confidence_v4.json', { ok: false, status: 503 }],
      ],
      expected: {
        phase: 'track-fetch',
        badge: true,
        retry: true,
        panel: [false, true],
        consoleLevel: 'warn',
        consoleMatch:
          /Couldn't process the data from https:\/\/alphafold\.example\/api\/prediction\/P05067: AlphaFold confidence data unavailable \(HTTP 503\)/,
      },
    },
    {
      name: 'AlphaMissense adapter whose own request failed',
      // Same second-request shape as the AlphaFold confidence file. It used to
      // log and return nothing, leaving the row silently empty.
      config: (strict) =>
        normConfig(
          [
            sourceTrack('t', {
              from: 'url',
              url: [
                'https://alphafold.example/api/prediction/P05067',
                'https://example.org/proteins/P05067',
              ],
              adapter: 'alphamissense-average-csv',
            }),
          ],
          { strict }
        ),
      routes: [
        [
          '/api/prediction/',
          {
            ok: true,
            status: 200,
            body: [
              {
                sequence: 'MSEQENCE',
                amAnnotationsUrl:
                  'https://alphafold.example/files/AF-P05067-F1-aa-substitutions.csv',
              },
            ],
          },
        ],
        [
          '/proteins/P05067',
          { ok: true, status: 200, body: { sequence: { sequence: 'MSEQENCE' } } },
        ],
        ['-aa-substitutions.csv', { ok: false, status: 503 }],
      ],
      expected: {
        phase: 'track-fetch',
        badge: true,
        retry: true,
        panel: [false, true],
        consoleLevel: 'warn',
        consoleMatch:
          /Couldn't process the data from https:\/\/alphafold\.example\/api\/prediction\/P05067: AlphaMissense pathogenicity data unavailable \(HTTP 503\)/,
      },
    },
    {
      name: 'unregistered adapter name',
      config: (strict) => {
        const config = normConfig(
          [urlTrack('t', 'https://example.org/x.json')],
          { strict }
        );
        config.rows[0].tracks[0].data[0].adapter = 'nope-not-registered';
        return config;
      },
      routes: [['/x.json', { ok: true, status: 200, body: { features: [] } }]],
      expected: {
        phase: 'track-fetch',
        badge: true,
        retry: false,
        panel: [false, true],
        consoleLevel: 'warn',
        consoleMatch: /No adapter registered for 'nope-not-registered'/,
      },
    },
    {
      name: 'from: custom with nothing injected',
      config: (strict) => normConfig([customTrack('t')], { strict }),
      routes: [],
      expected: {
        phase: null,
        badge: false,
        retry: false,
        panel: [false, false],
        consoleLevel: 'info',
        consoleMatch: /Track g\/t is 'from: custom' but no data was provided/,
      },
    },
  ];

  for (const { name, config, routes, expected } of cases) {
    for (const strict of [false, true]) {
      const label = strict ? `${name} [strict]` : name;
      it(`routes ${label}`, async () => {
        const spies = {
          error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
          warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
          info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
        };
        if (name.startsWith('network')) {
          vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
              throw new TypeError('Failed to fetch');
            })
          );
        } else {
          stubFetch(routes);
        }
        const events: ErrorEvent[] = [];

        const el = buildLoaded(config(strict), { openGroups: ['g'] });
        el.addEventListener('protvista-error', (e) =>
          events.push(e as ErrorEvent)
        );

        await el._loadData();
        const target = renderTarget(el);

        // Event channel.
        const fired = events.filter((e) => e.detail.phase === 'track-fetch');
        if (expected.phase === null) {
          expect(fired, 'should fire no event').toHaveLength(0);
        } else {
          expect(fired, 'should fire one event').toHaveLength(1);
          expect(fired[0].detail.context.trackId).toBe('t');
        }

        // Panel channel — the only one `strict` moves.
        const panelUp = expected.panel[strict ? 1 : 0];
        expect(el._mountError?.phase === 'track-fetch', 'panel').toBe(panelUp);

        // Badge + Retry channels. The panel *replaces* the viewer, so when
        // one is up there is no row to carry a badge — that is the panel's
        // whole job. Assert the badge where the viewer renders, and the
        // viewer's absence where it does not.
        if (panelUp) {
          expect(target.querySelector(BADGE), 'panel replaces the row').toBeNull();
          expect(target.querySelector(PANEL)).not.toBeNull();
        } else {
          expect(!!target.querySelector(BADGE), 'badge').toBe(expected.badge);
          expect(
            !!target.querySelector(`.${CSS_PREFIX}-error-retry`),
            'retry'
          ).toBe(expected.retry);
        }

        // Developer channel: the routed line appears exactly once, at the
        // routed level, and at no other level. Two copies would mean a site
        // still reporting for itself beside the router.
        //
        // Counting *all* console calls would be wrong here: the generic-format
        // decoders emit their own per-body diagnostics on the way to returning
        // empty (`specs/generic-format-adapters.md` — "diagnostic
        // console.warns, not exceptions"). Those degrade a row rather than
        // failing a track and are not part of this pipeline, so the assertion
        // is about the routed line specifically.
        const atLevel = (level: 'error' | 'warn' | 'info') =>
          spies[level].mock.calls.filter((c) =>
            expected.consoleMatch.test(String(c[0]))
          );
        for (const level of ['error', 'warn', 'info'] as const) {
          expect(atLevel(level), `routed line at console.${level}`).toHaveLength(
            level === expected.consoleLevel ? 1 : 0
          );
        }
      });
    }
  }
});

describe('routing matrix — viewer-scoped failures', () => {
  /** Mount, wait for the first `protvista-error`, and report what happened. */
  async function observe(props: Partial<El>): Promise<{
    el: El;
    events: ErrorEvent[];
  }> {
    const el = mountEl(props);
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));
    await vi.waitFor(() => {
      if (events.length === 0) throw new Error('no event yet');
    });
    return { el, events };
  }

  it('routes a config validation failure to the panel (always, strict or not)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { el, events } = await observe({
      viewerConfig: INVALID_CONFIG,
      accession: 'P05067',
    });
    expect(events[0].detail.phase).toBe('config');
    await vi.waitFor(() => {
      if (!el.querySelector(PANEL)) throw new Error('panel not ready');
    });
  });

  it('routes a config warning to the event only, never the panel', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const raise = vi.spyOn(
      customElements.get('protvista-uniprot')!.prototype as {
        _setMountError(phase: string): void;
      },
      '_setMountError'
    );
    const { events } = await observe({
      viewerConfig: {
        strict: true,
        rows: [
          {
            id: 'g',
            tracks: [
              {
                id: 'y',
                kind: 'features',
                data: { from: 'file', url: './hits.tsv', format: 'csv' },
              },
            ],
          },
        ],
      },
      accession: 'P05067',
    });
    expect(events[0].detail.phase).toBe('config');
    expect(events[0].detail.issues.map((i) => i.severity)).toEqual(['warning']);
    expect(raise.mock.calls.map(([phase]) => phase)).not.toContain('config');
  });

  it('routes an unresolvable theme field to the event only', async () => {
    // Previously console-only, which made it the one config problem an
    // embedder's single listener could not see.
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { events } = await observe({
      viewerConfig: {
        theme: { accentColor: 'not-a-colour' },
        rows: [
          {
            id: 'g',
            tracks: [
              { id: 'y', kind: 'features', data: 'https://example.org/x.json' },
            ],
          },
        ],
      },
      accession: 'P05067',
    });
    const cfg = events.find((e) => e.detail.phase === 'config')!;
    expect(cfg).toBeDefined();
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes('Ignoring theme.accentColor')
      )
    ).toBe(true);
    // No `issues` to carry a severity, so the event carries its own — or a
    // listener could not tell this from a config that failed to load.
    expect(cfg.detail.issues).toEqual([]);
    expect(cfg.detail.severity).toBe('warning');
    expect(cfg.detail.message).toMatch(/^Ignoring theme\.accentColor/);
  });

  it('routes a setTrackData misuse to the event, and to the panel under strict', async () => {
    // A rejected call named something the embedder asked for that did not
    // happen, which is what `strict` is for — unlike a config warning, which
    // names something that loaded as written and stays off the panel.
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('t')], { strict: true }));
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    el.setTrackData('g', 'nope', [{ type: 'DOMAIN' }]);

    expect(events.map((e) => e.detail.phase)).toEqual(['set-track-data']);
    expect(el._mountError?.phase).toBe('set-track-data');
    expect(warn.mock.calls.length).toBe(1);
  });

  it('keeps a setTrackData misuse off the panel without strict', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('t')]));

    el.setTrackData('g', 'nope', [{ type: 'DOMAIN' }]);

    expect(el._mountError).toBeNull();
  });
});

// ── track-data coordinate warning ─────────────────────────────────

describe('track-data coordinate warning', () => {
  const HITS_CSV =
    'type,start,end,description\nDOMAIN,1,10,a\nDOMAIN,5,812,b\nDOMAIN,0,20,c\n';
  const EXPECTED =
    "./hits.csv (parsed as CSV): 2 of 3 rows fall outside P05067 (770 residues); first: row 3, end 812. Coordinates must be 1-based positions on this protein's canonical sequence — check for 0-based coordinates (start 0) or isoform numbering.";
  const CONFIG = {
    rows: [
      { id: 'g', tracks: [{ id: 'y', kind: 'features', data: './hits.csv' }] },
    ],
  };

  type Res = { ok: boolean; status: number; json?: () => Promise<unknown> };

  /**
   * The entry (sequence) route returns a 770-residue protein unless
   * `entry` overrides it; a URL naming a key of `files` returns that
   * file's text; otherwise `hits.csv` returns `csv`; everything else is an
   * empty 200.
   */
  function stubRoutes(
    opts: {
      csv?: string;
      entry?: (url: string) => Promise<Res>;
      files?: Record<string, () => Promise<string>>;
    } = {}
  ) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/proteins/api/proteins/')) {
          if (opts.entry) return (await opts.entry(url)) as unknown as Response;
          return entryOf(770) as unknown as Response;
        }
        const file = Object.keys(opts.files ?? {}).find((name) =>
          url.includes(name)
        );
        if (file) {
          const text = await opts.files![file]();
          return {
            ok: true,
            status: 200,
            text: async () => text,
          } as unknown as Response;
        }
        if (url.includes('hits.csv')) {
          const csv = opts.csv ?? HITS_CSV;
          return {
            ok: true,
            status: 200,
            text: async () => csv,
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        } as unknown as Response;
      })
    );
  }

  /** An entry response carrying a `length`-residue sequence. */
  const entryOf = (length: number): Res => ({
    ok: true,
    status: 200,
    json: async () => ({ sequence: { sequence: 'A'.repeat(length) } }),
  });

  /** A promise held open until `release()` is called. */
  function gate() {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => (release = resolve));
    return { wait, release };
  }

  /** Let every pending fetch and promise callback run. */
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  function mountCollecting(props: Partial<El>) {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const el = mountEl({ accession: 'P05067', ...props });
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));
    const trackData = () =>
      events.filter((e) => e.detail.phase === 'track-data');
    return { el, events, trackData, warn };
  }

  it('fires phase:track-data with a coordinate-out-of-range warning for a CSV file', async () => {
    stubRoutes();
    const { el, trackData, warn } = mountCollecting({ viewerConfig: CONFIG });

    await vi.waitFor(() => expect(trackData()).toHaveLength(1));
    const [ev] = trackData();
    expect(ev.detail.issues).toEqual([
      {
        path: 'g/y',
        code: 'coordinate-out-of-range',
        severity: 'warning',
        message: EXPECTED,
      },
    ]);
    expect(ev.detail.context).toEqual({
      accession: 'P05067',
      groupId: 'g',
      trackId: 'y',
      url: './hits.csv',
    });
    expect(warn).toHaveBeenCalledWith(`[protvista-uniprot] ${EXPECTED}`);
    expect(el._mountError).toBeNull();
    // The track still renders every row as authored.
    expect(el.data['g-y']).toHaveLength(3);
  });

  it('checks when the data arrives before the sequence', async () => {
    const sequence = gate();
    stubRoutes({
      entry: async () => {
        await sequence.wait;
        return entryOf(770);
      },
    });
    const { el, trackData } = mountCollecting({ viewerConfig: CONFIG });

    await vi.waitFor(() => expect(el.data['g-y']).toBeDefined());
    expect(el.sequence).toBeUndefined();
    expect(trackData()).toHaveLength(0);

    sequence.release();
    await vi.waitFor(() => expect(trackData()).toHaveLength(1));
  });

  it('stays off the mount panel under strict', async () => {
    stubRoutes();
    const { el, trackData } = mountCollecting({
      viewerConfig: { ...CONFIG, strict: true },
    });

    await vi.waitFor(() => expect(trackData()).toHaveLength(1));
    await el.updateComplete;
    expect(el._mountError).toBeNull();
    expect(el.querySelector(PANEL)).toBeNull();
  });

  it('uses the bare track id as the path for a standalone row', async () => {
    stubRoutes();
    const { trackData } = mountCollecting({
      viewerConfig: {
        rows: [{ id: 'solo', kind: 'features', data: './hits.csv' }],
      },
    });

    await vi.waitFor(() => expect(trackData()).toHaveLength(1));
    const [ev] = trackData();
    expect(ev.detail.issues[0].path).toBe('solo');
    expect(ev.detail.context.trackId).toBe('solo');
  });

  it('fires once per data load: not on re-render, again on reload', async () => {
    stubRoutes();
    const { el, trackData } = mountCollecting({ viewerConfig: CONFIG });

    await vi.waitFor(() => expect(trackData()).toHaveLength(1));
    el.requestUpdate();
    await el.updateComplete;
    expect(trackData()).toHaveLength(1);

    await el._loadData();
    expect(trackData()).toHaveLength(2);
  });

  it('fires nothing when every row is within the sequence', async () => {
    stubRoutes({ csv: 'type,start,end,description\nDOMAIN,1,10,a\n' });
    const { el, trackData } = mountCollecting({ viewerConfig: CONFIG });

    await vi.waitFor(() => {
      expect(el.data['g-y']).toBeDefined();
      expect(el.sequence).toBeDefined();
    });
    expect(trackData()).toHaveLength(0);
  });

  it('fires nothing when no sequence loads', async () => {
    stubRoutes({
      entry: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    });
    const { el, events, trackData } = mountCollecting({ viewerConfig: CONFIG });

    await vi.waitFor(() => {
      expect(events.some((e) => e.detail.phase === 'sequence')).toBe(true);
      expect(el.data['g-y']).toBeDefined();
    });
    expect(trackData()).toHaveLength(0);
  });

  it('fires nothing for setTrackData() payloads', async () => {
    stubRoutes();
    const { el, trackData } = mountCollecting({
      viewerConfig: {
        rows: [
          {
            id: 'g',
            tracks: [{ id: 'y', kind: 'features', data: { from: 'custom' } }],
          },
        ],
      },
      customTrackData: { 'g-y': [{ type: 'DOMAIN', start: 0, end: 900 }] },
    });

    await vi.waitFor(() => {
      expect(el.data['g-y']).toBeDefined();
      expect(el.sequence).toBeDefined();
    });
    expect(trackData()).toHaveLength(0);
  });

  it('omits url from the context for inline data', async () => {
    stubRoutes();
    const { trackData } = mountCollecting({
      viewerConfig: {
        rows: [
          {
            id: 'g',
            tracks: [
              {
                id: 'y',
                kind: 'features',
                data: { inlineData: [{ type: 'DOMAIN', start: 0, end: 5 }] },
              },
            ],
          },
        ],
      },
    });

    await vi.waitFor(() => expect(trackData()).toHaveLength(1));
    const [ev] = trackData();
    expect(ev.detail.issues[0].message).toMatch(
      /^inline data \(parsed as JSON\): 1 of 1 rows fall outside P05067/
    );
    expect(ev.detail.context).not.toHaveProperty('url');
  });

  it('does not check data a setConfig() replaced before the sequence arrived', async () => {
    const sequence = gate();
    const newCsv = gate();
    stubRoutes({
      entry: async () => {
        await sequence.wait;
        return entryOf(770);
      },
      files: {
        'old.csv': async () => HITS_CSV,
        'new.csv': async () => {
          await newCsv.wait;
          return 'type,start,end,description\nDOMAIN,1,10,a\n';
        },
      },
    });
    const configFor = (data: string) => ({
      rows: [{ id: 'g', tracks: [{ id: 'y', kind: 'features', data }] }],
    });
    const { el, trackData } = mountCollecting({
      viewerConfig: configFor('./old.csv'),
    });
    await vi.waitFor(() => expect(el.data['g-y']).toBeDefined());

    // The new config is in place and its data is still loading when the
    // sequence lands: old.csv's rows must not be checked against it.
    await el.setConfig(configFor('./new.csv'));
    sequence.release();
    await vi.waitFor(() => expect(el.sequence).toBeDefined());
    expect(trackData()).toHaveLength(0);

    newCsv.release();
    await vi.waitFor(() => expect(el.data['g-y']).toBeDefined());
    await settle();
    expect(trackData()).toHaveLength(0);
  });

  it('fires once when a mount Retry reloads data still waiting for the sequence', async () => {
    let entryCalls = 0;
    let csvCalls = 0;
    const sequence = gate();
    const csv = gate();
    stubRoutes({
      entry: async () => {
        if (entryCalls++ === 0) {
          return { ok: false, status: 503, json: async () => ({}) };
        }
        await sequence.wait;
        return entryOf(770);
      },
      files: {
        'hits.csv': async () => {
          if (csvCalls++ > 0) await csv.wait;
          return HITS_CSV;
        },
      },
    });
    const { el, trackData } = mountCollecting({ viewerConfig: CONFIG });
    const retry = await vi.waitFor(() => {
      const btn = el.querySelector<HTMLButtonElement>(
        `${PANEL} .${CSS_PREFIX}-error-retry`
      );
      if (!btn) throw new Error('retry not ready');
      return btn;
    });
    await vi.waitFor(() => expect(el.data['g-y']).toBeDefined());

    // The retry's sequence lands before its re-fetched data.
    retry.click();
    sequence.release();
    await vi.waitFor(() => expect(el.sequence).toBeDefined());
    expect(trackData()).toHaveLength(0);

    csv.release();
    await vi.waitFor(() => expect(trackData()).toHaveLength(1));
    await settle();
    expect(trackData()).toHaveLength(1);
  });

  it('does not check rows a reload dropped before the sequence arrived', async () => {
    let csvCalls = 0;
    const sequence = gate();
    stubRoutes({
      entry: async () => {
        await sequence.wait;
        return entryOf(770);
      },
      files: {
        // The reload's data fails layer 1, so the track has no rows.
        'hits.csv': async () =>
          csvCalls++ === 0
            ? HITS_CSV
            : 'type,start,end,description\nDOMAIN,5,4,a\n',
      },
    });
    const { el, trackData } = mountCollecting({ viewerConfig: CONFIG });
    await vi.waitFor(() => expect(el.data['g-y']).toBeDefined());

    await el._loadData();
    sequence.release();
    await vi.waitFor(() => expect(el.sequence).toBeDefined());
    await settle();
    expect(trackData()).toHaveLength(0);
  });

  it('checks a new accession against its own sequence, not the previous one', async () => {
    const next = gate();
    stubRoutes({
      entry: async (url) => {
        if (url.includes('P12345')) {
          await next.wait;
          return entryOf(1200);
        }
        return entryOf(770);
      },
    });
    const { el, trackData } = mountCollecting({ viewerConfig: CONFIG });
    await vi.waitFor(() => expect(trackData()).toHaveLength(1));

    // P12345's data commits while P05067's sequence is still stored.
    const load = vi.spyOn(el, '_loadData');
    el.accession = 'P12345';
    await vi.waitFor(() => expect(load).toHaveBeenCalled());
    await load.mock.results[0].value;
    expect(trackData()).toHaveLength(1);

    next.release();
    await vi.waitFor(() => expect(trackData()).toHaveLength(2));
    expect(trackData()[1].detail.issues[0].message).toContain(
      '1 of 3 rows fall outside P12345 (1200 residues); first: row 4, start 0.'
    );
  });

  it("ignores a superseded accession's sequence that arrives late", async () => {
    let csvCalls = 0;
    const first = gate();
    const csv = gate();
    stubRoutes({
      entry: async (url) => {
        if (url.includes('P12345')) return entryOf(100);
        await first.wait;
        return entryOf(1000);
      },
      files: {
        'hits.csv': async () => {
          if (csvCalls++ > 0) await csv.wait;
          return HITS_CSV;
        },
      },
    });
    const { el, trackData } = mountCollecting({ viewerConfig: CONFIG });
    await vi.waitFor(() => expect(el.data['g-y']).toBeDefined());

    el.accession = 'P12345';
    await vi.waitFor(() => expect(el.sequence).toHaveLength(100));

    first.release();
    await settle();
    expect(el.sequence).toHaveLength(100);

    csv.release();
    await vi.waitFor(() => expect(trackData()).toHaveLength(1));
    expect(trackData()[0].detail.issues[0].message).toContain(
      '2 of 3 rows fall outside P12345 (100 residues)'
    );
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
      rows: [
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
    const res = await loadProtvistaData(
      'P05067',
      config,
      fetchOne,
      (name) => adapters[name]
    );

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

// ── classification and render-state edge cases ───────────────────

describe('a track that fetches several URLs', () => {
  const twoUrlTrack = (adapter = 'uniprot-features-json') =>
    sourceTrack('t', {
      from: 'url',
      url: ['https://example.org/a.json', 'https://example.org/b.json'],
      adapter,
    });

  it('badges a 5xx on one URL even when another answered a provider 404', async () => {
    // Only the first failed URL used to be classified, so a provider 404 on
    // `a` hid a 503 on `b` completely — no badge, no event, no console line.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    stubFetch([
      ['/a.json', { ok: false, status: 404 }],
      ['/b.json', { ok: false, status: 503 }],
    ]);
    const el = buildLoaded(normConfig([twoUrlTrack()]));

    await el._loadData();

    const err = el._trackErrors.get('g-t')!;
    expect(err.status).toBe(503);
    expect(err.url).toBe('https://example.org/b.json');
    expect(info).not.toHaveBeenCalled();
  });

  it('logs one console line per provider URL that had nothing', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    stubFetch([
      ['/a.json', { ok: false, status: 404 }],
      ['/b.json', { ok: false, status: 404 }],
    ]);
    const el = buildLoaded(normConfig([twoUrlTrack()]));

    await el._loadData();

    expect(el._trackErrors.size).toBe(0);
    expect(info.mock.calls.map(([line]) => String(line))).toEqual([
      '[protvista-uniprot] track g/t: no data (HTTP 404) at https://example.org/a.json.',
      '[protvista-uniprot] track g/t: no data (HTTP 404) at https://example.org/b.json.',
    ]);
  });

  it('does not print the adapter choking on the empty body under an HTTP line', async () => {
    // The Proteins API is down, so the AlphaFold adapter is handed `[]` for
    // the protein and throws reading `.sequence` off it. The 503 is the
    // explanation; that TypeError under it reads as a viewer bug.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([
      [
        '/a.json',
        { ok: true, status: 200, body: [{ sequence: 'MSEQENCE', cifUrl: 'x.cif' }] },
      ],
      ['/b.json', { ok: false, status: 503 }],
    ]);
    const el = buildLoaded(
      normConfig([twoUrlTrack('alphafold-prediction-json')])
    );

    await el._loadData();

    expect(el._trackErrors.get('g-t')!.kind).toBe('http');
    const line = warn.mock.calls.find(([m]) => String(m).includes('HTTP 503'))!;
    expect(line).toEqual(['HTTP 503 — https://example.org/b.json']);
  });
});

describe('the strict aggregated panel summary', () => {
  it('ends in one full stop when the failure text already has one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/hits.csv', { ok: false, status: 404 }]]);
    const el = buildLoaded(
      normConfig([fileTrack('t', './hits.csv')], { strict: true })
    );

    await el._loadData();

    expect(el._mountError?.summary).toBe(
      "Track 'g/t' failed to load — ./hits.csv could not be found (HTTP 404) — check the path is relative to the page."
    );
  });
});

describe('render failures over time', () => {
  const exploding = () => ({
    set data(_v: unknown) {
      throw new TypeError('undefined is not iterable');
    },
  });
  const accepting = () => ({ data: undefined as unknown });

  it('clears a stale aggregate failure once the rebuilt payload draws', () => {
    // Hiding the track that broke a collapsed group rebuilds the aggregate
    // without it. The new payload draws — so the row must stop saying it
    // cannot, especially as a `render` failure offers no Retry to lift it.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('t')]), {
      hasData: true,
      data: { g: [{ type: 'DOMAIN' }], 'g-t': [{ type: 'DOMAIN' }] },
    });
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    el._assignComponentData(exploding(), [{ bad: true }], 'g');
    // The same payload again — re-pushed on an expand — is not news.
    el._assignComponentData(exploding(), [{ bad: true }], 'g');
    expect(el._trackErrors.get('g')?.kind).toBe('render');
    expect(events).toHaveLength(1);
    expect(renderTarget(el).querySelector(BADGE)).not.toBeNull();

    el._assignComponentData(accepting(), [{ type: 'DOMAIN' }], 'g');

    expect(el._trackErrors.has('g')).toBe(false);
    expect(renderTarget(el).querySelector(BADGE)).toBeNull();
  });

  it('keeps a fetch failure, and its Retry, when the leftover payload will not draw', async () => {
    // The fetch failure is the explanation. Overwriting it with the render
    // message swapped a Retry that could fix the track for one that cannot.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    stubFetch([['/x.json', { ok: false, status: 503 }]]);
    const el = buildLoaded(
      normConfig([urlTrack('t', 'https://example.org/x.json')]),
      { openGroups: ['g'] }
    );
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));
    await el._loadData();
    expect(events).toHaveLength(1);

    el._assignComponentData(exploding(), [], 'g-t');

    expect(el._trackErrors.get('g-t')?.kind).toBe('http');
    expect(events).toHaveLength(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(
      renderTarget(el).querySelector(`.${CSS_PREFIX}-error-retry`)
    ).not.toBeNull();
  });
});

describe('a badge Retry during a full load', () => {
  it('lets the full load finish rather than aborting it', async () => {
    // A targeted Retry used to supersede an in-flight full load. The full
    // load's results — here the payload `setTrackData()` asked for — were
    // dropped with it, and the Retry only reloaded its own track.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/a.json', { ok: false, status: 503 }]]);
    const el = buildLoaded(
      normConfig([urlTrack('a', 'https://example.org/a.json'), customTrack('c')]),
      { openGroups: ['g'] }
    );
    await el._loadData();
    expect(el._trackErrors.has('g-a')).toBe(true);

    // Hold the next fetches so the full load is still in flight.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate;
        return {
          ok: true,
          status: 200,
          json: async () => ({ features: [] }),
        } as unknown as Response;
      })
    );
    el.setTrackData('g', 'c', [{ type: 'DOMAIN', start: 1, end: 5 }]);
    const retry = el._loadData(new Set(['g-a']));
    release();
    await retry;
    await vi.waitFor(() => {
      if (!el.data['g-c']) throw new Error('full load not applied');
    });

    expect(el._trackErrors.has('g-a')).toBe(false);
  });
});

describe('the strict panel tracks the whole error set', () => {
  const twoTracks = () =>
    normConfig(
      [
        urlTrack('a', 'https://example.org/a.json'),
        urlTrack('b', 'https://example.org/b.json'),
      ],
      { strict: true }
    );

  it('keeps the panel up when a sibling Retry succeeds and another still fails', async () => {
    // Two badge Retries are disjoint batches. The one that succeeded used to
    // see no failures of its own and clear the panel, leaving the track that
    // was still broken badge-only under strict.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([
      ['/a.json', { ok: false, status: 503 }],
      ['/b.json', { ok: false, status: 503 }],
    ]);
    const el = buildLoaded(twoTracks(), { openGroups: ['g'] });
    await el._loadData();
    expect(el._mountError?.summary).toBe('2 tracks failed to load.');

    stubFetch([
      ['/a.json', { ok: false, status: 503 }],
      ['/b.json', { ok: true, status: 200, body: { features: [] } }],
    ]);
    // `a`'s batch lands first and re-raises; `b`'s lands after it.
    await Promise.all([
      el._loadData(new Set(['g-a'])),
      el._loadData(new Set(['g-b'])),
    ]);

    expect(el._trackErrors.has('g-a')).toBe(true);
    expect(el._trackErrors.has('g-b')).toBe(false);
    expect(el._mountError?.phase).toBe('track-fetch');
    expect(el._mountError?.summary).toMatch(/^Track 'g\/a' failed to load/);
  });

  it('clears the panel once the last failure is fixed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/a.json', { ok: false, status: 503 }]]);
    const el = buildLoaded(twoTracks(), { openGroups: ['g'] });
    await el._loadData();
    expect(el._mountError?.phase).toBe('track-fetch');

    stubFetch([]);
    await el._loadData(new Set(['g-a']));

    expect(el._mountError).toBeNull();
  });

  it('does not re-raise a dismissed panel for a batch with no new failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/a.json', { ok: false, status: 503 }]]);
    const el = buildLoaded(twoTracks(), { openGroups: ['g'] });
    await el._loadData();
    el._mountError = null;

    // `b` reloads fine; `a` is untouched and still broken, but nothing new
    // happened that the user has not already dismissed.
    stubFetch([['/a.json', { ok: false, status: 503 }]]);
    await el._loadData(new Set(['g-b']));

    expect(el._mountError).toBeNull();
  });

  it('keeps the aggregate, and its Retry, when a render failure joins a 503', async () => {
    // A render failure used to raise its own one-track panel with no Retry,
    // replacing the aggregate that was offering one for the 503.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubFetch([['/a.json', { ok: false, status: 503 }]]);
    const el = buildLoaded(twoTracks(), { openGroups: ['g'] });
    await el._loadData();
    el._mountError = null;

    el._assignComponentData(
      {
        set data(_v: unknown) {
          throw new TypeError('undefined is not iterable');
        },
      },
      [{ bad: true }],
      'g-b'
    );

    expect(el._mountError?.summary).toBe('2 tracks failed to load.');
    expect((el._mountError as { retry?: boolean } | null)?.retry).toBe(true);
  });
});

describe('dismissing the alert panel', () => {
  it('brings the viewer back with its rows drawn, not blank', async () => {
    // The panel replaces the viewer, so dismissing it mounts every row afresh
    // — `display: none` and empty until data is pushed into them. None of the
    // properties the push is gated on change on a dismiss, so it never ran.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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
    const el = mountEl({
      viewerConfig: {
        strict: true,
        rows: [
          { id: 'g', tracks: [{ id: 'y', kind: 'features', data: 'https://example.org/x.json' }] },
        ],
      },
      accession: 'P05067',
    });
    const group = () =>
      el.querySelector<HTMLElement>(`#${CSS_PREFIX}-group_g`);
    await vi.waitFor(() => {
      if (group()?.style.display !== 'flex') throw new Error('not drawn yet');
    });

    // A failure on a working viewer that `strict` promotes to the panel.
    el.setTrackData('g', 'nope', [{ type: 'DOMAIN' }]);
    await el.updateComplete;
    expect(el.querySelector(PANEL)).not.toBeNull();
    expect(group()).toBeNull();

    el.querySelector<HTMLButtonElement>('[aria-label="Dismiss error"]')!.click();

    await vi.waitFor(() => {
      if (group()?.style.display !== 'flex') throw new Error('row still hidden');
    });
    // The collapsed group's element got its payload back, too.
    const aggregate = el.querySelector<HTMLElement & { data?: unknown }>(
      `#${CSS_PREFIX}-track-g`
    );
    expect(aggregate?.data).toBeDefined();
    expect(aggregate?.data).toBe(el.data.g);
  });
});
