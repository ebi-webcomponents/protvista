/**
 * Machine-readable source of truth for the per-adapter payload reference.
 *
 * ProtVista's JSON Schema (`schema.json`) validates viewer *configuration*
 * but deliberately omits *payload* schemas — the shapes adapters consume.
 * This table fills that gap for documentation: one entry per built-in
 * adapter, split into two tiers.
 *
 *   - `generic` — the bring-your-own-data file adapters (`features-csv`,
 *     `features-tsv`, `features-json`, `bed`). These are the shapes an
 *     author actually authors, so each carries a full field table.
 *   - `domain` — the UniProt/EBI adapters (`uniprot-*`, `interpro-*`,
 *     `alphafold-*`, `alphamissense-*`). These consume responses a data
 *     *provider* (an EBI API) supplies, not shapes the user writes, so
 *     each carries only a short informational summary.
 *
 * This is NOT a normative schema. The normative contract for the generic
 * format lives in `specs/generic-format-adapters.md`; the Intent vs
 * Representation split in `specs/config-approach.md`. Do not restate those
 * here — this table is the input to the generated `docs/adapter-reference.md`
 * and `public/schema/v1/feature-record.schema.json` (run `yarn adapters:sync`).
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

/** A generic bring-your-own-data file adapter (author supplies the file). */
export interface GenericAdapterDoc {
  name: KnownAdapterName;
  tier: 'generic';
  /** Human label, e.g. "CSV (comma-separated)". */
  title: string;
  /** File extension the shorthand `data: ./x.csv` recognises. */
  ext: string;
  /** How the loader fetches the body before handing it to the adapter. */
  body: 'text' | 'json';
  summary: string;
  /**
   * For the delimited header formats (CSV/TSV): the columns the header row
   * must contain. Mirrors `REQUIRED_COLUMNS` in `./dsv`. Undefined for
   * headerless / object formats (`features-json`, `bed`).
   */
  headerColumns?: readonly string[];
  fields: readonly FieldDoc[];
  /** Coordinate / synthetic-field caveats (BED's 0-based half-open, …). */
  coordinateNote?: string;
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

export type AdapterDoc = GenericAdapterDoc | DomainAdapterDoc;

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

const JSON_FIELDS: readonly FieldDoc[] = FEATURE_RECORD_FIELDS.map((f) =>
  f.name === 'start'
    ? {
        ...f,
        notes:
          '1-based start position (inclusive). `begin` is accepted as an alias; `start` wins when both are present.',
      }
    : f
);

export const ADAPTER_REFERENCE: readonly AdapterDoc[] = [
  // ── Generic bring-your-own-data adapters ────────────────────────────
  {
    name: 'features-csv',
    tier: 'generic',
    title: 'CSV (comma-separated)',
    ext: '.csv',
    body: 'text',
    summary:
      'A header row plus one feature per line. Point a track at `./x.csv` (or set `adapter: features-csv`).',
    headerColumns: ['type', 'start', 'end', 'description'],
    fields: FEATURE_RECORD_FIELDS,
    coordinateNote:
      'The header must contain `type,start,end,description`; `score` is an optional column. A `description` cell may be empty (the column is required, the value is not).',
  },
  {
    name: 'features-tsv',
    tier: 'generic',
    title: 'TSV (tab-separated)',
    ext: '.tsv',
    body: 'text',
    summary:
      'Identical to `features-csv` but tab-delimited. Point a track at `./x.tsv`.',
    headerColumns: ['type', 'start', 'end', 'description'],
    fields: FEATURE_RECORD_FIELDS,
    coordinateNote:
      'The header must contain `type<TAB>start<TAB>end<TAB>description`; `score` is an optional column.',
  },
  {
    name: 'features-json',
    tier: 'generic',
    title: 'JSON array of feature objects',
    ext: '.json',
    body: 'json',
    summary:
      'A JSON array of objects with the same fields as `features-csv`. Point a track at `./x.json`. Extra object keys are ignored.',
    fields: JSON_FIELDS,
    coordinateNote:
      '`start` may instead be given as `begin` (the UniProt convention); `start` wins when both are present.',
  },
  {
    name: 'bed',
    tier: 'generic',
    title: 'BED (tab-separated, positional)',
    ext: '.bed',
    body: 'text',
    summary:
      'Standard BED (BED3–BED6), headerless and positional. Point a track at `./x.bed`.',
    fields: [
      {
        name: 'chrom',
        type: 'string',
        required: false,
        notes:
          'Column 1 — sequence name; informational only for this single-sequence viewer, so it is dropped.',
      },
      {
        name: 'chromStart',
        type: 'number',
        required: true,
        notes: 'Column 2 — 0-based start; mapped to `start` (start = chromStart + 1).',
      },
      {
        name: 'chromEnd',
        type: 'number',
        required: true,
        notes: 'Column 3 — 0-based half-open end; mapped to 1-based inclusive `end`.',
      },
      {
        name: 'name',
        type: 'string',
        required: false,
        notes: 'Column 4 (optional) — mapped to `description`.',
      },
      {
        name: 'score',
        type: 'number',
        required: false,
        notes: 'Column 5 (optional) — mapped to `score`.',
      },
    ],
    coordinateNote:
      'BED coordinates are 0-based half-open and converted to 1-based inclusive. `track`/`browser`/`#` header lines are skipped. Output records carry a synthetic `type: "BED"`; columns 6+ (strand, …) are dropped.',
  },

  // ── Domain adapters (a data provider / EBI API supplies the payload) ─
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
    kind: 'features-interpro',
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
    kind: 'confidence-score',
    component: 'nightingale-colored-sequence',
    inputSummary:
      'AlphaFold prediction list (matched to the protein sequence) plus the UniProt entry. The adapter then fetches the per-residue confidence JSON and returns pLDDT categories.',
    inputs: 2,
    fetchesSecondaryUrl: true,
  },
  {
    name: 'alphamissense-average-csv',
    tier: 'domain',
    kind: 'pathogenicity-score',
    component: 'nightingale-colored-sequence',
    inputSummary:
      'AlphaFold prediction list (with an AlphaMissense annotations URL) plus the UniProt entry. The adapter fetches the annotations CSV and returns per-position average pathogenicity codes.',
    inputs: 2,
    fetchesSecondaryUrl: true,
  },
  {
    name: 'alphamissense-full-csv',
    tier: 'domain',
    kind: 'pathogenicity-heatmap',
    component: 'nightingale-sequence-heatmap',
    inputSummary:
      'Same AlphaMissense annotations as `alphamissense-average-csv`, but returns the full per-mutation `{ xValue, yValue, score }` matrix for the heatmap.',
    inputs: 2,
    fetchesSecondaryUrl: true,
  },
];
