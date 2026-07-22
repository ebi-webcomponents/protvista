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
 *   - `csv` / `json` are bring-your-own-file. The examples reference
 *     `data: ./hotspots.*`, which the loader resolves against the *page*,
 *     not the config's directory — so for the playground we repoint them
 *     at `./sample-data/hotspots.*`. The demo config (vite.demo.config.mjs)
 *     serves/emits those from the canonical `examples/` files (no committed
 *     copy — single source of truth). That is the only edit from verbatim,
 *     and it makes the file-backed presets actually render here.
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

// Repoint a file-backed example's page-relative data path at the sample
// data served with the playground (public/sample-data/*, copied into the
// build). Keeps the rest of the example config verbatim.
const withServedData = (config: string): string =>
  config.replace(/data:\s*\.\/(hotspots\.\w+)/, 'data: ./sample-data/$1');

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
    config: withServedData(csvConfig),
    accession: DEFAULT_ACCESSION,
  },
  {
    id: 'json',
    label: 'Bring your own data (JSON file)',
    config: withServedData(jsonConfig),
    accession: DEFAULT_ACCESSION,
  },
];

export const DEFAULT_PRESET_ID = 'uniprot-default';

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}
