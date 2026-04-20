/**
 * Thin facade over the three tooltip registries.
 *
 * External callers (and `load-data.ts`) should import `tooltipHelpers`,
 * `tooltipLinks`, and `tooltipDefaults` from here rather than from the
 * individual files, so the split can be refactored without breaking
 * import sites.
 *
 * Mirrors the existing pattern in `src/schema/registry.ts` (adapters,
 * kinds, transforms, themes) — same shape, different subject.
 */
export { tooltipHelpers } from './helpers';
export { tooltipLinks, expandLink } from './links';
export { tooltipDefaults } from './defaults';
