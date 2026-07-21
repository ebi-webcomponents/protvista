/**
 * Built-in component names — the schema-layer source of truth for which
 * Nightingale component tags may appear as a config `component:` value
 * (or as the component a semantic `kind:` resolves to).
 *
 * This is a *pure-string* constant on purpose: the validator consults it
 * without pulling in any Nightingale / Mol* constructor, so editor
 * tooling and CI can run `validateConfig` standalone (see `load.ts`).
 * The actual constructors live in `src/built-in-components.ts`
 * (element layer) and are seeded into the runtime registry by the
 * element, never here.
 *
 * Only the five *renderable* (data) components are listed — the ones the
 * renderer's `getTrack()` can draw and that an author can therefore
 * select. The structural chrome tags (`nightingale-manager`,
 * `-navigation`, `-sequence`, `-filter`, `protvista-uniprot-structure`)
 * are emitted unconditionally by the element's own template and are not
 * config-selectable, so they are deliberately absent.
 *
 * Alignment with the `KnownComponentName` union in `types.ts` is
 * enforced by the compiler: the `satisfies Record<KnownComponentName,
 * true>` below fails to type-check if a union member is missing *or* if
 * a name here isn't in the union. (A bare `ReadonlySet<KnownComponentName>`
 * would only catch the second — a strict subset still type-checks — so
 * the keyed-object form is what makes an omission a build error rather
 * than a silent gap.) A drift-guard test separately asserts this set and
 * the renderable half of `built-in-components.ts` stay in lockstep.
 */

import type { KnownComponentName } from './types';

/**
 * Keyed by name so the `satisfies` below can demand exhaustiveness.
 * The values carry no meaning — only the key set is used.
 */
const RENDERABLE = {
  'nightingale-track-canvas': true,
  'nightingale-colored-sequence': true,
  'nightingale-variation-canvas': true,
  'nightingale-linegraph-track': true,
  'nightingale-sequence-heatmap': true,
} satisfies Record<KnownComponentName, true>;

export const RENDERABLE_COMPONENT_NAMES: ReadonlySet<KnownComponentName> =
  new Set(Object.keys(RENDERABLE) as KnownComponentName[]);
