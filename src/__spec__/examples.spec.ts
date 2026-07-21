/**
 * Validates every directory under `examples/` — the canonical,
 * CI-validated set of example ProtVista viewer configs (see
 * `examples/README.md`).
 *
 * For each `examples/<name>/config.yaml` (discovered dynamically —
 * no hardcoded list, so new example directories are covered
 * automatically):
 *
 *   1. Schema validation — `loadConfig` must accept it.
 *   2. Data pipeline — `loadProtvistaData`, driven by the real
 *      exported `adapters` map (the same one `<protvista-uniprot>`
 *      uses), must produce `hasData: true` from the example's own
 *      on-disk sample data. Local (`./`-prefixed) sources are read
 *      from disk for real, proving the shipped sample files actually
 *      parse through their real adapter; `https://` sources get an
 *      inert canned response (safe — `loadProtvistaData` catches
 *      per-track adapter failures rather than throwing, exactly as
 *      exercised in `load-data-baseline.spec.ts`).
 *   3. Render smoke test — mounting a `<protvista-uniprot>` instance
 *      with that data must produce a populated group/track DOM,
 *      proving the shape `loadProtvistaData` produced is actually
 *      renderable, not just structurally valid.
 */

import { describe, it, expect, beforeAll } from 'vitest';
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

function makeExampleFetchers(exampleDir: string) {
  const extendsFetcher = async (ref: string): Promise<string> =>
    readFile(resolve(exampleDir, ref), 'utf8');

  const fetchOne = async (
    url: string,
    responseType: 'json' | 'text'
  ): Promise<unknown> => {
    if (/^https?:\/\//i.test(url)) {
      return responseType === 'json' ? CANNED_FEATURES_RESPONSE : '';
    }
    const text = await readFile(resolve(exampleDir, url), 'utf8');
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

describe.each(discoverExamples())('example: $name', ({ dir, configPath }) => {
  let config: NormalizedConfig;

  beforeAll(async () => {
    const text = await readFile(configPath, 'utf8');
    const { extendsFetcher } = makeExampleFetchers(dir);
    config = await loadConfig(text, {
      accession: REFERENCE_ACCESSION,
      extendsFetcher,
    });
  });

  it('validates against the schema', () => {
    expect(config).toBeDefined();
    expect(config.groups.length).toBeGreaterThan(0);
  });

  it('loads real on-disk sample data through the real adapter map', async () => {
    const { fetchOne } = makeExampleFetchers(dir);
    const result = await loadProtvistaData(
      REFERENCE_ACCESSION,
      config,
      fetchOne,
      realAdapters as AdapterMap
    );
    expect(result.hasData).toBe(true);
  });

  it('smoke-renders at least one populated group', async () => {
    const { fetchOne } = makeExampleFetchers(dir);
    const result = await loadProtvistaData(
      REFERENCE_ACCESSION,
      config,
      fetchOne,
      realAdapters as AdapterMap
    );

    const el = buildInstance({
      config,
      data: result.data,
      hasData: result.hasData,
      openGroups: config.groups.map((g) => g.id),
    });

    const target = document.createElement('div');
    render(el.render(), target);

    // A group with no renderable aggregate is legitimately hidden by
    // the real template (see `hasRenderableData` gating in
    // `protvista-uniprot.ts`), so this doesn't assert every declared
    // group renders — just that the example's own data produced at
    // least one real, populated group/track (the actual smoke-render
    // guarantee).
    expect(
      target.querySelectorAll(`.${CSS_PREFIX}-group`).length
    ).toBeGreaterThan(0);
    expect(
      target.querySelectorAll(`.${CSS_PREFIX}-group__track`).length
    ).toBeGreaterThan(0);
  });
});
