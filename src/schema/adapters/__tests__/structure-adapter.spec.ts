import { describe, it, expect } from 'vitest';

import {
  getAllFeatureStructures,
  mergeOverlappingIntervals,
} from '../structure-adapter';

import entryData from './__mocks__/uniprotkb-entry-data';

describe('structure data', () => {
  it('should turn structures into features', () => {
    const features = getAllFeatureStructures(entryData);
    expect(features).toMatchSnapshot();
  });

  it('should merge Overlapping Intervals', () => {
    const features = getAllFeatureStructures(entryData);
    const overlapping = mergeOverlappingIntervals(features);
    expect(overlapping).toMatchSnapshot();
  });
});
