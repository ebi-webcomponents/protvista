export { default as filterConfig, colorConfig } from './filter-config';
export {
  validateConfig,
  formatConfigErrors,
  TRACK_TYPES,
  ADAPTERS,
} from './config-validator';
export type {
  ConfigValidationError,
  ConfigValidationResult,
} from './config-validator';
export type { ProtvistaConfig, ProtvistaTrackConfig } from './config';
export { default as getFeatureTooltip } from './tooltips/feature-tooltip';
export { default as getStructureTooltip } from './tooltips/structure-tooltip';
export { default as getVariationTooltip } from './tooltips/variation-tooltip';
export { default as ProtvistaUniprotStructure } from './protvista-uniprot-structure';
export type { ProcessedStructureData } from './protvista-uniprot-structure';
import ProtvistaUniprot from './protvista-uniprot';
export default ProtvistaUniprot;
