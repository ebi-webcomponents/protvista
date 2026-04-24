/**
 * Thin facade over the two tooltip registries.
 *
 * External callers (and `load-data.ts`) should import `tooltipHelpers`
 * and `tooltipDefaults` from here rather than from the individual
 * files, so the split can be refactored without breaking import sites.
 *
 * Mirrors the existing pattern in `src/schema/registry.ts` (adapters,
 * kinds, themes) — same shape, different subject.
 */
export { tooltipHelpers } from './helpers';
export { tooltipDefaults } from './defaults';
