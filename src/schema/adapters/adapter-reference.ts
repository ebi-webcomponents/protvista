/**
 * Machine-readable source of truth for the per-adapter payload reference.
 *
 * ProtVista's JSON Schema (`schema.json`) validates viewer *configuration*
 * but deliberately omits *payload* schemas — the shapes adapters consume.
 * This table fills that gap for documentation: one entry per built-in
 * adapter, split into three tiers.
 *
 *   - `generic` — the bring-your-own-data file adapters (`features-csv`,
 *     `features-tsv`, `features-json`, `bed`). These are the shapes an
 *     author actually authors, so each carries a full field table.
 *   - `domain` — the UniProt/EBI adapters (`uniprot-*`, `interpro-*`,
 *     `alphafold-*`, `alphamissense-*`). These consume responses a data
 *     *provider* (an EBI API) supplies, not shapes the user writes, so
 *     each carries only a short informational summary.
 *   - `byod-kind` — adapters that back a semantic `kind` (so they look like
 *     `domain` entries) but consume a shape the *author* supplies rather
 *     than a provider response (`linegraph`). No file extension selects
 *     them on its own, so they cannot be `generic`; and calling them
 *     provider-supplied would be false, so they cannot be `domain`.
 *   - `byod-format` — the delimited siblings of a `byod-kind` adapter
 *     (`linegraph-csv`, `linegraph-tsv`): the same records out of CSV/TSV,
 *     reached only by a file extension on a track already using that kind.
 *
 * This is NOT a normative schema. The normative contract for the generic
 * format lives in `specs/generic-format-adapters.md`; the Intent vs
 * Representation split in `specs/config-approach.md`. Do not restate those
 * here — this table is the input to the generated `docs/adapter-reference.md`
 * and `public/schema/v1/feature-record.schema.json` (run `pnpm adapters:sync`).
 *
 * Kept in sync with the code by `src/schema/__spec__/adapter-reference.spec.ts`:
 * every entry name must match `BUILTIN_ADAPTERS`, every domain `kind` must
 * resolve (via the registry) to the entry's own adapter/component, and the
 * generic header columns must match `REQUIRED_COLUMNS` in `./dsv`.
 */

import type {
  KnownAdapterName,
  KnownSemanticKind,
  KnownComponentName,
} from '../types.js';

/** One documented field of a generic bring-your-own-data payload. */
export interface FieldDoc {
  name: string;
  type: 'string' | 'number';
  /** Required in the emitted feature record (the shape the track renders). */
  required: boolean;
  notes?: string;
}


/** A domain adapter (a data provider / EBI API supplies the payload). */
export interface DomainAdapterDoc {
  name: KnownAdapterName;
  tier: 'domain';
  /** The built-in semantic kind that resolves to this adapter. */
  kind: KnownSemanticKind;
  /** The component that kind renders with. */
  component: KnownComponentName;
  /** One-line description of the response shape the adapter consumes. */
  inputSummary: string;
  /** Number of source bodies the adapter receives (see the track's `source:`). */
  inputs: 1 | 2;
  /** Whether the adapter fetches a further URL discovered in its input. */
  fetchesSecondaryUrl: boolean;
}



export type AdapterDoc = DomainAdapterDoc;

/** Retained name for the kind-addressed tier, now the only one. */
export type KindAdapterDoc = DomainAdapterDoc;

/**
 * The canonical output shape shared by the generic feature adapters —
 * the `FeatureRecord` in `./dsv`. Reused for the CSV/TSV/JSON field tables
 * and as the source for the generated `feature-record.schema.json` fragment.
 */
export const FEATURE_RECORD_FIELDS: readonly FieldDoc[] = [
  {
    name: 'type',
    type: 'string',
    required: true,
    notes:
      'Feature category label (e.g. DOMAIN, BINDING). Drives `filter:` and colour grouping.',
  },
  {
    name: 'start',
    type: 'number',
    required: true,
    notes: '1-based start position (inclusive).',
  },
  {
    name: 'end',
    type: 'number',
    required: true,
    notes: '1-based end position (inclusive).',
  },
  {
    name: 'description',
    type: 'string',
    required: false,
    notes: 'Free text shown in the default tooltip. Omitted when empty.',
  },
  {
    name: 'score',
    type: 'number',
    required: false,
    notes: 'Optional numeric score. Omitted when empty.',
  },
];


export const ADAPTER_REFERENCE: readonly AdapterDoc[] = [
  {
    name: 'uniprot-features-json',
    tier: 'domain',
    kind: 'features',
    component: 'nightingale-track-canvas',
    inputSummary:
      'UniProt Proteins API features response — `{ features: [...] }`, each feature carrying `type`, `begin`, `end`, and evidence.',
    inputs: 1,
    fetchesSecondaryUrl: false,
  },
  {
    name: 'interpro-entries-json',
    tier: 'domain',
    kind: 'interpro-features',
    component: 'nightingale-track-canvas',
    inputSummary:
      'InterPro protein-entries response — `{ results: [{ metadata, proteins: [{ entry_protein_locations }] }] }`. Representative-domain fragments are flattened into features.',
    inputs: 1,
    fetchesSecondaryUrl: false,
  },
  {
    name: 'uniprot-variation-json',
    tier: 'domain',
    kind: 'variants',
    component: 'nightingale-variation-canvas',
    inputSummary:
      'UniProt Proteins API variation response — `{ sequence, features: [...] }` with per-variant genomic location, alternative sequence and predictions.',
    inputs: 1,
    fetchesSecondaryUrl: false,
  },
  {
    name: 'uniprot-variation-counts-json',
    tier: 'domain',
    kind: 'variant-counts',
    component: 'nightingale-linegraph-track',
    inputSummary:
      'Same variation response as `uniprot-variation-json`; aggregated into per-position total and disease-causing variant counts for the line graph.',
    inputs: 1,
    fetchesSecondaryUrl: false,
  },
  {
    name: 'uniprot-rna-editing-json',
    tier: 'domain',
    kind: 'rna-editing',
    component: 'nightingale-variation-canvas',
    inputSummary:
      'UniProt Proteins API RNA-editing response — `{ sequence, features: [{ locationType, variantType }] }`.',
    inputs: 1,
    fetchesSecondaryUrl: false,
  },
  {
    name: 'uniprot-rna-editing-counts-json',
    tier: 'domain',
    kind: 'rna-editing-counts',
    component: 'nightingale-linegraph-track',
    inputSummary:
      'Same RNA-editing response as `uniprot-rna-editing-json`; aggregated into per-position missense counts for the line graph.',
    inputs: 1,
    fetchesSecondaryUrl: false,
  },
  {
    name: 'uniprot-proteomics-json',
    tier: 'domain',
    kind: 'peptides',
    component: 'nightingale-track-canvas',
    inputSummary:
      'UniProt Proteomics API response — `{ features: [{ unique, ptms }] }`; PTMs are lifted onto each peptide as residues to highlight.',
    inputs: 1,
    fetchesSecondaryUrl: false,
  },
  {
    name: 'uniprot-proteomics-ptm-json',
    tier: 'domain',
    kind: 'peptides-ptm',
    component: 'nightingale-track-canvas',
    inputSummary:
      'PTMeXchange proteomics-PTM response — `{ features: [{ begin, peptide, ptms: [{ name, position, dbReferences }] }] }`; emitted as per-residue MOD_RES markers coloured by confidence.',
    inputs: 1,
    fetchesSecondaryUrl: false,
  },
  {
    name: 'uniprot-proteins-pdb-json',
    tier: 'domain',
    kind: 'structure-coverage',
    component: 'nightingale-track-canvas',
    inputSummary:
      'UniProt Proteins API entry — `{ dbReferences: [{ type: "PDB", properties: { chains } }] }`; PDB chain ranges are parsed and overlapping intervals merged.',
    inputs: 1,
    fetchesSecondaryUrl: false,
  },
  {
    name: 'alphafold-prediction-json',
    tier: 'domain',
    kind: 'alphafold-confidence',
    component: 'nightingale-colored-sequence',
    inputSummary:
      'AlphaFold prediction list (matched to the protein sequence) plus the UniProt entry. The adapter then fetches the per-residue confidence JSON and returns pLDDT categories.',
    inputs: 2,
    fetchesSecondaryUrl: true,
  },
  {
    name: 'alphamissense-average-csv',
    tier: 'domain',
    kind: 'alphamissense-pathogenicity',
    component: 'nightingale-colored-sequence',
    inputSummary:
      'AlphaFold prediction list (with an AlphaMissense annotations URL) plus the UniProt entry. The adapter fetches the annotations CSV and returns per-position average pathogenicity codes.',
    inputs: 2,
    fetchesSecondaryUrl: true,
  },
  {
    name: 'alphamissense-full-csv',
    tier: 'domain',
    kind: 'alphamissense-heatmap',
    component: 'nightingale-sequence-heatmap',
    inputSummary:
      'Same AlphaMissense annotations as `alphamissense-average-csv`, but returns the full per-mutation `{ xValue, yValue, score }` matrix for the heatmap.',
    inputs: 2,
    fetchesSecondaryUrl: true,
  },
];

