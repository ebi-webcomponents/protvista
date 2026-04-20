import { renameProperties } from '../utils';

const transformData = (data) => {
  let transformedData = [];
  const { features } = data;
  if (features && features.length > 0) {
    transformedData = features.map((feature) => ({ ...feature }));
    transformedData = renameProperties(transformedData);
  }
  return transformedData;
};

export default transformData;
