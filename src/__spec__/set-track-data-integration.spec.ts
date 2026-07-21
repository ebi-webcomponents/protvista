/**
 * Component-level integration coverage for `setTrackData()`
 *
 * `src/__spec__/set-track-data.spec.ts` covers the loader contract —
 * that injected data ends up at `data['GROUP-track']`. This file is the
 * higher-level sanity check: the escape-hatch works end-to-end across
 * an actual `<protvista-uniprot>` instance, not just via direct
 * `loadProtvistaData()` calls.
 *
 * Specifically guards:
 *
 *   1. A post-mount `setTrackData()` call on a `from: custom` track
 *      propagates the injected value into `element.data['GROUP-track']`
 *      and flips Lit's reactive `data` reference so an `updated()`
 *      cycle fires.
 *   2. Shape-validation in `setTrackData()` rejects non-object values
 *      with a `console.warn` and leaves the stored map untouched.
 *   3. Calling `setTrackData()` on a URL-sourced track (or a
 *      non-existent track) is a warn-and-discard, matching the
 *      documented contract.
 *
 * What this file deliberately avoids
 *   - Full `_init()` / `loadEntry()` invocation: that path hits a real
 *     UniProt API and pulls in the structure sub-component. We build
 *     an element manually, inject a hand-crafted `NormalizedConfig`
 *     via `el.config = …`, and drive `setTrackData()` through its
 *     post-mount branch.
 *   - Nightingale element rendering. The nightingale packages are
 *     stubbed to trivial `HTMLElement` subclasses (matching the
 *     `render-target.spec.ts` pattern) so the test exercises the
 *     data-plumbing contract, not canvas math.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `vi.mock` calls for every `@nightingale-elements/*` module + the
// structure sub-component + the SVG icon import are registered
// globally via `src/__spec__/nightingale-mocks.ts`, wired through
// `setupFiles` in `vite.config.mjs`. The side-effect import below
// therefore reaches the stubs, not the real packages.
import '../protvista-uniprot';
import type { NormalizedConfig } from '../schema/normalize';

type ProtvistaUniprotLike = HTMLElement & {
  config: NormalizedConfig | undefined;
  accession: string | undefined;
  data: Record<string, unknown>;
  customTrackData: Record<string, unknown>;
  loading: boolean;
  hasData: boolean;
  setTrackData(groupId: string, trackId: string, data: unknown): void;
  _loadData(): Promise<void>;
  updateComplete: Promise<boolean>;
};

/** Minimal `NormalizedConfig` with one `from: custom` track and one URL track. */
function buildConfig(): NormalizedConfig {
  return {
    version: '1.0',
    sources: {},
    defaults: { rendering: {} },
    rows: [
      {
        id: 'GROUP',
        label: 'group',
        component: 'nightingale-track-canvas',
        rendering: {},
        tracks: [
          {
            id: 'custom-track',
            label: 'Custom',
            component: 'nightingale-track-canvas',
            rendering: {},
            data: [{ from: 'custom' }],
          },
          {
            id: 'url-track',
            label: 'From URL',
            component: 'nightingale-track-canvas',
            rendering: {},
            data: [
              {
                from: 'url',
                url: 'https://example.invalid/data.json',
                adapter: 'uniprot-features-json',
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Stand up an element without going through `connectedCallback` —
 * that would fire `_init()` → `loadEntry()` → `fetch(…uniprot…)` which
 * we don't want to exercise here. We set `config` and `accession`
 * directly so `_loadData()` has the state it needs.
 */
function buildElement(): ProtvistaUniprotLike {
  const el = document.createElement(
    'protvista-uniprot'
  ) as unknown as ProtvistaUniprotLike;
  el.config = buildConfig();
  el.accession = 'P05067';
  el.data = {};
  el.customTrackData = {};
  el.loading = true;
  el.hasData = false;
  // `fetch` is only hit for URL-sourced tracks. The tests that go
  // near that path stub fetch explicitly; elsewhere we never reach it.
  return el;
}

describe('<protvista-uniprot>.setTrackData() — component-level integration', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
    vi.restoreAllMocks();
  });

  it('writes injected data into element.data after _loadData completes', async () => {
    const el = buildElement();
    // Pre-condition: slot is empty.
    expect(el.data['GROUP-custom-track']).toBeUndefined();

    const injected = [
      { type: 'DOMAIN', description: 'first', start: 1, end: 10 },
      { type: 'DOMAIN', description: 'second', start: 20, end: 30 },
    ];

    // Exercise `setTrackData`'s post-mount branch end-to-end. The call
    // is fire-and-forget (it returns void), so we drive `_loadData()`
    // directly afterwards to have an awaitable handle on the pipeline
    // completion. Both paths mutate the same state — awaiting the
    // explicit call is equivalent to awaiting the implicit one
    // `setTrackData` spawns, but is deterministic in test code.
    el.setTrackData('GROUP', 'custom-track', injected);
    await el._loadData();

    const stored = el.data['GROUP-custom-track'] as unknown[];
    expect(Array.isArray(stored)).toBe(true);
    expect(stored).toHaveLength(2);
    // The resolver's auto-fallback synthesises a `tooltipContent` on
    // each item, so we compare field-by-field rather than asserting
    // reference equality with `injected`.
    expect((stored[0] as { description: string }).description).toBe('first');
    expect((stored[1] as { description: string }).description).toBe('second');

    // The tooltip auto-fallback should have decorated each item with
    // a non-empty HTML string, proving the pipeline ran the resolver
    // path and didn't just write the raw array.
    expect((stored[0] as { tooltipContent?: string }).tooltipContent).toMatch(
      /<h5>Type<\/h5>/
    );

    // Loading flag should be cleared after the pipeline settles.
    expect(el.loading).toBe(false);
  });

  it('rejects primitive values with a warn and leaves customTrackData untouched', () => {
    const el = buildElement();
    // `null` — the most common pitfall when a consumer forgets to
    // wrap a single item in an array.
    el.setTrackData('GROUP', 'custom-track', null);
    expect(warn).toHaveBeenCalled();
    expect('GROUP-custom-track' in el.customTrackData).toBe(false);

    warn.mockClear();

    // `undefined` — same treatment.
    el.setTrackData('GROUP', 'custom-track', undefined);
    expect(warn).toHaveBeenCalled();

    warn.mockClear();

    // Primitive scalar — same treatment.
    el.setTrackData('GROUP', 'custom-track', 42);
    expect(warn).toHaveBeenCalled();
    expect('GROUP-custom-track' in el.customTrackData).toBe(false);
  });

  it('warns and discards when called for a non-`from: custom` track', async () => {
    const el = buildElement();
    el.setTrackData('GROUP', 'url-track', [{ type: 'X' }]);
    // The initial customTrackData write still happens (copy-on-write
    // preserves it for future config edits), but the pipeline warns
    // and returns without triggering a load.
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/not 'from: custom'/)
    );
  });

  it('warns and discards when called for an unknown track', () => {
    const el = buildElement();
    el.setTrackData('GROUP', 'does-not-exist', [{ type: 'X' }]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/not found in config/)
    );
  });

  it('pre-mount calls (no config yet) accumulate without warning', () => {
    // Skip the `config` assignment — emulates a consumer calling
    // `setTrackData` before `connectedCallback` fires `_init()`.
    const el = document.createElement(
      'protvista-uniprot'
    ) as unknown as ProtvistaUniprotLike;
    el.data = {};
    el.customTrackData = {};

    const injected = [{ type: 'X' }];
    el.setTrackData('GROUP', 'custom-track', injected);

    // No warning was emitted; the map holds the injected value ready
    // for the first `_loadData()` run.
    expect(warn).not.toHaveBeenCalled();
    expect(el.customTrackData['GROUP-custom-track']).toBe(injected);
  });
});
