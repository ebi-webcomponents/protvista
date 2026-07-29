import type { AdapterFunction } from '../types.js';
import { renameProperties } from '../../utils/index.js';

type ProteomicsPtm = {
  name: string;
  position: number;
  sources: string[];
  dbReferences: unknown;
};

type ProteomicsFeature = {
  unique?: boolean;
  ptms?: ProteomicsPtm[];
  residuesToHighlight?: unknown;
  [key: string]: unknown;
};

type ProteomicsData = { features: ProteomicsFeature[]; length?: number };

const proteomicsTrackProperties = (feature: ProteomicsFeature) => ({
  category: 'PROTEOMICS',
  type: feature.unique ? 'unique' : 'non_unique',
});

export const proteomicsAdapter: AdapterFunction = (raw) => {
  const data = raw as ProteomicsData;
  let adaptedData: ProteomicsFeature[] = [];

  if (data && data.length !== 0) {
    adaptedData = data.features.map((feature) => {
      feature.residuesToHighlight = feature.ptms?.map((ptm) => ({
        name: ptm.name,
        position: ptm.position,
        sources: ptm.sources,
        dbReferences: ptm.dbReferences,
      }));
      return Object.assign(feature, proteomicsTrackProperties(feature));
    });

    adaptedData = renameProperties(adaptedData);
  }
  return adaptedData;
};
