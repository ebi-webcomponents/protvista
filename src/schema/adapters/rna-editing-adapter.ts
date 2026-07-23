import { AminoAcid } from '@nightingale-elements/nightingale-variation-canvas';

import type { AdapterFunction } from '../types';
import { RnaEditing, TransformedRnaEditing } from './types/rna-editing';

export const rnaEditingAdapter: AdapterFunction = (
  raw
): { sequence: string; variants: TransformedRnaEditing[] } => {
  const { sequence, features = [] } = raw as RnaEditing;
  return {
    sequence,
    variants: features.map((feature) => ({
      ...feature,
      accession: feature.variantType.genomicLocation?.join(', '),
      variant: feature.variantType.mutatedType || AminoAcid.Empty,
      start: +feature.locationType.position.position,
      end: +feature.locationType.position.position,
      consequenceType: feature.variantType.consequenceType,
    })),
  };
};
