/**
 * Per-kind default tooltip specs — small, declarative, uncontroversial.
 *
 * The library's defaults intentionally surface only a handful of fields
 * common to every feature: type, name, description, position. Rich
 * UniProt-specific rendering (cross-references, evidence, disease
 * associations, population frequencies, …) lives in the consumer
 * application — the UniProt website listens for the Nightingale
 * `change` event, mounts its own (React, Lit, whatever) UI, and sets
 * the `notooltip` attribute on the element to suppress the library's
 * built-in popover. Downstream embedders with other priorities wire
 * the same way.
 *
 * The split is deliberate. Reproducing UniProt-specific HTML here
 * means every future evidence-source change has to land in two
 * places. Keeping library defaults minimal lets the consumer own the
 * rich UX without fighting the library.
 *
 * A track that wants richer defaults reaches for `dataTooltip:` in
 * YAML (either `kind: fields` with more rows or `kind: markdown` with
 * a template).
 *
 * Graph tracks (`variant-counts`, `rna-editing-counts`, `confidence-score`,
 * `pathogenicity-score`, `pathogenicity-heatmap`) never had per-item
 * tooltips and have no entry here — the resolver returns `''` for
 * unregistered kinds.
 */
import type { TooltipDefaultsRegistry } from './types.js';

export const tooltipDefaults: TooltipDefaultsRegistry = {
  features: {
    kind: 'fields',
    fields: [
      { path: 'type', label: 'Type' },
      { path: 'description', label: 'Description' },
      { path: 'start', label: 'Start' },
      { path: 'end', label: 'End' },
    ],
  },

  'features-interpro': {
    kind: 'fields',
    fields: [
      { path: 'name', label: 'Name' },
      { path: 'accession', label: 'Accession' },
      { path: 'source_database', label: 'Source database' },
      { path: 'start', label: 'Start' },
      { path: 'end', label: 'End' },
    ],
  },

  variants: {
    kind: 'fields',
    fields: [
      { path: 'wildType', label: 'Wild type' },
      { path: 'alternativeSequence', label: 'Variant' },
      { path: 'consequenceType', label: 'Consequence' },
      { path: 'begin', label: 'Position' },
    ],
  },

  peptides: {
    kind: 'fields',
    fields: [
      { path: 'peptide', label: 'Peptide' },
      { path: 'type', label: 'Type' },
      { path: 'start', label: 'Start' },
      { path: 'end', label: 'End' },
    ],
  },

  'peptides-ptm': {
    kind: 'fields',
    fields: [
      { path: 'type', label: 'Type' },
      { path: 'start', label: 'Position' },
    ],
  },

  'structure-coverage': {
    kind: 'fields',
    fields: [
      { path: 'type', label: 'Type' },
      { path: 'start', label: 'Start' },
      { path: 'end', label: 'End' },
    ],
  },

  'rna-editing': {
    kind: 'fields',
    fields: [
      { path: 'variantType.wildType', label: 'Wild type' },
      { path: 'variantType.mutatedType', label: 'Edited' },
      { path: 'consequenceType', label: 'Consequence' },
      { path: 'start', label: 'Position' },
    ],
  },
};
