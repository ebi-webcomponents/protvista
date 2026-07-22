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
 *   - `basic` / `inline-data` render fully standalone.
 *   - `csv` / `json` are bring-your-own-file: on the deployed one-page
 *     playground their `data: ./hotspots.*` path resolves against the
 *     page (not the config's directory) and 404s, so the track is
 *     simply hidden — the config still validates and the group renders.
 *     They demonstrate the file shape; the Starter Kit is where you
 *     actually host the data alongside the page.
 *   - `extend-default` / `tsv` / `bed` are intentionally omitted:
 *     `extend-default` extends `/src/default-config.yaml`, which the
 *     built `demo/` bundle does not serve (see the note in that example
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

export interface Preset {
  /** Stable id used in shareable links (`#preset=<id>`). */
  id: string;
  /** Human-readable label for the picker. */
  label: string;
  /** Raw YAML/JSON config text loaded into the editor. */
  config: string;
  /** Accession to preview this preset against. */
  accession: string;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'uniprot-default',
    label: 'UniProt (default viewer)',
    config: defaultConfigYaml,
    accession: DEFAULT_ACCESSION,
  },
  {
    id: 'basic',
    label: 'Basic (URL-sourced track)',
    config: basicConfig,
    accession: DEFAULT_ACCESSION,
  },
  {
    id: 'inline-data',
    label: 'Inline data (no server)',
    config: inlineDataConfig,
    accession: DEFAULT_ACCESSION,
  },
  {
    id: 'csv',
    label: 'Bring your own data (CSV file)',
    config: csvConfig,
    accession: DEFAULT_ACCESSION,
  },
  {
    id: 'json',
    label: 'Bring your own data (JSON file)',
    config: jsonConfig,
    accession: DEFAULT_ACCESSION,
  },
];

export const DEFAULT_PRESET_ID = 'uniprot-default';

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}
