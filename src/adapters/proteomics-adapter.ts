import { renameProperties } from '../utils';

const proteomicsTrackProperties = (feature) => ({
  category: 'PROTEOMICS',
  type: feature.unique ? 'unique' : 'non_unique',
});

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
      return Object.assign(feature, proteomicsTrackProperties(feature));
    });

    adaptedData = renameProperties(adaptedData);
  }
  return adaptedData;
};

export default transformData;
