/**
 * Validates `starter-kit/` — the source of truth for the standalone
 * template repository `ebi-webcomponents/protvista-starter-kit`, which
 * is published from this directory on release (see
 * `.github/workflows/publish-starter-kit.yml`).
 *
 * The kit lives in this repo precisely so that this suite can be its
 * gate. A published template has no access to this toolchain, so
 * without these tests the only thing standing between a schema change
 * and a broken onboarding repo would be a cross-repo sync job noticing
 * after the fact. Here, breaking the kit fails `yarn test:unit` in the
 * PR that breaks it.
 *
 * Each of `config.yaml` and `recipes/*.yaml` gets the same three-stage
 * treatment `examples.spec.ts` applies to `examples/` — load, run the
 * real data pipeline, smoke-render — plus four checks specific to
 * being a distributed artefact:
 *
 *   - every `protvista-uniprot@<version>` reference across the kit
 *     matches this package's own version, so a release bump cannot
 *     silently ship a kit pinned to the previous one;
 *   - every relative `data:` path resolves to a file that exists;
 *   - every CSV/TSV it ships carries the required header columns;
 *   - `index.html` carries no `vendor/` reference, which would mean
 *     the local-preview escape hatch (a hand-copied build, used to run
 *     the kit before a release is published) had leaked into a commit.
 *
 * The helpers below deliberately mirror rather than import
 * `examples.spec.ts`: importing across spec files would register that
 * suite's tests a second time.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'lit';

import { loadConfig } from '../schema/load';
import type { NormalizedConfig } from '../schema/normalize';
import { loadProtvistaData } from '../load-data';
import { createRegistry } from '../schema/registry';
import { REQUIRED_COLUMNS } from '../schema/adapters/dsv';
import { CSS_PREFIX } from '../styles/css-prefix';
// Side-effect import: registers the custom element, so the smoke
// render below exercises the real template.
import '../protvista-uniprot';

const registry = createRegistry();
const resolveAdapter = (name: string) => registry.getAdapter(name);

const REFERENCE_ACCESSION = 'P05067';
const SEQ_LEN = 770;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const KIT_ROOT = join(REPO_ROOT, 'starter-kit');

const PACKAGE_VERSION: string = JSON.parse(
  readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')
).version;

/** Every config file the kit ships, as page-relative paths. */
const KIT_CONFIGS = [
  'config.yaml',
  'recipes/tsv.yaml',
  'recipes/extend-uniprot.yaml',
];

/** Files that may carry a pinned `protvista-uniprot@<version>` reference. */
const VERSION_PINNED_FILES = [
  'index.html',
  'README.md',
  ...KIT_CONFIGS,
];

const CANNED_FEATURES_RESPONSE = {
  features: [
    { type: 'DOMAIN', begin: 1, end: 770, description: 'Fixture domain' },
  ],
};

/**
 * Resolve a reference the way the browser will. Everything in the kit
 * is served from the kit root (that is where `index.html` sits), so
 * both `./data/x.csv` and an origin-absolute `/data/x.csv` land in the
 * same place — which is exactly the property that lets every recipe
 * share one `data/` folder.
 */
const resolveLocalRef = (ref: string): string =>
  ref.startsWith('/') ? join(KIT_ROOT, ref) : resolve(KIT_ROOT, ref);

/**
 * The kit's `extends:` target is a pinned jsDelivr URL, which cannot
 * be fetched here — the version it names is published at release time,
 * not now. Serving this repo's own `src/default-config.yaml` in its
 * place is the honest substitution: jsDelivr will serve that exact
 * file, because `package.json` ships `src` in its `files` array (an
 * invariant pinned by `schema-publishing.spec.ts`).
 */
const extendsFetcher = async (ref: string): Promise<string> => {
  if (/^https?:\/\//i.test(ref)) {
    expect(
      ref.endsWith('/src/default-config.yaml'),
      `unexpected remote extends target: ${ref}`
    ).toBe(true);
    return readFile(join(REPO_ROOT, 'src/default-config.yaml'), 'utf8');
  }
  return readFile(resolveLocalRef(ref), 'utf8');
};

const fetchOne = async (
  url: string,
  responseType: 'json' | 'text'
): Promise<unknown> => {
  if (/^https?:\/\//i.test(url)) {
    return responseType === 'json' ? CANNED_FEATURES_RESPONSE : '';
  }
  const text = await readFile(resolveLocalRef(url), 'utf8');
  return responseType === 'json' ? JSON.parse(text) : text;
};

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

/** Tracks backed by the kit's own sample files, rather than a canned URL. */
function findLocalTracks(
  config: NormalizedConfig
): { trackId: string; key: string }[] {
  const found: { trackId: string; key: string }[] = [];
  for (const group of config.rows) {
    for (const track of group.tracks) {
      const from = track.data[0]?.from;
      if (from === 'file' || from === 'inline') {
        found.push({ trackId: track.id, key: `${group.id}-${track.id}` });
      }
    }
  }
  return found;
}

/** Every `data:` value in a raw config file, however it is nested. */
function collectDataRefs(configText: string): string[] {
  return [...configText.matchAll(/^\s*data:\s*(\S+)\s*$/gm)].map((m) => m[1]);
}

it('the starter kit is present and complete', () => {
  expect(existsSync(KIT_ROOT), 'starter-kit/ should exist').toBe(true);
  for (const rel of [...VERSION_PINNED_FILES, 'LICENSE', 'LICENSE-docs']) {
    expect(existsSync(join(KIT_ROOT, rel)), `starter-kit/${rel}`).toBe(true);
  }
});

describe('starter kit — distribution invariants', () => {
  it('pins this package version everywhere it names one', () => {
    const found: { file: string; version: string }[] = [];
    for (const rel of VERSION_PINNED_FILES) {
      const text = readFileSync(join(KIT_ROOT, rel), 'utf8');
      for (const m of text.matchAll(/protvista-uniprot@(\d+\.\d+\.\d+)/g)) {
        found.push({ file: rel, version: m[1] });
      }
    }

    // index.html pins the bundle; extend-uniprot.yaml pins the config it
    // extends. Both must exist, or the invariant is vacuous.
    expect(
      found.map((f) => f.file),
      'expected a pinned version in index.html and recipes/extend-uniprot.yaml'
    ).toEqual(
      expect.arrayContaining(['index.html', 'recipes/extend-uniprot.yaml'])
    );

    for (const { file, version } of found) {
      expect(
        version,
        `starter-kit/${file} pins protvista-uniprot@${version}, but this ` +
          `package is ${PACKAGE_VERSION} — bump the kit alongside the release`
      ).toBe(PACKAGE_VERSION);
    }
  });

  it('carries no reference to the local-preview vendor/ directory', () => {
    // `vendor/` holds a hand-copied build used to run the kit before a
    // release exists (see the kit's .gitignore). Committing a reference
    // to it would ship a template pointing at a file nobody else has.
    const html = readFileSync(join(KIT_ROOT, 'index.html'), 'utf8');
    expect(html).not.toMatch(/vendor\//);
  });

  it('ships sample data for every relative path its configs reference', () => {
    for (const rel of KIT_CONFIGS) {
      const text = readFileSync(join(KIT_ROOT, rel), 'utf8');
      for (const ref of collectDataRefs(text)) {
        if (/^https?:\/\//i.test(ref)) continue;
        expect(
          existsSync(resolveLocalRef(ref)),
          `starter-kit/${rel} references ${ref}, which does not exist`
        ).toBe(true);
      }
    }
  });

  it('ships sample data byte-identical to the canonical examples', () => {
    // `examples/README.md` tells maintainers that editing a sample there
    // surfaces here rather than leaving the kit silently stale. That is
    // only true if something actually compares them.
    const pairs: [string, string][] = [
      ['data/hotspots.csv', 'examples/csv/hotspots.csv'],
      ['data/hotspots.tsv', 'examples/tsv/hotspots.tsv'],
      ['data/hotspots-extends.csv', 'examples/extend-default/hotspots.csv'],
    ];
    for (const [kitRel, exampleRel] of pairs) {
      expect(
        readFileSync(join(KIT_ROOT, kitRel), 'utf8'),
        `starter-kit/${kitRel} has drifted from ${exampleRel}`
      ).toBe(readFileSync(join(REPO_ROOT, exampleRel), 'utf8'));
    }
  });

  it('keeps the unpublished-release notice strippable', () => {
    // The notice is removed at publish time by a `sed` range delete in
    // .github/workflows/publish-starter-kit.yml, which fires once the
    // pinned version is live on npm. That only works while the markers
    // stay balanced and paired, so an unbalanced edit would silently
    // ship the "does not work yet" banner on a working kit.
    for (const rel of ['index.html', 'README.md']) {
      const text = readFileSync(join(KIT_ROOT, rel), 'utf8');
      const starts = [...text.matchAll(/protvista:unpublished:start/g)].length;
      const ends = [...text.matchAll(/protvista:unpublished:end/g)].length;
      expect(starts, `starter-kit/${rel}: unbalanced unpublished markers`).toBe(
        ends
      );
      expect(
        starts,
        `starter-kit/${rel}: expected at most one unpublished block`
      ).toBeLessThanOrEqual(1);
      if (starts === 1) {
        expect(
          text.indexOf('protvista:unpublished:start'),
          `starter-kit/${rel}: end marker precedes start marker`
        ).toBeLessThan(text.indexOf('protvista:unpublished:end'));
      }
    }
  });

  it('ships delimited files carrying the required header columns', () => {
    const files = ['data/hotspots.csv', 'data/hotspots.tsv', 'data/hotspots-extends.csv'];
    for (const rel of files) {
      const header = readFileSync(join(KIT_ROOT, rel), 'utf8')
        .split('\n')[0]
        .trim();
      const columns = header.split(rel.endsWith('.tsv') ? '\t' : ',');
      for (const required of REQUIRED_COLUMNS) {
        expect(
          columns,
          `starter-kit/${rel} header is missing "${required}"`
        ).toContain(required);
      }
    }
  });
});

describe.each(KIT_CONFIGS)('starter kit config: %s', (relPath) => {
  let config: NormalizedConfig;
  let result: Awaited<ReturnType<typeof loadProtvistaData>>;

  beforeAll(async () => {
    const text = await readFile(join(KIT_ROOT, relPath), 'utf8');
    config = await loadConfig(text, {
      accession: REFERENCE_ACCESSION,
      extendsFetcher,
    });
    result = await loadProtvistaData(
      REFERENCE_ACCESSION,
      config,
      fetchOne,
      resolveAdapter
    );
  });

  it('validates against the schema', () => {
    expect(config).toBeDefined();
    expect(config.rows.length).toBeGreaterThan(0);
  });

  it('produces data through the real adapter map for its own tracks', () => {
    expect(result.hasData).toBe(true);

    const local = findLocalTracks(config);
    expect(local.length, 'the kit authors at least one local track').toBeGreaterThan(0);

    for (const { key } of local) {
      const payload = result.data[key];
      expect(Array.isArray(payload), `${key} should be an array`).toBe(true);
      expect(
        (payload as unknown[]).length,
        `${key} should be non-empty`
      ).toBeGreaterThan(0);
    }
  });

  it('smoke-renders, including each of its own tracks', () => {
    const el = buildInstance({
      config,
      data: result.data,
      hasData: result.hasData,
      openGroups: config.rows.map((g) => g.id),
    });

    const target = document.createElement('div');
    render(el.render(), target);

    expect(
      target.querySelectorAll(
        `.${CSS_PREFIX}-group__track, .${CSS_PREFIX}-group--standalone`
      ).length
    ).toBeGreaterThan(0);

    for (const { trackId, key } of findLocalTracks(config)) {
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
