/**
 * Seed configurations offered by the playground preset picker.
 *
 * The `config` text is loaded verbatim from the canonical, CI-validated
 * sources — the shipped `src/default-config.yaml` and the `examples/`
 * directory (guarded by `src/__spec__/examples.spec.ts`). Keeping the
 * playground pointed at that single source of truth is the whole point:
 * the playground, Starter Kit, tutorial, and docs all draw from the
 * same samples rather than maintaining divergent copies.
 *
 * Which examples are surfaced here is deliberately curated for a single
 * hosted page:
 *   - `small-protein` is the shipped default viewer on crambin (P01542, 46
 *     residues), like the dev presets below, to show a short UniProt entry.
 *   - `basic` / `inline-data` / `linegraph` render fully standalone
 *     (`inline-data` also carries a `theme:` block — no-code config theming;
 *     `linegraph` is the bring-your-own-metric line graph, inline so it needs
 *     nothing served).
 *   - `conservation` is real per-residue conservation for rubredoxin
 *     (P24297) as a line graph, its most conserved residues, and UniProt's
 *     binding sites. Its accession is its config's own, because its data
 *     belongs to that protein.
 *   - `csv` (a single standalone track — one row, no group) and `json` (a
 *     live UniProt API track next to the BYO file) are bring-your-own-file.
 *   - `csv-styled` is `csv`'s own-data idea plus a custom `dataTooltip`: a
 *     `color` column per feature and a `kind: markdown` template showing the
 *     file's extra `ref` / `url` columns, the latter via `{% link %}`.
 *   - `own-sequence` and `small-peptide` show a protein from its own
 *     sequence (`sequence:`, inline FASTA) rather than an accession:
 *     `own-sequence` with its records inline, so it makes no request, and
 *     `small-peptide` (Trp-cage, 20 residues) with a served CSV.
 *
 *   The file-backed examples reference `data: ./<file>`, which the loader
 *   resolves against the *page*, not the config's directory — so for the
 *   playground `withServedData` repoints them at the site-absolute
 *   `/protvista/sample-data/[<example>/]<file>` (base-absolute so it resolves
 *   regardless of the page's trailing slash). Those files are copies in
 *   `docs/public/sample-data/` of the canonical files under `examples/`
 *   (`hotspots.*` at the top, for the tutorial's links; the rest under the
 *   example's own name), and `presets.spec.ts` checks every copy is
 *   byte-identical to its source. That is the only edit from verbatim, and it
 *   makes the presets render on the native Astro page.
 *   - `extend-uniprot` (from `starter-kit/recipes/`) layers a custom track
 *     on the full default viewer via `extends:`. Its exact-version jsDelivr
 *     pin is repointed here at `/protvista/default-config.yaml` (see
 *     `withServedExtends`), which this site generates from the repo's own
 *     `src/default-config.yaml` — still fetched over the network at render
 *     time, but always the config this commit ships, and served by both the
 *     dev server and the built `site/` bundle (unlike
 *     `examples/extend-default`, whose `extends: /src/default-config.yaml`
 *     is dev-only). Its `./data/` sample is repointed at the served
 *     `hotspots.csv` like the presets above.
 *   - `extend-default` / `tsv` / `bed` / `sequence-only` are intentionally
 *     omitted: `extend-default` is the dev-only `/src/`-extends variant just
 *     described; `tsv` duplicates `csv`'s shape and `bed` is niche;
 *     `sequence-only` names its FASTA file, which `own-sequence` writes
 *     inline.
 *
 * `__spec__/presets.spec.ts` loads every preset through `loadConfig`, so
 * a broken seed can never ship.
 */
import defaultConfigYaml from '../default-config.yaml?raw';
import basicConfig from '../../examples/basic/config.yaml?raw';
import inlineDataConfig from '../../examples/inline-data/config.yaml?raw';
import linegraphConfig from '../../examples/linegraph/config.yaml?raw';
import csvConfig from '../../examples/csv/config.yaml?raw';
import csvStyledConfig from '../../examples/csv-styled/config.yaml?raw';
import jsonConfig from '../../examples/json/config.yaml?raw';
// The `extends:` recipe from the Starter Kit. Its base config is repointed
// below at the copy this site serves, so — unlike examples/extend-default,
// which extends the dev-only `/src/` path — it resolves on the hosted
// playground (the element fetches it over the network at render time).
import extendUniprotConfig from '../../starter-kit/recipes/extend-uniprot.yaml?raw';
import sequenceInlineConfig from '../../examples/sequence-inline/config.yaml?raw';
import smallPeptideConfig from '../../examples/small-peptide/config.yaml?raw';
import conservationConfig from '../../examples/conservation/config.yaml?raw';
import { DEFAULT_ACCESSION } from './url-state.js';

/**
 * Repoint every page-relative `data: ./<name>.(csv|tsv|json|bed)` in a
 * file-backed example at the copy served with the docs site
 * (`docs/public/sample-data/[<dir>/]<name>`, served at
 * `/protvista/sample-data/[<dir>/]<name>`). Base-absolute, so it resolves
 * whatever the playground page's URL. Block, flow and quoted forms are all
 * rewritten; a line whose `data:` follows a `#` is a comment and is left
 * alone. The rest of the example config stays verbatim.
 *
 * `__spec__/presets.spec.ts` checks that every served path exists and that
 * every served file is byte-identical to its source under `examples/`.
 */
export const withServedData = (config: string, dir?: string): string =>
  config.replace(
    /^([^#\n]*?\bdata:\s*)(["']?)\.\/([\w.-]+\.(?:csv|tsv|json|bed))\2/gm,
    `$1/protvista/sample-data/${dir ? `${dir}/` : ''}$3`
  );

// The extend-uniprot recipe ships its sample under `./data/`; repoint it at the
// same served hotspots.csv the csv/json presets use so it renders on the page.
// A pattern, not the literal string, for the same reason `withServedData` is
// one: a reformatted or requoted recipe must still be repointed, and the
// alternative to matching is silently shipping a preset whose data path 404s.
const withServedExtendsData = (config: string): string =>
  config.replace(
    /data:\s*(["']?)\.\/data\/hotspots-extends\.csv\1/,
    'data: /protvista/sample-data/hotspots.csv'
  );

/**
 * Point the recipe's `extends:` at the base config this site serves, rather
 * than the published copy the recipe ships pinned to.
 *
 * The pin is right for the Starter Kit — the kit is downloaded beside a release
 * and `starter-kit.spec.ts` holds every reference in it to this package's
 * version. The hosted playground is not on that clock: the docs site deploys on
 * every push to `main`, while npm publishes only at release, so a published
 * base config is always a base config from some *other* commit.
 *
 * That was tolerable while the gap was one release of drift. It stopped being
 * tolerable when the kind vocabulary was renamed: the published copy still
 * said `confidence-score` / `pathogenicity-score` / `pathogenicity-heatmap` /
 * `features-interpro`, so the merged config failed validation with four
 * `unknown-semantic-kind` errors on the page that exists to demonstrate a
 * working config — and no test caught it, because the preset test substitutes
 * the repo's own config for the remote one.
 *
 * `/protvista/default-config.yaml` is generated from `src/default-config.yaml`
 * by `docs/src/pages/default-config.yaml.ts`, so the preset now extends the
 * config this commit actually ships. It is still fetched over the network at
 * render time, which is the part the preset exists to show.
 */
const SERVED_BASE_CONFIG = '/protvista/default-config.yaml';

// Also the dev-only `/src/default-config.yaml` that examples/extend-default
// names, so a community view copied from it resolves on the docs site.
const withServedExtends = (config: string): string =>
  config.replace(
    /extends:\s*(["']?)(?:[^\s"']*\/protvista-uniprot@[^/\s"']+\/dist|\/src)\/default-config\.yaml\1/,
    `extends: ${SERVED_BASE_CONFIG}`
  );

export interface Preset {
  /** Stable id used in shareable links (`#preset=<id>`). */
  id: string;
  /** Human-readable label for the picker. */
  label: string;
  /** One-line note shown under the picker: what this example demonstrates. */
  description?: string;
  /** Raw YAML/JSON config text loaded into the editor. */
  config: string;
  /** Accession to preview this preset against. */
  accession: string;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'uniprot-default',
    label: 'UniProt (default viewer)',
    description: 'The shipped UniProt viewer — every built-in track group.',
    config: defaultConfigYaml,
    accession: DEFAULT_ACCESSION,
  },
  {
    id: 'small-protein',
    label: 'Small protein: crambin (46 aa)',
    description:
      'The default UniProt viewer on a 46-residue entry (P01542): how a short ' +
      'protein renders.',
    config: defaultConfigYaml,
    accession: 'P01542',
  },
  {
    id: 'basic',
    label: 'Basic (URL-sourced track)',
    description: 'A minimal config: one group, one track from a URL source.',
    config: basicConfig,
    accession: DEFAULT_ACCESSION,
  },
  {
    id: 'inline-data',
    label: 'Inline data + theme colour',
    description:
      'Track data written inline (no fetch), plus a no-code theme colour.',
    config: inlineDataConfig,
    accession: DEFAULT_ACCESSION,
  },
  {
    id: 'linegraph',
    label: 'Your own line graph (inline values)',
    description:
      'kind: linegraph — a bring-your-own metric drawn as a line from inline ' +
      '{ position, value } records.',
    config: linegraphConfig,
    accession: DEFAULT_ACCESSION,
  },
  {
    id: 'conservation',
    label: 'Conservation line graph (rubredoxin)',
    description:
      'Per-residue conservation of P24297 across 5,852 Pfam PF00301 ' +
      "sequences, its most conserved residues, and UniProt's iron-binding " +
      'sites.',
    config: withServedData(conservationConfig, 'conservation'),
    // The config's own `accession:` (the protein its data belongs to) wins
    // over the box; this keeps the box showing the protein on screen.
    accession: 'P24297',
  },
  {
    id: 'csv',
    label: 'Your own data (CSV, single track)',
    description: 'A standalone bring-your-own-CSV track (no group wrapper).',
    config: withServedData(csvConfig),
    accession: DEFAULT_ACCESSION,
  },
  {
    id: 'json',
    label: 'UniProt + your own data (JSON)',
    description: 'A live UniProt track alongside a bring-your-own-JSON track.',
    config: withServedData(jsonConfig),
    accession: DEFAULT_ACCESSION,
  },
  {
    id: 'csv-styled',
    label: 'Customize a tooltip (CSV + dataTooltip)',
    description:
      'Per-feature colour from a CSV column, plus a custom dataTooltip ' +
      'template showing the extra ref/url columns as a Markdoc link.',
    config: withServedData(csvStyledConfig, 'csv-styled'),
    accession: DEFAULT_ACCESSION,
  },
  {
    id: 'extend-uniprot',
    label: 'Extend UniProt (your track + the full default viewer)',
    description:
      'Your own track layered on the entire default UniProt viewer via ' +
      'extends: — fetches the published base config over the network.',
    config: withServedExtends(withServedExtendsData(extendUniprotConfig)),
    accession: DEFAULT_ACCESSION,
  },
  {
    id: 'own-sequence',
    label: 'Your own sequence (FASTA, no UniProt)',
    description:
      'sequence: with inline FASTA and a features track. Paste your own ' +
      'FASTA over it, or press Load data file… and pick a .fasta. No request ' +
      'leaves the page.',
    config: sequenceInlineConfig,
    // Not used: a `sequence:` config disables the accession box.
    accession: DEFAULT_ACCESSION,
  },
  {
    id: 'small-peptide',
    label: 'Small peptide, your own sequence (20 aa)',
    description:
      'Trp-cage TC5b, a designed 20-residue miniprotein (PDB 1L2Y), with its ' +
      'helices from a CSV.',
    config: withServedData(smallPeptideConfig, 'small-peptide'),
    accession: DEFAULT_ACCESSION,
  },
];

/**
 * Dev-only edge cases: the shipped default config rendered against tricky
 * proteins, for eyeballing odd/rich rendering and breaking things. These
 * reuse the bundled `default-config.yaml` verbatim (same text as
 * `uniprot-default`) and vary only the accession, so they need nothing served
 * and are validated by the same preset test. Surfaced only in the dev
 * playground (`/protvista/playground?dev`); a shared link to one auto-enables it.
 */
export const DEV_PRESETS: readonly Preset[] = [
  {
    id: 'dev-multimer',
    label: 'Multimer',
    description: 'A multimeric entry — exercises the 3D structure group.',
    config: defaultConfigYaml,
    accession: 'Q55DI5',
  },
  {
    id: 'dev-no-features',
    label: 'No features',
    description: 'Sparse/empty feature tracks — check empty-state rendering.',
    config: defaultConfigYaml,
    accession: 'A0A2K5ULD0',
  },
  {
    id: 'dev-sparse-features',
    label: 'Sparse features',
    description: 'Only some feature types present.',
    config: defaultConfigYaml,
    accession: 'P41892',
  },
  {
    id: 'dev-outdated-alphafold',
    label: 'Outdated AlphaFold',
    description: 'An entry whose AlphaFold model is out of date.',
    config: defaultConfigYaml,
    accession: 'O75319',
  },
  {
    id: 'dev-alphamissense',
    label: 'AlphaMissense',
    description: 'Has AlphaMissense pathogenicity data (score + heatmap).',
    config: defaultConfigYaml,
    accession: 'P07550',
  },
  {
    id: 'dev-ptms',
    label: 'PTMs',
    description: 'Rich post-translational modifications.',
    config: defaultConfigYaml,
    accession: 'Q653S1',
  },
  {
    id: 'dev-no-confidence',
    label: 'No AlphaFold confidence',
    description: 'No AlphaFold confidence track for this entry.',
    config: defaultConfigYaml,
    accession: 'P27958',
  },
  {
    id: 'dev-3d-beacons',
    label: '3D beacons',
    description: '3D-Beacons structure coverage.',
    config: defaultConfigYaml,
    accession: 'P38398',
  },
  {
    id: 'dev-rna-editing',
    label: 'RNA editing',
    description: 'RNA-editing sites.',
    config: defaultConfigYaml,
    accession: 'B7Z6K7',
  },
];

/**
 * Community views, discovered from every `examples/<dir>/` folder that has a
 * `preset.json` beside its `config.yaml`: adding one is adding a folder (plus
 * the served copy of its data under `docs/public/sample-data/<dir>/`), with
 * no edit to this file or to any test.
 */
export interface CommunityManifest {
  label: string;
  description?: string;
  /** Length of the config's accession (canonical UniProt sequence). */
  length?: number;
}

/**
 * One community view from its folder name and the text of its `preset.json`
 * and `config.yaml`. Every mistake throws an error naming the file, since a
 * bare TypeError at module load would take down every preset test (and the
 * playground) without saying which folder caused it.
 */
export function communityPreset(
  dir: string,
  manifestText: string,
  raw: string | undefined
): Preset & { length?: number } {
  const where = `examples/${dir}`;
  // The served path and the `#preset=` link both carry the folder name.
  if (!/^[\w-]+$/.test(dir)) {
    throw new Error(`${where}: use only letters, digits, - and _ in its name`);
  }
  if (raw === undefined) {
    throw new Error(`${where}: preset.json but no config.yaml`);
  }
  let manifest: Record<string, unknown> | null = null;
  let invalid: string | undefined;
  try {
    manifest = JSON.parse(manifestText) as Record<string, unknown> | null;
  } catch (error) {
    invalid = (error as Error).message;
  }
  if (invalid !== undefined) {
    throw new Error(`${where}/preset.json: ${invalid}`);
  }
  const { label, description, length } = manifest ?? {};
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error(`${where}/preset.json: "label" must be a non-empty string`);
  }
  if (description !== undefined && typeof description !== 'string') {
    throw new Error(`${where}/preset.json: "description" must be a string`);
  }
  if (
    length !== undefined &&
    !(typeof length === 'number' && Number.isInteger(length) && length > 0)
  ) {
    throw new Error(
      `${where}/preset.json: "length" must be a positive integer`
    );
  }
  const accession = /^accession:\s*["']?([A-Za-z0-9_-]+)/m.exec(raw)?.[1];
  return {
    id: `community-${dir}`,
    label,
    description: description as string | undefined,
    config: withServedExtends(withServedData(raw, dir)),
    accession: accession ?? DEFAULT_ACCESSION,
    // A `sequence:` view has no accession of its own: a length here would be
    // filed under the default accession's and change every preset on it.
    length:
      accession === undefined ? undefined : (length as number | undefined),
  };
}

const communityManifests = import.meta.glob<string>(
  '../../examples/*/preset.json',
  { eager: true, query: '?raw', import: 'default' }
);
const exampleConfigs = import.meta.glob<string>(
  '../../examples/*/config.yaml',
  { eager: true, query: '?raw', import: 'default' }
);

/**
 * The community views for `examples/<dir>/preset.json` and `config.yaml`
 * texts keyed by path (as `import.meta.glob` gives them), sorted by label.
 */
export const communityPresetsFrom = (
  manifests: Record<string, string>,
  configs: Record<string, string>
): (Preset & { length?: number })[] =>
  Object.entries(manifests)
    .map(([path, manifest]) => {
      const parts = path.split('/');
      return communityPreset(
        parts[parts.length - 2],
        manifest,
        configs[path.replace(/preset\.json$/, 'config.yaml')]
      );
    })
    .sort((a, b) => a.label.localeCompare(b.label));

export const COMMUNITY_PRESETS: readonly (Preset & { length?: number })[] =
  communityPresetsFrom(communityManifests, exampleConfigs);

/** Consumer presets plus the dev edge cases (the dev playground's full set). */
export const ALL_PRESETS: readonly Preset[] = [
  ...PRESETS,
  ...COMMUNITY_PRESETS,
  ...DEV_PRESETS,
];

export const DEFAULT_PRESET_ID = 'uniprot-default';

/** True when `id` names a dev-only edge-case preset. */
export function isDevPreset(id: string): boolean {
  return DEV_PRESETS.some((preset) => preset.id === id);
}

/** Look up a preset by id across both the consumer and dev sets. */
export function getPreset(id: string): Preset | undefined {
  return ALL_PRESETS.find((preset) => preset.id === id);
}
