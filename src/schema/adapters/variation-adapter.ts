import {
  ProteinsAPIVariation,
  AminoAcid,
  SourceType,
  Variant,
  Xref,
  VariationDatum,
} from '@nightingale-elements/nightingale-variation-canvas';

import type { AdapterFunction } from '../types';

export type TransformedVariant = VariationDatum & Variant;

const getSourceType = (xrefs: Xref[], sourceType: SourceType) => {
  const xrefNames = xrefs ? xrefs.map((ref) => ref.name) : [];
  if (sourceType === 'uniprot' || sourceType === 'mixed') {
    xrefNames.push('uniprot');
  }
  return xrefNames;
};

export const variationAdapter: AdapterFunction = (
  raw
): { sequence: string; variants: TransformedVariant[] } | null => {
  const { sequence, features } = (raw ?? {}) as ProteinsAPIVariation;
  // Refuse to run against an empty payload — behaviour preserved from the
  // legacy loader, which skipped this adapter when the fetched body was
  // empty (an empty array leaves `features` undefined here).
  if (!features) return null;
  const variants = features.map((variant) => ({
    ...variant,
    accession: variant.genomicLocation?.join(', '),
    variant: variant.alternativeSequence || AminoAcid.Empty,
    start: +variant.begin,
    xrefNames: getSourceType(variant.xrefs, variant.sourceType),
    hasPredictions: variant.predictions && variant.predictions.length > 0,
  }));
  return { sequence, variants };
};
