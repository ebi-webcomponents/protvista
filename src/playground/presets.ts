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
 *   - `basic` / `inline-data` render fully standalone (`inline-data` also
 *     carries a `theme:` block — no-code config theming).
 *   - `csv` (a single standalone track — one row, no group) and `json` (a
 *     live UniProt API track next to the BYO file) are bring-your-own-file.
 *     The examples reference `data: ./hotspots.*`, which the loader resolves
 *     against the *page*, not the config's directory — so for the playground
 *     we repoint them at the site-absolute `/protvista/sample-data/hotspots.*`
 *     (base-absolute so it resolves regardless of the page's trailing slash).
 *     Those files are served from `docs/public/sample-data/` (copies of the
 *     canonical `examples/csv|json/hotspots.*`). That is the only edit from
 *     verbatim, and it makes the presets render on the native Astro page.
 *   - `extend-default` / `tsv` / `bed` are intentionally omitted:
 *     `extend-default` extends `/src/default-config.yaml`, which the
 *     built `site/` bundle does not serve (see the note in that example
 *     and examples/README.md); `tsv` duplicates `csv`'s shape and `bed`
 *     is niche.
 *
 * `__spec__/presets.spec.ts` loads every preset through `loadConfig`, so
 * a broken seed can never ship.
 */
import defaultConfigYaml from '../default-config.yaml?raw';
import basicConfig from '../../examples/basic/config.yaml?raw';
import inlineDataConfig from '../../examples/inline-data/config.yaml?raw';
import csvConfig from '../../examples/csv/config.yaml?raw';
import jsonConfig from '../../examples/json/config.yaml?raw';
import { DEFAULT_ACCESSION } from './url-state';

// Repoint a file-backed example's page-relative data path at the sample data
// served with the docs site (docs/public/sample-data/*, served at
// /protvista/sample-data/). Base-absolute so it resolves regardless of the
// playground page's URL. Keeps the rest of the example config verbatim.
const withServedData = (config: string): string =>
  config.replace(
    /data:\s*\.\/(hotspots\.\w+)/,
    'data: /protvista/sample-data/$1'
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

/** Consumer presets plus the dev edge cases (the dev playground's full set). */
export const ALL_PRESETS: readonly Preset[] = [...PRESETS, ...DEV_PRESETS];

export const DEFAULT_PRESET_ID = 'uniprot-default';

/** True when `id` names a dev-only edge-case preset. */
export function isDevPreset(id: string): boolean {
  return DEV_PRESETS.some((preset) => preset.id === id);
}

/** Look up a preset by id across both the consumer and dev sets. */
export function getPreset(id: string): Preset | undefined {
  return ALL_PRESETS.find((preset) => preset.id === id);
}
