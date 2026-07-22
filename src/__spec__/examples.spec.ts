/**
 * Validates every directory under `examples/` — the canonical,
 * CI-validated set of example ProtVista viewer configs (see
 * `examples/README.md`).
 *
 * For each `examples/<name>/config.yaml` (discovered dynamically —
 * no hardcoded list, so new example directories are covered
 * automatically; a floor-guard test below pins the expected set so a
 * discovery-path regression can't silently zero out the whole suite):
 *
 *   1. Schema validation — `loadConfig` must accept it.
 *   2. Data pipeline — `loadProtvistaData`, driven by the real
 *      exported `adapters` map (the same one `<protvista-uniprot>`
 *      uses), must produce `hasData: true`, AND every track the
 *      example authored itself locally (`from: file` / `from:
 *      inline` — as opposed to a `from: url` track riding on this
 *      suite's canned `https://` fixture) must independently produce
 *      non-empty data. The per-track check matters because
 *      `hasData` is an OR across every track in the config — for
 *      `extend-default/`, which inherits ~15 canned-fixture-backed
 *      groups from the base config, `hasData` alone would stay true
 *      even if its own `hotspots.csv` were empty or broken (the
 *      per-track adapter call is try/caught, not thrown), silently
 *      hiding exactly the regression this example exists to catch.
 *   3. Render smoke test — mounting a `<protvista-uniprot>` instance
 *      with that data must produce a populated group/track DOM, and
 *      each locally-authored track's own row must be among the
 *      rendered nodes — proving the shape `loadProtvistaData`
 *      produced for that specific track is actually renderable, not
 *      just that *some* track rendered.
 *
 * A separate top-level `describe` block below pins the "default
 * fetcher" contract that `extend-default/config.yaml`'s
 * `extends: /src/default-config.yaml` relies on: `<protvista-uniprot>`
 * never supplies a custom `extendsFetcher`, so that value must
 * resolve correctly through the *library's own default* fetcher
 * (bare `globalThis.fetch(url)`), not through any fs-based shim this
 * suite constructs for its own convenience.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'lit';

import { loadConfig } from '../schema/load';
import type { NormalizedConfig } from '../schema/normalize';
import { loadProtvistaData, type AdapterMap } from '../load-data';
import { CSS_PREFIX } from '../styles/css-prefix';
// Side-effect import: registers the `protvista-uniprot` custom
// element and exposes the real, drift-proof adapter map.
import '../protvista-uniprot';
import { adapters as realAdapters } from '../protvista-uniprot';

const REFERENCE_ACCESSION = 'P05067';
const SEQ_LEN = 770;

const EXAMPLES_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../examples'
);
const REPO_ROOT = resolve(EXAMPLES_ROOT, '..');

interface DiscoveredExample {
  name: string;
  dir: string;
  configPath: string;
}

function discoverExamples(): DiscoveredExample[] {
  return readdirSync(EXAMPLES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(EXAMPLES_ROOT, entry.name);
      return { name: entry.name, dir, configPath: join(dir, 'config.yaml') };
    })
    .filter((example) => existsSync(example.configPath))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The set of examples this suite is written to know about. Discovery
// is dynamic (new directories are picked up automatically), but if
// `examples/` ever ends up empty or `EXAMPLES_ROOT` drifts off the
// real directory, `describe.each` below would silently register zero
// tests and `vitest run` would still exit green. This assertion runs
// independently of the loop and fails loudly in that scenario.
it('discovers the expected example directories', () => {
  const names = discoverExamples().map((e) => e.name);
  expect(names).toEqual(
    expect.arrayContaining([
      'basic',
      'inline-data',
      'csv',
      'tsv',
      'json',
      'bed',
      'extend-default',
    ])
  );
});

/**
 * Canned response for any `https://`-style API source. Shaped like a
 * real UniProt features payload (`{ features: [...] }`) so the
 * `uniprot-features-json` adapter — used by `basic/` and inherited by
 * `extend-default/` via its `extends:` — produces real, non-empty
 * data; other UniProt-API adapters simply degrade that one track to
 * empty (per-track try/catch in `loadProtvistaData`), which is fine
 * here since only the example's own data needs to prove out
 * end-to-end. `type: 'DOMAIN'` matches `basic/config.yaml`'s
 * `filter: DOMAIN`, so the track survives the filter pass too.
 */
const CANNED_FEATURES_RESPONSE = {
  features: [{ type: 'DOMAIN', begin: 1, end: 770, description: 'Fixture domain' }],
};

/**
 * Resolve a local reference the way the *real* library resolves it
 * once the value is origin-absolute: `/foo` means "relative to
 * whatever root the hosting page is served from" (the repo root, for
 * every deployment this suite cares about), not "relative to this
 * particular example's own directory." Anything else stays
 * example-directory-relative, matching a real page's `./`/`../`
 * behaviour when the config file and its data live side by side.
 */
function resolveLocalRef(exampleDir: string, ref: string): string {
  return ref.startsWith('/') ? join(REPO_ROOT, ref) : resolve(exampleDir, ref);
}

function makeExampleFetchers(exampleDir: string) {
  const extendsFetcher = async (ref: string): Promise<string> =>
    readFile(resolveLocalRef(exampleDir, ref), 'utf8');

  const fetchOne = async (
    url: string,
    responseType: 'json' | 'text'
  ): Promise<unknown> => {
    if (/^https?:\/\//i.test(url)) {
      return responseType === 'json' ? CANNED_FEATURES_RESPONSE : '';
    }
    const text = await readFile(resolveLocalRef(exampleDir, url), 'utf8');
    return responseType === 'json' ? JSON.parse(text) : text;
  };

  return { extendsFetcher, fetchOne };
}

function buildInstance(overrides: Record<string, unknown>) {
  const el = document.createElement('protvista-uniprot') as any;
  el.sequence = 'M'.repeat(SEQ_LEN);
  el.displayCoordinates = { start: 1, end: SEQ_LEN };
  el.accession = REFERENCE_ACCESSION;
  el.suspend = false;
  el.loading = false;
  el.rawData = {};
  Object.assign(el, overrides);
  return el;
}

/**
 * The tracks an example authored itself — `from: file` (a local
 * `./x.csv`-style shorthand) or `from: inline` — as opposed to a
 * `from: url` track whose data in this suite comes entirely from
 * {@link CANNED_FEATURES_RESPONSE}. Used to assert each example's own
 * sample data specifically, not just the aggregate `hasData` flag
 * (which a canned-fixture-backed sibling track can satisfy on its
 * own — see the file-level doc comment).
 */
function findLocalTracks(
  config: NormalizedConfig
): { groupId: string; trackId: string; key: string }[] {
  const found: { groupId: string; trackId: string; key: string }[] = [];
  for (const group of config.rows) {
    for (const track of group.tracks) {
      const from = track.data[0]?.from;
      if (from === 'file' || from === 'inline') {
        found.push({
          groupId: group.id,
          trackId: track.id,
          key: `${group.id}-${track.id}`,
        });
      }
    }
  }
  return found;
}

describe.each(discoverExamples())('example: $name', ({ dir, configPath }) => {
  let config: NormalizedConfig;
  let result: Awaited<ReturnType<typeof loadProtvistaData>>;

  beforeAll(async () => {
    const text = await readFile(configPath, 'utf8');
    const { extendsFetcher, fetchOne } = makeExampleFetchers(dir);
    config = await loadConfig(text, {
      accession: REFERENCE_ACCESSION,
      extendsFetcher,
    });
    // Loaded once and shared by every `it()` below — the config and
    // its data pipeline are read-only from here on, and re-running
    // `loadProtvistaData` per assertion bought nothing but CPU
    // (worst for `extend-default/`, which fans out to ~15 tracks).
    result = await loadProtvistaData(
      REFERENCE_ACCESSION,
      config,
      fetchOne,
      realAdapters as AdapterMap
    );
  });

  it('validates against the schema', () => {
    expect(config).toBeDefined();
    expect(config.rows.length).toBeGreaterThan(0);
  });

  it('produces data through the real adapter map, including every locally-authored track', () => {
    // Coarse signal: at least one track anywhere produced data. For
    // `basic/` this is entirely the canned `https://` fixture (it
    // has no local file); for every other example it's backed by at
    // least the sample data checked individually below.
    expect(result.hasData).toBe(true);

    // Precise signal: each track the example itself owns (its own
    // CSV/TSV/JSON/BED file, or inline data) must independently have
    // parsed into a non-empty array — not merely "some sibling track
    // in this config produced data."
    for (const { key } of findLocalTracks(config)) {
      const payload = result.data[key];
      expect(Array.isArray(payload), `${key} should be an array`).toBe(true);
      expect(
        (payload as unknown[]).length,
        `${key} should be non-empty`
      ).toBeGreaterThan(0);
    }
  });

  it('smoke-renders the example, including each locally-authored track', () => {
    const el = buildInstance({
      config,
      data: result.data,
      hasData: result.hasData,
      openGroups: config.rows.map((g) => g.id),
    });

    const target = document.createElement('div');
    render(el.render(), target);

    // A group with no renderable aggregate is legitimately hidden by
    // the real template (see `hasRenderableData` gating in
    // `protvista-uniprot.ts`), so this doesn't assert every declared
    // group renders — just that the example's own data produced at
    // least one real, populated row. `.pv-group` covers both a group and
    // a standalone-track row (which renders `.pv-group--standalone`);
    // `.pv-track-content` is the data lane both shapes emit.
    expect(
      target.querySelectorAll(`.${CSS_PREFIX}-group`).length
    ).toBeGreaterThan(0);
    expect(
      target.querySelectorAll(`.${CSS_PREFIX}-track-content`).length
    ).toBeGreaterThan(0);

    // And, specifically, every track the example authored itself —
    // not just "some" track anywhere in an inherited base config —
    // rendered its own row. Match on `data-id` (present on the content
    // lane of both grouped and standalone tracks; the `id=` form is
    // grouped-only).
    for (const { trackId, key } of findLocalTracks(config)) {
      const node = target.querySelector(
        `[data-id="${CSS_PREFIX}-track_${trackId}"]`
      );
      expect(node, `${CSS_PREFIX}-track_${trackId} (${key}) should render`).not.toBeNull();
    }
  });
});

/**
 * `extend-default/config.yaml` declares `extends: /src/default-config.yaml`
 * — an origin-absolute path chosen specifically because
 * `<protvista-uniprot>` never passes a custom `extendsFetcher` to
 * `loadConfig` (see `resolveViewerConfig()` in `protvista-uniprot.ts`);
 * it always uses the library's default fetcher, bare
 * `globalThis.fetch(url)`. The `describe.each` block above proves the
 * example works under this suite's own fs-based `extendsFetcher`,
 * which is convenient for CI but is NOT what a real embedder's page
 * uses — so on its own it can't catch a regression to a path shape
 * that only this suite's shim happens to tolerate.
 *
 * This block instead drives `loadConfig` with no `extendsFetcher` at
 * all — exactly like the real element — and stubs `globalThis.fetch`
 * to pin two things: the loader passes the `extends:` value through
 * *verbatim* (no hidden resolution logic of our own to drift), and an
 * origin-absolute value is what a same-origin page actually needs.
 */
describe('extend-default — default-fetcher semantics (no custom extendsFetcher, matches the real element)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('resolves extends: /src/default-config.yaml via a bare globalThis.fetch(url) call', async () => {
    const configText = await readFile(
      join(EXAMPLES_ROOT, 'extend-default', 'config.yaml'),
      'utf8'
    );
    const defaultConfigText = await readFile(
      join(REPO_ROOT, 'src', 'default-config.yaml'),
      'utf8'
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/src/default-config.yaml');
      return {
        ok: true,
        text: async () => defaultConfigText,
      } as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const config = await loadConfig(configText, {
      accession: REFERENCE_ACCESSION,
      // No `extendsFetcher` — pins the same code path
      // `<protvista-uniprot>` exercises.
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/src/default-config.yaml');
    // The merge succeeded: the ~15 inherited base groups plus MY_LAB.
    expect(config.rows.length).toBeGreaterThan(1);
    expect(config.rows.some((g) => g.id === 'MY_LAB')).toBe(true);
  });
});
