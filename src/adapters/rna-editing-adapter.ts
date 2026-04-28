import { AminoAcid } from '@nightingale-elements/nightingale-variation';

import { RnaEditing, TransformedRnaEditing } from './types/rna-editing';
import formatTooltip from '../tooltips/rna-editing-tooltip';

const transformData = ({
  sequence,
  features = [],
}: RnaEditing): {
  sequence: string;
  variants: TransformedRnaEditing[];
} => ({
  sequence,
  variants: features.map((feature) => {
    const transformed: TransformedRnaEditing = {
      ...feature,
      accession: feature.variantType.genomicLocation?.join(', '),
      variant: feature.variantType.mutatedType || AminoAcid.Empty,
      start: +feature.locationType.position.position,
      end: +feature.locationType.position.position,
      consequenceType: feature.variantType.consequenceType,
      tooltipContent: '', // Set with transformed feature below,
    };
    transformed.tooltipContent = formatTooltip(transformed);
    return transformed;
  }),
});

export default transformData;
