import type { AdapterFunction } from '../types';

type VariationFeature = {
  genomicLocation?: string[];
  begin: string | number;
  association?: Array<{ disease?: boolean }>;
  [key: string]: unknown;
};

type VariationData = { sequence?: string; features: VariationFeature[] };

export const variationGraphAdapter: AdapterFunction = (raw) => {
  const data = raw as VariationData;
  if (data.sequence && data.features.length) {
    const variants = data.features.map((variant) => ({
      ...variant,
      accession: variant.genomicLocation?.join(', '),
      start: variant.begin,
    }));

    const total = new Uint8ClampedArray(data.sequence.length);
    const diseaseTotal = new Uint8ClampedArray(data.sequence.length);

    for (const { start, association } of variants) {
      const index = +start;
      // skip if the variant is outside of bounds
      if (index < 1 || index > data.sequence.length) continue;

      total[index] += 1;

      if (!association) continue;
      const hasDisease = association.find(
        (association) => association.disease === true
      );
      if (hasDisease) diseaseTotal[index] += 1;
    }

    const range = [0, Math.max(Math.max(...total), Math.max(...diseaseTotal))];
    const graphData = [
      {
        name: 'variant',
        range,
        color: 'darkgrey',
        values: [...total].map((value, index) => ({
          position: index,
          value: value,
        })),
      },
      {
        name: 'disease causing variant',
        range,
        color: 'red',
        values: [...diseaseTotal].map((value, index) => ({
          position: index,
          value: value,
        })),
      },
    ];
    return graphData;
  }
};
