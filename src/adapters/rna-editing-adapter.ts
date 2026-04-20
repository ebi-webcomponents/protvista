import { AminoAcid } from '@nightingale-elements/nightingale-variation';

import { RnaEditing, TransformedRnaEditing } from './types/rna-editing';

const transformData = ({
  sequence,
  features = [],
}: RnaEditing): {
  sequence: string;
  variants: TransformedRnaEditing[];
} => ({
  sequence,
  variants: features.map((feature) => ({
    ...feature,
    accession: feature.variantType.genomicLocation?.join(', '),
    variant: feature.variantType.mutatedType || AminoAcid.Empty,
    start: +feature.locationType.position.position,
    end: +feature.locationType.position.position,
    consequenceType: feature.variantType.consequenceType,
  })),
});

export default transformData;
