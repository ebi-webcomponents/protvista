/**
 * Built-in adapter table.
 *
 * The single aggregation point for adapters the library ships with.
 * `registerBuiltinAdapters()` in `../registry` walks this table and
 * registers every entry into each new registry, so consumers get them
 * without calling `registerAdapter()` themselves — and, crucially, the
 * loader resolves the runtime adapter function through the same registry
 * (`registry.getAdapter(name)`), so this table is the single source of
 * truth for both config validation and data loading.
 *
 * Two families live here:
 *
 *   - Generic bring-your-own-data *format* adapters (`features-json`,
 *     `features-csv`, `features-tsv`, `bed`) — parse an author-supplied
 *     file into the canonical feature shape.
 *   - The UniProt/EBI *domain* adapters (`uniprot-features-json`,
 *     `interpro-entries-json`, `alphafold-prediction-json`, …) — transform
 *     a specific EBI API response into what a track renders. These carry
 *     the semantic-kind adapter names referenced by `BUILTIN_SEMANTIC_KINDS`.
 *
 * To add a built-in adapter: write the adapter module in this directory
 * (a named `export const … : AdapterFunction`), add its name to
 * `KnownAdapterName` in `../types`, and add one line to the table below.
 */

import type { AdapterFunction, KnownAdapterName } from '../types';
import { featuresCsv } from './features-csv';
import { featuresTsv } from './features-tsv';
import { featuresJson } from './features-json';
import { bed } from './bed';
import { featureAdapter } from './feature-adapter';
import { interproAdapter } from './interpro-adapter';
import { proteomicsAdapter } from './proteomics-adapter';
import { proteomicsPtmAdapter } from './ptm-exchange-adapter';
import { structureAdapter } from './structure-adapter';
import { variationAdapter } from './variation-adapter';
import { variationGraphAdapter } from './variation-graph-adapter';
import { rnaEditingAdapter } from './rna-editing-adapter';
import { rnaEditingGraphAdapter } from './rna-editing-graph-adapter';
import { alphafoldConfidenceAdapter } from './alphafold-confidence-adapter';
import { alphamissensePathogenicityAdapter } from './alphamissense-pathogenicity-adapter';
import { alphamissenseHeatmapAdapter } from './alphamissense-heatmap-adapter';

export const BUILTIN_ADAPTERS: ReadonlyArray<
  readonly [KnownAdapterName, AdapterFunction]
> = [
  // Generic bring-your-own-data file-format adapters.
  ['features-csv', featuresCsv],
  ['features-tsv', featuresTsv],
  ['features-json', featuresJson],
  ['bed', bed],
  // UniProt/EBI domain adapters (referenced by the built-in semantic kinds).
  ['uniprot-features-json', featureAdapter],
  ['interpro-entries-json', interproAdapter],
  ['uniprot-proteomics-json', proteomicsAdapter],
  ['uniprot-proteomics-ptm-json', proteomicsPtmAdapter],
  ['uniprot-proteins-pdb-json', structureAdapter],
  ['uniprot-variation-json', variationAdapter],
  ['uniprot-variation-counts-json', variationGraphAdapter],
  ['uniprot-rna-editing-json', rnaEditingAdapter],
  ['uniprot-rna-editing-counts-json', rnaEditingGraphAdapter],
  ['alphafold-prediction-json', alphafoldConfidenceAdapter],
  ['alphamissense-average-csv', alphamissensePathogenicityAdapter],
  ['alphamissense-full-csv', alphamissenseHeatmapAdapter],
];
