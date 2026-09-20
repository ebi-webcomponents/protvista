/**
 * Guards the preset seeds: every config offered by the picker must load
 * cleanly (parse → validate → normalize) against its accession, so a
 * broken seed can never reach the playground UI.
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../schema/load.js';
import { createRegistry } from '../../schema/registry.js';
import {
  ALL_PRESETS,
  DEFAULT_PRESET_ID,
  getPreset,
  isDevPreset,
} from '../presets.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import defaultConfigYaml from '../../default-config.yaml?raw';

/** Every doc page, by path. Vitest runs from the repo root, so these resolve
 *  from the cwd exactly as they do in `tutorial-doc.spec.ts`. */
const DOCS_DIR = 'docs/src/content/docs';
const docPages = (): [string, string][] =>
  readdirSync(DOCS_DIR, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.md') || f.endsWith('.mdx'))
    .map((f) => [join(DOCS_DIR, f), readFileSync(join(DOCS_DIR, f), 'utf8')]);

/**
 * The `extend-uniprot` preset's `extends:` is a URL the docs site serves and
 * the element fetches at render time, which CI does not do. Serve it here from
 * `src/default-config.yaml` — the one file
 * `docs/src/pages/default-config.yaml.ts` generates that endpoint from, so the
 * substitution is the same bytes rather than an assumption about them.
 *
 * That assumption is what this fetcher used to make: it substituted this
 * config for a *jsDelivr* URL on the grounds that the published copy was "the
 * same text". After the kind vocabulary was renamed it no longer was, so the
 * preset passed here and failed in the browser with four unknown-kind errors.
 * Hence `SERVED_BASE_CONFIG` below, which pins the target to something this
 * repo actually controls.
 *
 * Presets without an `extends:` never invoke this fetcher.
 */
const SERVED_BASE_CONFIG = '/protvista/default-config.yaml';

const extendsFetcher = async (ref: string): Promise<string> => {
  if (ref === SERVED_BASE_CONFIG) return defaultConfigYaml;
  throw new Error(`unexpected extends target: ${ref}`);
};

describe('presets', () => {
  it('exposes the default preset', () => {
    expect(getPreset(DEFAULT_PRESET_ID)).toBeDefined();
  });

  it('flags dev presets and not consumer presets', () => {
    expect(isDevPreset('dev-multimer')).toBe(true);
    expect(isDevPreset('uniprot-default')).toBe(false);
    expect(isDevPreset('nope')).toBe(false);
  });

  it.each(ALL_PRESETS.map((p) => [p.id, p] as const))(
    'preset "%s" loads without error',
    async (_id, preset) => {
      await expect(
        loadConfig(preset.config, {
          accession: preset.accession,
          registry: createRegistry(),
          extendsFetcher,
        })
      ).resolves.toBeDefined();
    }
  );

  it('file-backed presets point at the served sample data, not a bare page-relative file', () => {
    for (const id of ['csv', 'json', 'extend-uniprot']) {
      const preset = getPreset(id);
      expect(preset).toBeDefined();
      // Repointed to the served /protvista/sample-data/ path so it loads.
      expect(preset!.config).toContain('/protvista/sample-data/hotspots.');
      // No bare relative `data:` path survives (covers both `./hotspots.*`
      // and extend-uniprot's `./data/hotspots-extends.csv`), quoted or not —
      // an example is free to requote its own paths, and the repointing is a
      // pattern match that a changed quoting style could slip past.
      expect(preset!.config).not.toMatch(/data:\s*["']?\.\//);
    }
  });

  it('the extend-uniprot preset extends the config this commit ships', () => {
    // The recipe ships pinned to this package's version, published
    // minutes-to-days after the release commit; the docs site deploys from
    // `next` on every push. So any *published* base config is one from another
    // commit — fine while that only meant drift, fatal once a vocabulary
    // rename made the published copy invalid against this build. The preset
    // therefore extends what this site serves. See `withServedExtends`.
    const config = getPreset('extend-uniprot')!.config;
    expect(config).toContain(`extends: ${SERVED_BASE_CONFIG}`);
    // No published artefact is named: neither an exact pin nor a dist-tag.
    expect(config).not.toMatch(/protvista-uniprot@/);
    expect(config).not.toMatch(/extends:[^\n]*cdn\./);
    // And it repoints a requoted recipe cleanly: an unbalanced quote would
    // leave `extends: https://...yaml"`, a plain scalar whose trailing quote
    // is fetched as `.yaml%22`.
    expect(config).not.toMatch(/extends:[^\n]*["']/);
  });

  it('the served base config is generated from the shipped one', () => {
    // The endpoint the preset extends must serve this repo's own config, not
    // a copy of it. A copy is what the jsDelivr arrangement amounted to and it
    // went stale silently; a file under `docs/public/` would do the same.
    //
    // Asserted on the endpoint's source because it lives outside this
    // package's `rootDir` and so cannot be imported here: what matters is
    // that it re-exports the canonical YAML rather than restating it.
    const endpoint = readFileSync(
      join('docs', 'src', 'pages', 'default-config.yaml.ts'),
      'utf8'
    );
    expect(endpoint).toMatch(
      /import\s+\w+\s+from\s+['"][^'"]*\/src\/default-config\.yaml\?raw['"]/
    );
    expect(endpoint).toMatch(/new Response\(\s*\w+/);
  });

  it('every kind the served base config uses is registered', async () => {
    // The invariant that actually broke: the base config the playground
    // extends has to speak this build's vocabulary. Asserted against the
    // registry rather than a name list so a future rename fails here first.
    const registry = createRegistry();
    const kinds = [
      ...defaultConfigYaml.matchAll(/^\s*kind:\s*([\w-]+)/gm),
    ].map(([, k]) => k);
    expect(kinds.length).toBeGreaterThan(5);
    expect(
      [...new Set(kinds)].filter((k) => !registry.hasSemanticKind(k))
    ).toEqual([]);
  });

  it('every playground link in the docs names a preset that exists', () => {
    // `initialState()` falls back to the default preset for an id it does not
    // know, so a typo or a renamed preset shows the wrong viewer under prose
    // describing another one, with nothing anywhere to say so.
    const known = new Set(ALL_PRESETS.map((p) => p.id));
    const bad: string[] = [];
    const seen: string[] = [];
    for (const [path, text] of docPages()) {
      for (const [, id] of text.matchAll(/#preset=([\w-]+)/g)) {
        seen.push(id);
        if (!known.has(id)) bad.push(`${path}: #preset=${id}`);
      }
    }
    expect(bad, 'unknown preset id(s) deep-linked from the docs').toEqual([]);
    // A walk that found nothing would pass the assertion above by saying
    // nothing at all. The tutorial alone links four presets.
    expect(
      seen.length,
      `no #preset= links found under ${DOCS_DIR} — has the docs tree moved?`
    ).toBeGreaterThan(0);
  });
});
