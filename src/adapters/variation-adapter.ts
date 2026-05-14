import {
  ProteinsAPIVariation,
  AminoAcid,
  SourceType,
  Variant,
  Xref,
  VariationDatum,
} from '@nightingale-elements/nightingale-variation-canvas';

import formatTooltip from '../tooltips/variation-tooltip';

export type TransformedVariant = VariationDatum & Variant;

const getSourceType = (xrefs: Xref[], sourceType: SourceType) => {
  const xrefNames = xrefs ? xrefs.map((ref) => ref.name) : [];
  if (sourceType === 'uniprot' || sourceType === 'mixed') {
    xrefNames.push('uniprot');
  }
  return xrefNames;
};

const transformData = (
  data: ProteinsAPIVariation
): {
  sequence: string;
  variants: TransformedVariant[];
} | null => {
  const { sequence, features } = data;
  const variants = features.map((variant) => {
    // Build the transformed shape first (with `start`) so formatTooltip can
    // read the unified field name rather than the wire-format `begin`.
    const transformed = {
      ...variant,
      accession: variant.genomicLocation?.join(', ') ?? '',
      variant: variant.alternativeSequence || AminoAcid.Empty,
      start: +variant.begin,
      xrefNames: getSourceType(variant.xrefs, variant.sourceType),
      hasPredictions: !!(variant.predictions && variant.predictions.length > 0),
    };
    return {
      ...transformed,
      tooltipContent: formatTooltip(transformed),
    };
  });
  if (!variants) return null;
  return { sequence, variants };
};

export default transformData;
