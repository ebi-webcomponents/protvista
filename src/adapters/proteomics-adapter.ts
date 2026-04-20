import { renameProperties } from '../utils';
import formatTooltip from '../tooltips/feature-tooltip';

type ProteomicsFeature = {
  unique: boolean;
  ptms?: { name: string; position: number; sources: string[]; dbReferences: unknown[] }[];
  residuesToHighlight?: unknown[];
  [key: string]: unknown;
};

type ProteomicsData = {
  features: ProteomicsFeature[];
  taxid: number;
};

const proteomicsTrackProperties = (feature: ProteomicsFeature, taxId: number) => {
  return {
    category: 'PROTEOMICS',
    type: feature.unique ? 'unique' : 'non_unique',
    tooltipContent: formatTooltip(feature as unknown as Parameters<typeof formatTooltip>[0], String(taxId)),
  };
};

const transformData = (data: ProteomicsData) => {
  let adaptedData: (ProteomicsFeature & { start?: number })[] = [];

  if (data && data.features && data.features.length !== 0) {
    adaptedData = data.features.map((feature) => {
      feature.residuesToHighlight = feature.ptms?.map((ptm) => ({
        name: ptm.name,
        position: ptm.position,
        sources: ptm.sources,
        dbReferences: ptm.dbReferences,
      }));
      return Object.assign(
        feature,
        proteomicsTrackProperties(feature, data.taxid)
      );
    });

    adaptedData = renameProperties(adaptedData) as typeof adaptedData;
  }
  return adaptedData;
};

export default transformData;
