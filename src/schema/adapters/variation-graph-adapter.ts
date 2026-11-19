import type { AdapterFunction } from '../types.js';

type VariationFeature = {
  genomicLocation?: string[];
  begin: string | number;
  association?: Array<{ disease?: boolean }>;
  [key: string]: unknown;
};

type VariationData = { sequence?: string; features: VariationFeature[] };

/** One `{ position, value }` per residue, 1..sequence.length (skips slot 0). */
const toValues = (counts: Uint32Array) =>
  Array.from(counts.subarray(1), (value, index) => ({
    position: index + 1,
    value,
  }));

export const variationGraphAdapter: AdapterFunction = (raw) => {
  const data = raw as VariationData;
  if (data.sequence && data.features.length) {
    const variants = data.features.map((variant) => ({
      ...variant,
      accession: variant.genomicLocation?.join(', '),
      start: variant.begin,
    }));

    // Indexed by 1-based residue position, so slot 0 is unused. Uint32Array
    // rather than Uint8ClampedArray, which saturated at 255 per position.
    const total = new Uint32Array(data.sequence.length + 1);
    const diseaseTotal = new Uint32Array(data.sequence.length + 1);

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
        values: toValues(total),
      },
      {
        name: 'disease causing variant',
        range,
        color: 'red',
        values: toValues(diseaseTotal),
      },
    ];
    return graphData;
  }
};
