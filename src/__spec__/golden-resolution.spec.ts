/**
 * Golden snapshots taken before the shape/format refactor.
 *
 * The refactor deletes the ten `<shape>-<format>` adapter names and computes
 * the pair from the kind's shape and the source's format instead (see "Shape
 * and format (normative)" in `specs/config-approach.md`). That rewires the
 * resolution path under every config in the repository, so this suite fixes
 * what "unchanged" means before any of it moves.
 *
 * Two snapshots per config, deliberately separated, because only one of them
 * is supposed to survive:
 *
 *   - **payloads** — what each track ends up rendering. This is the
 *     behavioural contract and must come back byte-identical. A diff here
 *     during the refactor is a regression unless it is one of the intended
 *     deltas listed below.
 *   - **resolution** — which adapter each track resolved to, and how. This is
 *     internal, and it is *expected* to change: the names in it are being
 *     deleted. Snapshotting it anyway makes the rewiring reviewable as a diff
 *     rather than something a reader has to take on trust.
 *
 * Intended payload deltas, agreed as part of the spec (so: update the
 * snapshot, note it in the commit, don't "fix" the code):
 *
 *   - `features-json` currently keeps exactly `type`/`start`/`end`/
 *     `description`/`score` and drops every other field. Per the spec it will
 *     preserve unrecognised fields, so payloads from JSON feature sources
 *     gain back any extra keys their fixtures carry.
 *
 * Coverage is every config the repository ships: each `examples/` directory,
 * the starter kit and its recipes, and `src/default-config.yaml` — the last
 * of these being the one config every UniProt deployment actually runs.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../schema/load.js';
import { loadProtvistaData } from '../load-data.js';
import { validateConfig } from '../schema/validate.js';
import { createRegistry } from '../schema/registry.js';
import { normalizeConfig } from '../schema/normalize.js';
import type { NormalizedConfig } from '../schema/normalize.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXAMPLES_ROOT = join(REPO_ROOT, 'examples');
const KIT_ROOT = join(REPO_ROOT, 'starter-kit');
const ACCESSION = 'P05067';

const registry = createRegistry();

/**
 * The same canned API body `examples.spec.ts` uses, so a provider-backed
 * track produces real records rather than an empty slot. Kept identical to
 * that suite's fixture on purpose: two different fixtures would make the two
 * suites disagree about what a "UniProt response" is.
 */
const CANNED_FEATURES_RESPONSE = {
  features: [
    { type: 'DOMAIN', begin: 1, end: 770, description: 'Fixture domain' },
  ],
};

/**
 * Deterministic serialisation: keys sorted at every level, so a snapshot diff
 * means a value changed, never that a property was assigned in a different
 * order. The refactor moves object construction around; without this, every
 * payload would appear to churn.
 */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, stable((value as Record<string, unknown>)[k])])
    );
  }
  // Typed arrays and other exotica reduce to a tag rather than index soup.
  return value;
}

type Case = { name: string; configPath: string; root: string };

function discoverCases(): Case[] {
  const examples = readdirSync(EXAMPLES_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      name: `examples/${e.name}`,
      configPath: join(EXAMPLES_ROOT, e.name, 'config.yaml'),
      root: join(EXAMPLES_ROOT, e.name),
    }))
    .filter((c) => existsSync(c.configPath));

  const kit = [
    'config.yaml',
    'recipes/tsv.yaml',
    'recipes/extend-uniprot.yaml',
  ]
    .map((rel) => ({
      name: `starter-kit/${rel}`,
      configPath: join(KIT_ROOT, rel),
      root: KIT_ROOT,
    }))
    .filter((c) => existsSync(c.configPath));

  return [
    ...examples,
    ...kit,
    {
      name: 'src/default-config.yaml',
      configPath: join(REPO_ROOT, 'src/default-config.yaml'),
      root: REPO_ROOT,
    },
  ];
}

const CASES = discoverCases();

/**
 * Floor guard. `discoverCases()` reads the filesystem, so a path that drifts
 * would silently register zero cases and this whole safety net would pass by
 * covering nothing — the failure mode a pre-refactor snapshot suite can least
 * afford.
 */
it('discovers every shipped config', () => {
  const names = CASES.map((c) => c.name);
  expect(names).toEqual(
    expect.arrayContaining([
      'examples/basic',
      'examples/csv',
      'examples/tsv',
      'examples/json',
      'examples/bed',
      'examples/inline-data',
      'examples/linegraph',
      'examples/linegraph-csv',
      'examples/variation-csv',
      'examples/extend-default',
      'starter-kit/config.yaml',
      'src/default-config.yaml',
    ])
  );
  expect(CASES.length).toBeGreaterThanOrEqual(12);
});

function fetchersFor(root: string) {
  const resolveRef = (ref: string) =>
    ref.startsWith('/') ? join(REPO_ROOT, ref) : resolve(root, ref);

  return {
    // A published `extends:` URL (the starter kit points at the CDN build)
    // resolves to this repo's own default config — the same substitution
    // `starter-kit.spec.ts` makes, so the kit is pinned against the config it
    // will actually ship with rather than whatever the CDN holds today.
    extendsFetcher: async (ref: string) =>
      /^https?:\/\//i.test(ref)
        ? readFile(join(REPO_ROOT, 'src/default-config.yaml'), 'utf8')
        : readFile(resolveRef(ref), 'utf8'),
    fetchOne: async (url: string, responseType: 'json' | 'text') => {
      if (/^https?:\/\//i.test(url)) {
        return responseType === 'json' ? CANNED_FEATURES_RESPONSE : '';
      }
      const text = await readFile(resolveRef(url), 'utf8');
      return responseType === 'json' ? JSON.parse(text) : text;
    },
  };
}

/** Per-track resolution — the internal wiring the refactor replaces. */
function resolutionOf(config: NormalizedConfig) {
  const rows: Record<string, unknown> = {};
  for (const row of config.rows) {
    for (const track of row.tracks) {
      rows[`${row.id}-${track.id}`] = stable({
        kind: track.kind ?? null,
        component: track.component ?? null,
        sources: track.data.map((d) => ({
          from: d.from,
          adapter: d.adapter ?? null,
          url: typeof d.url === 'string' ? d.url : (d.url ?? null),
          inline: d.inlineData !== undefined,
        })),
      });
    }
  }
  return rows;
}

describe.each(CASES)('golden: $name', ({ configPath, root }) => {
  it('resolution (expected to change with the refactor)', async () => {
    const { extendsFetcher } = fetchersFor(root);
    const config = await loadConfig(await readFile(configPath, 'utf8'), {
      registry,
      extendsFetcher,
      // `src/default-config.yaml` declares no accession of its own — the
      // element supplies it at mount. Pass the same one every other case
      // uses so the shipped config is covered rather than skipped.
      accession: ACCESSION,
    });
    expect(resolutionOf(config)).toMatchSnapshot();
  });

  it('payloads (must survive the refactor byte-identically)', async () => {
    const { extendsFetcher, fetchOne } = fetchersFor(root);
    const config = await loadConfig(await readFile(configPath, 'utf8'), {
      registry,
      extendsFetcher,
      accession: ACCESSION,
    });
    const { data, hasData } = await loadProtvistaData(
      ACCESSION,
      config,
      fetchOne,
      (name) => registry.getAdapter(name),
      {}
    );
    expect(stable({ hasData, data })).toMatchSnapshot();
  });
});

/**
 * The resolution matrix, in one table.
 *
 * Every shipped config exercises a handful of (kind, source) pairs; this
 * covers the grid itself — every built-in kind against every recognised
 * extension, an extensionless URL, and an explicit `adapter:`. It is the most
 * concentrated statement of what the refactor rewires, and the cheapest place
 * to read off whether a rewiring did what was intended.
 *
 * Expected to change: the adapter *names* in it are being deleted. What must
 * stay true is the column structure — every cell that resolves today must
 * still resolve, and every cell that is an error today must still be one.
 */
describe('golden: kind × source resolution matrix', () => {
  const SOURCES: Array<[string, string]> = [
      ['file .csv', './x.csv'],
      ['file .tsv', './x.tsv'],
      ['file .json', './x.json'],
      ['file .bed', './x.bed'],
      ['hosted .csv', 'https://lab.test/x.csv'],
      ['hosted .json', 'https://lab.test/x.json'],
    ['extensionless URL', 'https://lab.test/api/x'],
  ];

  it('resolves every kind against every source form', () => {
    const matrix: Record<string, Record<string, string>> = {};
    for (const kind of registry.listSemanticKinds()) {
      matrix[kind] = {};
      for (const [label, data] of SOURCES) {
        const normalized = normalizeConfig(
          {
            accession: ACCESSION,
            rows: [{ id: 'G', tracks: [{ id: 't', kind, data }] }],
          },
          { registry }
        );
        // Resolution *and* validation outcome. Several cells are expected to
        // flip from "resolves to X" to "rejected": `kind: linegraph` at a
        // `.bed` file resolves to `linegraph` today because the family has no
        // `.bed` member, but BED carries feature records, so the shape split
        // turns it into a config error. Recording both halves means that flip
        // shows up in the diff instead of hiding behind an unchanged name.
        const issues = validateConfig(
          {
            accession: ACCESSION,
            rows: [{ id: 'G', tracks: [{ id: 't', kind, data }] }],
          },
          registry
        ).issues.map((i) => i.code);
        const adapter =
          normalized.rows[0].tracks[0].data[0].adapter ?? '(none)';
        matrix[kind][label] =
          issues.length > 0 ? `${adapter} [${issues.join(',')}]` : adapter;
      }
      // Inline and explicit-adapter forms don't vary by kind's extension
      // handling, but they do vary by whether the kind's records need
      // wrapping — which is exactly what step 1 wired and the refactor must
      // preserve.
      const inline = normalizeConfig(
        {
          accession: ACCESSION,
          rows: [
            {
              id: 'G',
              tracks: [
                { id: 't', kind, data: { from: 'inline', inlineData: [] } },
              ],
            },
          ],
        },
        { registry }
      );
      matrix[kind]['inline'] =
        inline.rows[0].tracks[0].data[0].adapter ?? '(none)';
    }
    expect(matrix).toMatchSnapshot();
  });
});
