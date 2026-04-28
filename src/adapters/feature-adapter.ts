import { renameProperties } from '../utils';
import formatTooltip from '../tooltips/feature-tooltip';

const transformData = (data) => {
  let transformedData = [];
  const { features } = data;
  if (features && features.length > 0) {
    transformedData = features.map((feature) => {
      return {
        ...feature,
        tooltipContent: formatTooltip(feature),
      };
    });
    transformedData = renameProperties(transformedData);
  }
  return transformedData;
};

export default transformData;
