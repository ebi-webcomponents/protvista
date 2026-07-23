import type { AdapterFunction } from '../types';
import { RnaEditing } from './types/rna-editing';

export const rnaEditingGraphAdapter: AdapterFunction = (raw) => {
  const data = raw as RnaEditing;
  if (data.sequence && data.features.length) {
    const total = new Uint8ClampedArray(data.sequence.length);
    const missense = new Uint8ClampedArray(data.sequence.length);
    const synonymous = new Uint8ClampedArray(data.sequence.length);
    for (const feature of data.features) {
      const index = +feature.locationType.position.position;
      const consequence = feature.variantType.consequenceType;
      if (index >= 0 && index <= data.sequence.length) {
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
        values: [...missense].map((value, index) => ({
          position: index,
          value: value,
        })),
      },
      // TODO: at present the data contains only missense
      // {
      //   name: 'synonymous',
      //   range,
      //   color: 'red',
      //   values: [...synonymous].map((value, index) => ({
      //     position: index,
      //     value: value,
      //   })),
      // },
    ];
    return graphData;
  }
};
