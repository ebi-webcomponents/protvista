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
 *   2. Data pipeline — `loadProtvistaData`, driven by a real registry
 *      seeded with every built-in adapter (the same resolution
 *      `<protvista-uniprot>` uses), must produce `hasData: true`, AND every track the
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
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'lit';

import { loadConfig } from '../schema/load.js';
import { parseConfigText } from '../schema/parse.js';
import type { NormalizedConfig } from '../schema/normalize.js';
import { loadProtvistaData, hasRenderableRows } from '../load-data.js';
import { createRegistry } from '../schema/registry.js';
import { findOutOfRange } from '../schema/adapters/coordinates.js';
import {
  parseDelimited,
  rowsToFeatureRecords,
} from '../schema/adapters/dsv.js';
import { parseSequenceText } from '../schema/sequence.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
// Side-effect import: registers the `protvista-uniprot` custom
// element. The data pipeline resolves adapters through a real registry
// (seeded with every built-in), matching what the element does at runtime.
import '../protvista-uniprot.js';

// A registry seeded with all built-in adapters — the drift-proof
// equivalent of the element's own runtime resolution.
const registry = createRegistry();
const resolveAdapter = (name: string) => registry.getAdapter(name);

const REFERENCE_ACCESSION = 'P05067';
const SEQ_LEN = 770;

/**
 * The length of every protein an example names with `accession:`, so its own
 * data can be checked against that protein rather than against the
 * 770-residue stand-in the render test mounts.
 */
const PROTEIN_LENGTHS: Record<string, number> = {
  [REFERENCE_ACCESSION]: SEQ_LEN,
  // Rubredoxin, conservation/ (UniProt release 2026_03).
  P24297: 54,
};

const EXAMPLES_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../examples'
);
const REPO_ROOT = resolve(EXAMPLES_ROOT, '..');

// A community view states its protein's length in its own `preset.json`, so
// adding one edits no list here. A preset.json may add a length but never
// change a known one: that would hide out-of-range data in other examples.
const LENGTH_CONFLICTS: string[] = [];
const LENGTH_SOURCES: Record<string, string> = {};
for (const entry of readdirSync(EXAMPLES_ROOT, { withFileTypes: true })) {
  const manifest = join(EXAMPLES_ROOT, entry.name, 'preset.json');
  const config = join(EXAMPLES_ROOT, entry.name, 'config.yaml');
  if (!entry.isDirectory() || !existsSync(manifest) || !existsSync(config))
    continue;
  let length: unknown;
  try {
    ({ length } = JSON.parse(readFileSync(manifest, 'utf8')) ?? {});
  } catch {
    continue; // presets.spec.ts names the broken preset.json
  }
  const accession = /^accession:\s*["']?([A-Za-z0-9_-]+)/m.exec(
    readFileSync(config, 'utf8')
  )?.[1];
  if (!accession || typeof length !== 'number') continue;
  const here = `examples/${entry.name}/preset.json`;
  const known = PROTEIN_LENGTHS[accession];
  if (known === undefined) {
    PROTEIN_LENGTHS[accession] = length;
    LENGTH_SOURCES[accession] = here;
  } else if (known !== length) {
    LENGTH_CONFLICTS.push(
      `${here}: length ${length}, but ${accession} is ${known} residues ` +
        `(${LENGTH_SOURCES[accession] ?? 'PROTEIN_LENGTHS'})`
    );
  }
}

it('community views agree on the length of each protein', () => {
  expect(LENGTH_CONFLICTS).toEqual([]);
});

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
      'linegraph',
      'linegraph-csv',
      'csv',
      'tsv',
      'json',
      'bed',
      'extend-default',
      'csv-styled',
      'sequence-only',
      'sequence-inline',
      'small-peptide',
      'conservation', 
      'isoforms-app'
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
  features: [
    { type: 'DOMAIN', begin: 1, end: 770, description: 'Fixture domain' },
  ],
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

const SAVED_ENTRIES_DIR = join(REPO_ROOT, 'src/__fixtures__/isoforms');
const SAVED_ENTRY_FIELDS = ['accession', 'sequence', 'ft_var_seq', 'cc_alternative_products'];
const REQUIRED_ENTRY_FIELDS = SAVED_ENTRY_FIELDS.filter((field) => field !== 'accession');
const UNIPROTKB_ENTRY_URL = /^https:\/\/rest\.uniprot\.org\/uniprotkb\/([A-Z0-9-]+)\.json(?:\?|$)/;

function savedUniprotEntry(url: string, problems: string[]): string | undefined {
  const accession = UNIPROTKB_ENTRY_URL.exec(url)?.[1];
  if (!accession) return undefined;
  const path = join(SAVED_ENTRIES_DIR, `${accession}.json`);
  if (!existsSync(path)) return undefined;
  const fields = new URL(url).searchParams.get('fields')?.split(',') ?? [];
  const unknown = fields.filter((f) => !SAVED_ENTRY_FIELDS.includes(f));
  const missing = REQUIRED_ENTRY_FIELDS.filter((f) => !fields.includes(f));
  if (unknown.length > 0 || missing.length > 0) {
    problems.push(
      `${url}: ask for fields=${REQUIRED_ENTRY_FIELDS.join(',')}` +
        (unknown.length > 0 ? `; not saved: ${unknown.join(', ')}` : '') +
        (missing.length > 0 ? `; missing: ${missing.join(', ')}` : '')
    );
  }
  return path;
}

function makeExampleFetchers(exampleDir: string) {
  const fieldProblems: string[] = [];
  const extendsFetcher = async (ref: string): Promise<string> =>
    readFile(resolveLocalRef(exampleDir, ref), 'utf8');
  // A `sequence:` FASTA file resolves exactly like an `extends:` target.
  const sequenceFetcher = extendsFetcher;

  const fetchOne = async (
    url: string,
    responseType: 'json' | 'text'
  ): Promise<unknown> => {
    // NEW: Use the savedUniprotEntry helper
    const saved = savedUniprotEntry(url, fieldProblems);
    if (saved) {
      const text = await readFile(saved, 'utf8');
      return responseType === 'json' ? JSON.parse(text) : text;
    }
    
    if (/^https?:\/\//i.test(url)) {
      return responseType === 'json' ? CANNED_FEATURES_RESPONSE : '';
    }
    const text = await readFile(resolveLocalRef(exampleDir, url), 'utf8');
    return responseType === 'json' ? JSON.parse(text) : text;
  };

  return { extendsFetcher, sequenceFetcher, fetchOne, fieldProblems };
}

function buildInstance(overrides: Record<string, unknown>) {
  const el = document.createElement('protvista-uniprot') as any;
  // A `sequence:` example brings its own protein, and has no accession.
  const own = (overrides.config as NormalizedConfig | undefined)?.sequence;
  el.sequence = own?.residues ?? 'M'.repeat(SEQ_LEN);
  el.displayCoordinates = { start: 1, end: el.sequence.length };
  if (!own) el.accession = REFERENCE_ACCESSION;
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
): { groupId: string; trackId: string; key: string; hidden: boolean }[] {
  const found: {
    groupId: string;
    trackId: string;
    key: string;
    hidden: boolean;
  }[] = [];
  for (const group of config.rows) {
    for (const track of group.tracks) {
      const from = track.data[0]?.from;
      if (from === 'file' || from === 'inline') {
        found.push({
          groupId: group.id,
          trackId: track.id,
          key: `${group.id}-${track.id}`,
          hidden: !!(group.hidden || track.hidden),
        });
      }
    }
  }
  return found;
}

describe.each(discoverExamples())('example: $name', ({ dir, configPath }) => {
  let config: NormalizedConfig;
  let result: Awaited<ReturnType<typeof loadProtvistaData>>;
  let urlProblems: string[];

  beforeAll(async () => {
    const text = await readFile(configPath, 'utf8');
    
    const { extendsFetcher, sequenceFetcher, fetchOne, fieldProblems } =
      makeExampleFetchers(dir);
    urlProblems = fieldProblems;

    // A `sequence:` example shows its own protein: an accession beside it is
    // an error, so it gets none.
    const parsed = (await parseConfigText(text)) as { sequence?: unknown };
    const sequenceMode = parsed.sequence !== undefined;
    config = await loadConfig(text, {
      ...(sequenceMode ? {} : { accession: REFERENCE_ACCESSION }),
      extendsFetcher,
      sequenceFetcher,
    });
    // Loaded once and shared by every `it()` below — the config and
    // its data pipeline are read-only from here on, and re-running
    // `loadProtvistaData` per assertion bought nothing but CPU
    // (worst for `extend-default/`, which fans out to ~15 tracks).
    result = await loadProtvistaData(
      config.sequence ? '' : REFERENCE_ACCESSION,
      config,
      fetchOne,
      resolveAdapter
    );
  });
  
  it('validates against the schema', () => {
    expect(config).toBeDefined();
    expect(config.rows.length).toBeGreaterThan(0);
  });

  it('asks UniProt for the fields its saved entry was fetched with', () => {
    // A saved entry answers in place of UniProt, so a `fields=` value that
    // UniProt would reject must fail here rather than load the saved copy.
    expect(urlProblems).toEqual([]);
  });

  it('produces data through the real adapter map, including every locally-authored track', () => {
    // Coarse signal: at least one track anywhere produced data. For
    // `basic/` this is entirely the canned `https://` fixture (it
    // has no local file); for every other example it's backed by at
    // least the sample data checked individually below.
    expect(result.hasData).toBe(true);

    // Precise signal: each track the example itself owns (its own
    // CSV/TSV/JSON/BED file, or inline data) must independently have
    // parsed into something renderable — not merely "some sibling track
    // in this config produced data."
    //
    // Uses the loader's own predicate rather than a bare `Array.isArray`:
    // adapters emit more than one wrapper (a variation payload is
    // `{ variants: [...] }`), and a test that recognised fewer shapes than
    // the `hasData` gate does would pass examples the viewer blanks out.
    for (const { key } of findLocalTracks(config)) {
      expect(
        hasRenderableRows(result.data[key]),
        `${key} should have parsed into non-empty renderable rows`
      ).toBe(true);
    }
  });

  it('keeps every coordinate of its own data on its protein', () => {
    // The element checks coordinates against the protein only at runtime,
    // and the render test below mounts every accession example on a
    // 770-residue stand-in, so data past the end of a shorter protein would
    // pass everything else here.
    const accession = config.accession ?? REFERENCE_ACCESSION;
    const length = config.sequence
      ? config.sequence.residues.length
      : PROTEIN_LENGTHS[accession];
    expect(
      length,
      `give the length of ${accession}: a community view in its ` +
        'preset.json, any other example in PROTEIN_LENGTHS'
    ).toBeDefined();
    for (const [key, coords] of Object.entries(result.trackCoordinates)) {
      expect(findOutOfRange(coords.rows, length), key).toBeNull();
    }
    // Every locally-authored track was checked, not skipped for want of
    // coordinates.
    for (const { key } of findLocalTracks(config)) {
      expect(result.trackCoordinates[key], key).toBeDefined();
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
    // least one real, populated track row. `.pv-group__track` is an
    // expanded grouped track; `.pv-group--standalone` is a standalone
    // track row. (Deliberately NOT `.pv-track-content`, which the
    // always-present navigation lane also emits.)
    expect(
      target.querySelectorAll(
        `.${CSS_PREFIX}-group__track, .${CSS_PREFIX}-group--standalone`
      ).length
    ).toBeGreaterThan(0);

    // And, specifically, every track the example authored itself —
    // not just "some" track anywhere in an inherited base config —
    // rendered its own row. Match on `data-id` (present on the content
    // lane of both grouped and standalone tracks; the `id=` form is
    // grouped-only).
    for (const { trackId, key, hidden } of findLocalTracks(config)) {
      // Authored `hidden: true` (row or track): drawn only in Customize mode.
      if (hidden) continue;
      const node = target.querySelector(
        `[data-id="${CSS_PREFIX}-track_${trackId}"]`
      );
      expect(
        node,
        `${CSS_PREFIX}-track_${trackId} (${key}) should render`
      ).not.toBeNull();
    }
  });
});

/**
 * `sequence-inline/` is `sequence-only/` written inline, for the playground's
 * "your own sequence" preset, which can fetch nothing. Pinned to it so the
 * two cannot drift apart.
 */
it('sequence-inline holds the same protein and records as sequence-only', async () => {
  const read = (rel: string) => readFile(join(EXAMPLES_ROOT, rel), 'utf8');
  const inline = (await parseConfigText(
    await read('sequence-inline/config.yaml')
  )) as {
    sequence: string;
    rows: { data: { inlineData: unknown[] } }[];
  };
  const own = parseSequenceText(inline.sequence, undefined);
  const file = parseSequenceText(
    await read('sequence-only/protein.fasta'),
    './protein.fasta'
  );
  expect(own.value).toEqual(file.value);
  expect(own.value?.header).toBe('my construct v2');
  expect(own.value?.residues).toHaveLength(240);

  const records = rowsToFeatureRecords(
    parseDelimited(await read('sequence-only/hotspots.csv'), ','),
    { formatLabel: './hotspots.csv' }
  );
  expect(records).toHaveLength(4);
  expect(inline.rows[0].data.inlineData).toEqual(records);
});

/**
 * The conservation line has no tooltip, so the example's most conserved
 * residues carry the scores: each site's tooltip, as loaded, must show its
 * own score. A `kind: features` track's default tooltip leaves `score` out.
 */
it('conservation shows each most conserved residue’s score in its tooltip', async () => {
  const dir = join(EXAMPLES_ROOT, 'conservation');
  const { extendsFetcher, sequenceFetcher, fetchOne } =
    makeExampleFetchers(dir);
  const config = await loadConfig(
    await readFile(join(dir, 'config.yaml'), 'utf8'),
    { extendsFetcher, sequenceFetcher }
  );
  const result = await loadProtvistaData(
    'P24297',
    config,
    fetchOne,
    resolveAdapter
  );
  const sites = result.data['conserved_sites-conserved_sites'] as {
    start: number;
    score: number;
    tooltipContent: string;
  }[];
  expect(sites).toHaveLength(6);
  for (const site of sites) {
    expect(site.tooltipContent, `residue ${site.start}`).toContain(
      `<h5>Conservation score</h5><p>${site.score}</p>`
    );
  }
  expect(sites[0]).toMatchObject({ start: 6, score: 0.877 });
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
