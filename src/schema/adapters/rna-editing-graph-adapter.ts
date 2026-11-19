import type { AdapterFunction } from '../types.js';
import { RnaEditing } from './types/rna-editing.js';

/** One `{ position, value }` per residue, 1..sequence.length (skips slot 0). */
const toValues = (counts: Uint32Array) =>
  Array.from(counts.subarray(1), (value, index) => ({
    position: index + 1,
    value,
  }));

export const rnaEditingGraphAdapter: AdapterFunction = (raw) => {
  const data = raw as RnaEditing;
  if (data.sequence && data.features.length) {
    // Indexed by 1-based residue position, so slot 0 is unused. Uint32Array
    // rather than Uint8ClampedArray, which saturated at 255 per position.
    const total = new Uint32Array(data.sequence.length + 1);
    const missense = new Uint32Array(data.sequence.length + 1);
    const synonymous = new Uint32Array(data.sequence.length + 1);
    for (const feature of data.features) {
      const index = +feature.locationType.position.position;
      const consequence = feature.variantType.consequenceType;
      if (index >= 1 && index <= data.sequence.length) {
        total[index] += 1;
        if (consequence === 'missense') {
          missense[index] += 1;
        } else if (consequence === 'synonymous') {
          // TODO: at present the data contains only missense
          synonymous[index] += 1;
        }
      }
    }

    const range = [0, Math.max(...total)];
    const graphData = [
      {
        name: 'missense',
        range,
        color: 'darkgrey',
        values: toValues(missense),
      },
      // TODO: at present the data contains only missense
      // {
      //   name: 'synonymous',
      //   range,
      //   color: 'red',
      //   values: toValues(synonymous),
      // },
    ];
    return graphData;
  }
};
