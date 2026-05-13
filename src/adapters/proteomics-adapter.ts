import { renameProperties } from '../utils';
import formatTooltip, { TooltipFeature } from '../tooltips/feature-tooltip';

type ProteomicsFeature = TooltipFeature & {
  unique: boolean;
  ptms?: { name: string; position: number; sources: string[]; dbReferences: { id: string; properties: Record<string, string> }[] }[];
};

type ProteomicsData = {
  features: ProteomicsFeature[];
  taxid: number;
};

const proteomicsTrackProperties = (feature: ProteomicsFeature, taxId: number) => {
  return {
    category: 'PROTEOMICS',
    type: feature.unique ? 'unique' : 'non_unique',
    tooltipContent: formatTooltip(feature, String(taxId)),
  };
};

const transformData = (data: ProteomicsData) => {
  let adaptedData: ProteomicsFeature[] = [];

  if (data && data.features && data.features.length !== 0) {
    // Rename `begin` to `start` first so formatTooltip (called inside
    // proteomicsTrackProperties) can read the unified field name.
    const renamed = renameProperties(data.features) as ProteomicsFeature[];
    adaptedData = renamed.map((feature) => {
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
  }
  return adaptedData;
};

export default transformData;
