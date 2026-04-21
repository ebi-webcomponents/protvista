import { describe, test, expect } from 'vitest';

import {
  colorConfig,
  getFilteredVariants,
  VariantsForFilter,
} from '../filter-config';
import { TransformedVariant } from '../adapters/variation-adapter';

const makeVariant = (overrides: Partial<TransformedVariant>): TransformedVariant =>
  ({
    accession: 'A',
    variant: 'A',
    start: 1,
    xrefNames: [],
    hasPredictions: false,
    consequenceType: 'missense',
    type: 'VARIANT',
    begin: '1',
    end: '1',
    xrefs: [],
    cytogeneticBand: '',
    locations: [],
    somaticStatus: 0,
    sourceType: 'uniprot',
    wildType: 'A',
    ...overrides,
  } as TransformedVariant);

const transformedVariantPositions: VariantsForFilter = [
  {
    variants: [
      makeVariant({
        accession: 'A',
        begin: '1',
        end: '1',
        start: 1,
        variant: 'V',
        clinicalSignificances: [
          {
            type: 'Variant of uncertain significance' as never,
            sources: [],
          },
        ],
      }),
      makeVariant({
        accession: 'B',
        begin: '1',
        end: '1',
        start: 1,
        variant: 'D',
      }),
    ],
  },
  {
    variants: [
      makeVariant({
        accession: 'C',
        begin: '2',
        end: '2',
        start: 2,
        variant: 'V',
      }),
    ],
  },
  {
    variants: [
      makeVariant({
        accession: 'D',
        begin: '3',
        end: '3',
        start: 3,
        variant: 'V',
      }),
    ],
  },
];

describe('Variation filter config', () => {
  test('it should filter according to the callback function', () => {
    const filteredVariants = getFilteredVariants(
      transformedVariantPositions,
      (variant) => variant.accession === 'A'
    );
    expect(filteredVariants).toEqual([
      { variants: [transformedVariantPositions[0].variants[0]] },
      { variants: [] },
      { variants: [] },
    ]);
  });

  test('it should get the right colour for disease', () => {
    const result = colorConfig(transformedVariantPositions[0].variants[0]);
    expect(result).toEqual('#009e73');
  });

  test('it should get the right colour for non disease', () => {
    const result = colorConfig(transformedVariantPositions[0].variants[1]);
    expect(result).toEqual('#009e73');
  });

  test('it should get the right colour for other', () => {
    const result = colorConfig(transformedVariantPositions[1].variants[0]);
    expect(result).toEqual('#009e73');
  });

  test('it should get the right colour for predicted', () => {
    const result = colorConfig(transformedVariantPositions[2].variants[0]);
    expect(result).toEqual('#009e73');
  });
});
