/**
 * Post-mount `accession` change handling.
 *
 * `<protvista-uniprot>` must re-fetch when a consumer mutates the
 * `accession` attribute (or property) after the element has mounted.
 * UniProt's own feature viewer navigates between entries without
 * unmounting the element, so this is a live UX path.
 *
 * The logic under test lives in `updated()` and is a single branch
 * that fires `_init()` when `accession` is in `changedProperties`
 * AND its previous value was defined. We exercise the hook directly
 * rather than driving Lit's full reactive cycle — `updated()` is a
 * synchronous method on the class, calling it with a hand-rolled
 * `Map` is a legitimate and deterministic unit-test entry point.
 *
 * Specifically guards:
 *
 *   1. Post-mount transition (`"<old>" → "<new>"`) re-invokes
 *      `_init()` exactly once and short-circuits before the
 *      `_loadDataInComponents()` push, so no stale-data injection
 *      runs on this tick. The refetch that `_init()` kicks off will
 *      update `this.data` / `this.sequence` on its own schedule;
 *      those changes fire their own `updated()` cycles that hit the
 *      downstream gate.
 *   2. Initial-mount transition (`undefined → "<value>"`) does NOT
 *      re-invoke `_init()`. That case is already covered by
 *      `connectedCallback() → _init()`; firing it again from
 *      `updated()` would double-fetch the entry.
 *   3. Unrelated `updated()` cycles (e.g. `data` arriving from the
 *      refetch) still run the downstream push as normal. Our branch
 *      only short-circuits when `accession` itself is in
 *      `changedProperties`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `vi.mock` calls for every `@nightingale-elements/*` module + the
// structure sub-component + the SVG icon import are registered
// globally via `src/__spec__/nightingale-mocks.ts`, wired through
// `setupFiles` in `vite.config.mjs`.
import '../protvista-uniprot.js';
import type { NormalizedConfig } from '../schema/normalize.js';

// Widen the `updated()` signature to `Map<string, unknown>` for
// testing: the component types it as `Map<string, string>`, but the
// initial-mount case carries `undefined` as the previous value, and
// Lit's `PropertyValues<this>` is structurally `Map<PropertyKey,
// unknown>`. The cast only affects the test call-site.
type ProtvistaUniprotLike = HTMLElement & {
  config: NormalizedConfig | undefined;
  accession: string | undefined;
  data: Record<string, unknown>;
  customTrackData: Record<string, unknown>;
  _init(): Promise<void>;
  _loadDataInComponents(): Promise<void>;
  updated(changedProperties: Map<string, unknown>): void;
};

function buildConfig(): NormalizedConfig {
  return {
    version: '1.0',
    sources: {},
    defaults: { rendering: {} },
    rows: [],
  };
}

/**
 * Stand up an element without going through `connectedCallback` —
 * that would fire `_init()` → `loadEntry()` → `fetch(…uniprot…)`
 * which we don't want to exercise here. Setting `config` and
 * `accession` directly puts the element in the post-initial-load
 * state so we can exercise the `updated()` hook in isolation.
 */
function buildElement(): ProtvistaUniprotLike {
  const el = document.createElement(
    'protvista-uniprot'
  ) as unknown as ProtvistaUniprotLike;
  el.config = buildConfig();
  el.accession = 'P05067';
  el.data = {};
  el.customTrackData = {};
  return el;
}

describe('<protvista-uniprot> — accession-change handling', () => {
  let el: ProtvistaUniprotLike;
  let initSpy: ReturnType<typeof vi.spyOn>;
  let pushSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    el = buildElement();
    // Stub both async methods so the test doesn't touch fetch or the
    // per-track DOM walk — we only care that the hook dispatches
    // correctly.
    initSpy = vi
      .spyOn(el, '_init')
      .mockImplementation(() => Promise.resolve());
    pushSpy = vi
      .spyOn(el, '_loadDataInComponents')
      .mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('post-mount accession change (defined → defined) re-runs _init() and short-circuits the push', () => {
    // Simulate the consumer mutating `accession` from 'P05067' to
    // 'P12345'. Lit records the *previous* value in
    // `changedProperties` — 'P05067' here, which is defined. Our
    // gate must treat this as a post-mount transition and refetch.
    el.accession = 'P12345';
    el.updated(new Map<string, unknown>([['accession', 'P05067']]));

    expect(initSpy).toHaveBeenCalledTimes(1);

    // Downstream push is deliberately skipped this tick. When
    // `_init()` completes asynchronously and writes fresh
    // `this.data` / `this.sequence`, those updates trigger their own
    // `updated()` cycles that will hit the gate — but not this one.
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('initial-mount transition (undefined → "<value>") does NOT re-run _init()', () => {
    // Lit's first `updated()` call after mount records
    // `previous=undefined, current='P05067'`. `connectedCallback`
    // has already called `_init()` for this transition — firing it
    // a second time from `updated()` would double-fetch the entry.
    el.accession = 'P05067';
    el.updated(new Map<string, unknown>([['accession', undefined]]));

    expect(initSpy).not.toHaveBeenCalled();
  });

  it('downstream gate still fires for unrelated property changes', () => {
    // A later `updated()` cycle driven by `data` arriving from the
    // refetch (or any other property in the gate) should run the
    // push as normal. Our accession branch only short-circuits when
    // `accession` itself is in changedProperties.
    el.updated(new Map<string, unknown>([['data', {}]]));

    expect(initSpy).not.toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('accession change bundled with other changes still short-circuits the push', () => {
    // If `accession` and `data` both show up in the same
    // changedProperties map (an unusual but possible scenario — e.g.
    // a consumer sets both properties synchronously before Lit
    // flushes), the accession branch wins and the push is skipped.
    // Rationale: `_init()`'s refetch will supersede whatever
    // `data` was just written, so pushing it into components now
    // would be wasted work and potentially display stale rows for
    // one frame.
    el.accession = 'P12345';
    el.updated(
      new Map<string, unknown>([
        ['accession', 'P05067'],
        ['data', {}],
      ])
    );

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
