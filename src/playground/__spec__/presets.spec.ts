/**
 * Guards the preset seeds: every config offered by the picker must load
 * cleanly (parse → validate → normalize) against its accession, so a
 * broken seed can never reach the playground UI.
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../schema/load.js';
import { parseConfigText } from '../../schema/parse.js';
import { createRegistry } from '../../schema/registry.js';
import {
  ALL_PRESETS,
  COMMUNITY_PRESETS,
  DEFAULT_PRESET_ID,
  DEV_PRESETS,
  PRESETS,
  getPreset,
  isDevPreset,
  withServedData,
} from '../presets.js';
import { sequenceTargetSummary, setSequence } from '../config-edit.js';
import { createLocalFileStore, localDataDiagnostics } from '../local-files.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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

/**
 * A preset's `sequence:` must be inline: a file it names would be fetched
 * from the docs host (or, since the playground holds a FASTA in the browser,
 * be reported as not loaded). Failing here keeps the test offline and says
 * which reference it was.
 */
const sequenceFetcher = async (ref: string): Promise<string> => {
  throw new Error(`a preset fetched a sequence: ${ref}`);
};

/** Whether a preset's config shows its own sequence rather than an accession. */
const declaresSequence = async (config: string): Promise<boolean> =>
  ((await parseConfigText(config)) as { sequence?: unknown }).sequence !==
  undefined;

/** Where the docs site serves sample data from, and the URL path it has. */
const SAMPLE_DATA_DIR = 'docs/public/sample-data';
const SAMPLE_DATA_URL = '/protvista/sample-data/';

/**
 * The sources of the files served at the top of `sample-data/`, which the
 * tutorial and older links name. A file in a subdirectory, `<dir>/<name>`,
 * is a copy of `examples/<dir>/<name>`.
 */
const ROOT_SAMPLE_SOURCES: Record<string, string> = {
  'hotspots.csv': 'examples/csv/hotspots.csv',
  'hotspots.json': 'examples/json/hotspots.json',
};

/** Every file under `docs/public/sample-data/`, as a path relative to it. */
const servedSampleFiles = (): string[] =>
  readdirSync(SAMPLE_DATA_DIR, {
    recursive: true,
    withFileTypes: true,
  })
    // macOS Finder drops a git-ignored .DS_Store in any folder it opens; it is
    // never committed, so it is not a sample the site serves.
    .filter((entry) => entry.isFile() && entry.name !== '.DS_Store')
    .map((entry) =>
      relative(SAMPLE_DATA_DIR, join(entry.parentPath, entry.name))
        .split(sep)
        .join('/')
    )
    .sort();

/** The served sample-data paths a config names, relative to `sample-data/`. */
const servedPathsIn = (config: string): string[] =>
  [...config.matchAll(/\/protvista\/sample-data\/([\w./-]+)/g)].map(
    ([, path]) => path
  );

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
      // The playground passes the accession box's value only to a config
      // without `sequence:`; beside one, an accession is an error
      // (`accession-and-sequence`).
      const sequenceMode = await declaresSequence(preset.config);
      await expect(
        loadConfig(preset.config, {
          ...(sequenceMode ? {} : { accession: preset.accession }),
          registry: createRegistry(),
          extendsFetcher,
          sequenceFetcher,
          requireProtein: true,
        })
      ).resolves.toBeDefined();
    }
  );

  it.each([
    ['own-sequence', 240, 'my construct v2'],
    ['small-peptide', 20, 'Trp-cage TC5b'],
  ] as const)(
    'preset "%s" shows its own %i-residue protein, written inline',
    async (id, residues, header) => {
      const config = await loadConfig(getPreset(id)!.config, {
        registry: createRegistry(),
        sequenceFetcher,
        requireProtein: true,
      });
      expect(config.accession).toBeUndefined();
      expect(config.sequence?.residues).toHaveLength(residues);
      expect(config.sequence?.header).toBe(header);
    }
  );

  it.each(ALL_PRESETS.map((p) => [p.id, p] as const))(
    'preset "%s" names no file the playground would report as not loaded',
    async (_id, preset) => {
      // #277's own pre-flight, with nothing loaded: exactly the
      // `local-file-missing` rows a visitor would see listed.
      const parsed = await parseConfigText(preset.config);
      const result = await localDataDiagnostics(
        preset.config,
        parsed,
        createLocalFileStore()
      );
      expect(result.diagnostics).toEqual([]);
      expect(result.sequenceMissing).toBe(false);
      // And no page-relative reference of any kind, block or flow style,
      // quoted or not: on the docs site it would be fetched from the page.
      expect(preset.config).not.toMatch(
        /\b(data|url|sequence|extends|source)\s*:\s*["']?\.{1,2}\//
      );
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

  describe('withServedData', () => {
    it('rewrites every page-relative data file, in block, flow and quoted form', () => {
      const config = [
        'rows:',
        '  - id: a',
        '    data: ./a.csv',
        '  - { id: b, kind: features, data: ./b.tsv }',
        '  - id: c',
        '    data: "./c.json"',
        "  - { id: d, data: './d.bed' }",
        '',
      ].join('\n');
      expect(withServedData(config, 'my-example')).toBe(
        [
          'rows:',
          '  - id: a',
          '    data: /protvista/sample-data/my-example/a.csv',
          '  - { id: b, kind: features, data: /protvista/sample-data/my-example/b.tsv }',
          '  - id: c',
          '    data: /protvista/sample-data/my-example/c.json',
          '  - { id: d, data: /protvista/sample-data/my-example/d.bed }',
          '',
        ].join('\n')
      );
    });

    it('serves from the top of sample-data/ when given no directory', () => {
      expect(withServedData('data: ./hotspots.csv\n')).toBe(
        'data: /protvista/sample-data/hotspots.csv\n'
      );
    });

    it('leaves a comment that quotes a data path, other extensions and other paths alone', () => {
      const config = [
        '# The track reads data: ./x.csv beside the page.',
        '  - id: a  # was data: ./old.csv',
        '    data: ./notes.txt',
        '    data: ./data/hits.csv',
        '    data: https://lab.example/x.csv',
        '',
      ].join('\n');
      expect(withServedData(config, 'my-example')).toBe(config);
    });
  });

  it('the main picker offers the examples of your own sequence and small proteins', () => {
    const main = PRESETS.map((p) => p.id);
    const dev = DEV_PRESETS.map((p) => p.id);
    for (const id of [
      'small-protein',
      'conservation',
      'own-sequence',
      'small-peptide',
    ]) {
      expect(main).toContain(id);
      expect(dev).not.toContain(id);
    }
  });

  it('the main picker lists its presets in order', () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      'uniprot-default',
      'small-protein',
      'basic',
      'inline-data',
      'linegraph',
      'conservation',
      'csv',
      'json',
      'csv-styled',
      'extend-uniprot',
      'own-sequence',
      'small-peptide',
    ]);
  });

  it.each(COMMUNITY_PRESETS.map((p) => [p.id, p] as const))(
    'community view "%s" names its label, protein and its length',
    async (_id, preset) => {
      expect(preset.label.trim()).not.toBe('');
      const parsed = (await parseConfigText(preset.config)) as {
        accession?: string;
        sequence?: unknown;
      };
      if (parsed.sequence === undefined) {
        expect(parsed.accession, 'give the config an accession:').toBe(
          preset.accession
        );
        expect(preset.length, 'give preset.json a length').toBeGreaterThan(0);
      }
    }
  );

  it('small-protein is the shipped default viewer on crambin', () => {
    const preset = getPreset('small-protein')!;
    expect(preset.config).toBe(defaultConfigYaml);
    expect(preset.accession).toBe('P01542');
  });

  it('conservation opens on the protein its data belongs to', async () => {
    const preset = getPreset('conservation')!;
    expect(preset.accession).toBe('P24297');
    const parsed = (await parseConfigText(preset.config)) as {
      accession?: string;
    };
    expect(parsed.accession).toBe(preset.accession);
  });

  it('loading a FASTA over own-sequence replaces its inline block and keeps its track', async () => {
    // What the "Use as sequence" form defaults to: "This config", because
    // nothing in it needs UniProt data.
    const text = getPreset('own-sequence')!.config;
    const parsed = await parseConfigText(text);
    expect(sequenceTargetSummary(parsed)).toEqual({
      needsUniprot: 0,
      extends: false,
      parses: true,
      replaces: { inline: true, residues: 240 },
    });
    // What "Use" then does to the editor text.
    const result = await setSequence(text, parsed, './construct.fasta');
    if (!('text' in result)) throw new Error(result.error);
    expect(result.text).not.toContain('>my construct v2');
    const after = (await parseConfigText(result.text)) as {
      sequence?: unknown;
      rows?: unknown;
    };
    expect(after.sequence).toBe('./construct.fasta');
    expect(after.rows).toEqual((parsed as { rows: unknown }).rows);
  });

  it('every served sample-data path a preset names exists on the docs site', () => {
    const missing: string[] = [];
    for (const preset of ALL_PRESETS) {
      for (const path of servedPathsIn(preset.config)) {
        if (!existsSync(join(SAMPLE_DATA_DIR, path))) {
          missing.push(`${preset.id}: ${SAMPLE_DATA_URL}${path}`);
        }
      }
    }
    expect(missing).toEqual([]);
    // A preset set that named no example's own file would pass by checking
    // nothing.
    expect(ALL_PRESETS.flatMap((p) => servedPathsIn(p.config))).toEqual(
      expect.arrayContaining([
        'small-peptide/structure.csv',
        'conservation/conservation.csv',
        'conservation/conserved-sites.csv',
      ])
    );
  });

  it('every file the docs site serves as sample data is byte-identical to its source under examples/', () => {
    // The served files are copies, so a sample edited under `examples/`
    // (where its own tests run) must be copied again, or the playground
    // shows the old one.
    const files = servedSampleFiles();
    const problems: string[] = [];
    for (const file of files) {
      const source = file.includes('/')
        ? join('examples', file)
        : ROOT_SAMPLE_SOURCES[file];
      if (!source) {
        problems.push(`${file}: add its source to ROOT_SAMPLE_SOURCES`);
      } else if (!existsSync(source)) {
        problems.push(`${file}: no ${source}`);
      } else if (
        !readFileSync(join(SAMPLE_DATA_DIR, file)).equals(readFileSync(source))
      ) {
        problems.push(`${file}: differs from ${source}`);
      }
    }
    expect(problems).toEqual([]);
    // A walk that found nothing would pass by checking nothing.
    expect(files).toEqual(
      expect.arrayContaining(['hotspots.csv', 'hotspots.json'])
    );
  });

  it('the extend-uniprot preset extends the config this commit ships', () => {
    // The recipe ships pinned to this package's version, published
    // minutes-to-days after the release commit; the docs site deploys from
    // `main` on every push. So any *published* base config is one from another
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
    const kinds = [...defaultConfigYaml.matchAll(/^\s*kind:\s*([\w-]+)/gm)].map(
      ([, k]) => k
    );
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
