import { renameProperties } from '../utils';
import formatTooltip from '../tooltips/feature-tooltip';

const transformData = (data: { features?: Record<string, unknown>[] }) => {
  let transformedData: Record<string, unknown>[] = [];
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
