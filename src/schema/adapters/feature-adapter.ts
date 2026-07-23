import type { AdapterFunction } from '../types';
import { renameProperties } from '../../utils';

type FeatureData = { features?: Array<Record<string, unknown>> };

export const featureAdapter: AdapterFunction = (raw) => {
  let transformedData: Array<Record<string, unknown>> = [];
  const { features } = (raw ?? {}) as FeatureData;
  if (features && features.length > 0) {
    transformedData = features.map((feature) => ({ ...feature }));
    transformedData = renameProperties(transformedData);
  }
  return transformedData;
};
