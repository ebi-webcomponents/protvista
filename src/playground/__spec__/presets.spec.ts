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
 * The `extend-uniprot` preset's `extends:` is a jsDelivr URL, which is not
 * fetched in CI. Mirror `starter-kit.spec.ts`: substitute this repo's
 * `src/default-config.yaml` — the same text the build copies verbatim to the
 * `dist/` file jsDelivr serves — so the seed loads offline. Presets without an
 * `extends:` never invoke this fetcher.
 */
const extendsFetcher = async (ref: string): Promise<string> => {
  if (/^https?:\/\//i.test(ref)) {
    expect(
      ref.endsWith('/dist/default-config.yaml'),
      `unexpected remote extends target: ${ref}`
    ).toBe(true);
    return defaultConfigYaml;
  }
  throw new Error(`unexpected local extends target: ${ref}`);
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

  it('the extend-uniprot preset extends a tag, not an exact version', () => {
    // The recipe ships pinned to this package's version, which is bumped in
    // the release commit and published minutes-to-days later. The docs site
    // deploys from `next` on every push, so a pinned playground preset spends
    // that window fetching a release npm does not have yet. See
    // `withPublishedExtends` in presets.ts.
    const config = getPreset('extend-uniprot')!.config;
    expect(config).toContain(
      'extends: https://cdn.jsdelivr.net/npm/protvista-uniprot@beta/dist/default-config.yaml'
    );
    expect(config).not.toMatch(/protvista-uniprot@\d/);
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
