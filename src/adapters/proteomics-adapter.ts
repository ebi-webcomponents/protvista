import { renameProperties } from '../utils';
import formatTooltip from '../tooltips/feature-tooltip';

const proteomicsTrackProperties = (feature, taxId) => {
  return {
    category: 'PROTEOMICS',
    type: feature.unique ? 'unique' : 'non_unique',
    tooltipContent: formatTooltip(feature, taxId),
  };
};

const transformData = (data) => {
  let adaptedData = [];

  if (data && data.length !== 0) {
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

    adaptedData = renameProperties(adaptedData);
  }
  return adaptedData;
};

export default transformData;
