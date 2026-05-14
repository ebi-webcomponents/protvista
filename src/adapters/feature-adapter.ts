import { renameProperties } from '../utils';
import formatTooltip from '../tooltips/feature-tooltip';

const transformData = (data: { features?: Record<string, unknown>[] }) => {
  let transformedData: Record<string, unknown>[] = [];
  const { features } = data;
  if (features && features.length > 0) {
    // Rename `begin` to `start` first so formatTooltip can read the unified
    // field name regardless of the upstream wire format.
    const renamed = renameProperties(features);
    transformedData = renamed.map((feature) => ({
      ...feature,
      tooltipContent: formatTooltip(feature),
    }));
  }
  return transformedData;
};

export default transformData;
