/**
 * Built-in component table — the single home for the custom-element
 * constructors ProtVista ships with, and the seam through which they
 * reach the runtime registry.
 *
 * This is the *only* module that statically imports the Nightingale /
 * Mol* element constructors. The schema layer (registry, validator)
 * never does, so `validateConfig` / `createRegistry` stay runnable
 * standalone (see `schema/load.ts`) — that is the boundary this module
 * exists to hold. Note it buys nothing for anyone importing
 * `<protvista-uniprot>` itself: the element imports this module
 * statically, so the constructors are in every viewer bundle. The win is
 * for schema-layer-only consumers (editor tooling, CI config linters),
 * which reach `validateConfig` without pulling in a single element.
 *
 * Two groups:
 *
 *   - `RENDERABLE_COMPONENTS` — the data components an author can select
 *     from a config `component:` field (or via a semantic `kind:`).
 *     These are seeded into the registry's `components` bucket by
 *     `registerBuiltinComponents()`, so a config-driven walk can look up
 *     each ctor by name and `customElements.define()` it. Their names
 *     mirror `RENDERABLE_COMPONENT_NAMES` in `schema/components.ts`.
 *
 *   - `STRUCTURAL_COMPONENTS` — the chrome tags the element's template
 *     always emits (`nightingale-manager`, `-navigation`, `-sequence`,
 *     `-filter`) plus the structure viewer. These are NOT config-
 *     selectable and NOT consumer-overridable, so they stay out of the
 *     config-facing registry bucket (keeping validation strict) and are
 *     registered directly by the element.
 */

import NightingaleManager from '@nightingale-elements/nightingale-manager';
import NightingaleNavigation from '@nightingale-elements/nightingale-navigation';
import NightingaleSequence from '@nightingale-elements/nightingale-sequence';
import NightingaleColoredSequence from '@nightingale-elements/nightingale-colored-sequence';
import NightingaleTrackCanvas from '@nightingale-elements/nightingale-track-canvas';
import NightingaleVariationCanvas from '@nightingale-elements/nightingale-variation-canvas';
import NightingaleLinegraphTrack from '@nightingale-elements/nightingale-linegraph-track';
import NightingaleSequenceHeatmap from '@nightingale-elements/nightingale-sequence-heatmap';
import NightingaleFilter from '@nightingale-elements/nightingale-filter';

import ProtvistaUniprotStructure from './protvista-uniprot-structure.js';

import type { Registry } from './schema/registry.js';
import type { KnownComponentName } from './schema/types.js';

/**
 * Data components an author selects (directly or via a semantic kind).
 * Seeded into the registry; the config-driven walk resolves each name to
 * one of these constructors.
 */
export const RENDERABLE_COMPONENTS: ReadonlyArray<
  readonly [KnownComponentName, CustomElementConstructor]
> = [
  ['nightingale-track-canvas', NightingaleTrackCanvas],
  ['nightingale-colored-sequence', NightingaleColoredSequence],
  ['nightingale-variation-canvas', NightingaleVariationCanvas],
  ['nightingale-linegraph-track', NightingaleLinegraphTrack],
  ['nightingale-sequence-heatmap', NightingaleSequenceHeatmap],
];

/**
 * Structural chrome the element's template emits unconditionally. Not
 * config-selectable, so registered directly (not through the registry).
 */
export const STRUCTURAL_COMPONENTS: ReadonlyArray<
  readonly [string, CustomElementConstructor]
> = [
  ['nightingale-manager', NightingaleManager],
  ['nightingale-navigation', NightingaleNavigation],
  ['nightingale-sequence', NightingaleSequence],
  ['nightingale-filter', NightingaleFilter],
  ['protvista-uniprot-structure', ProtvistaUniprotStructure],
];

/**
 * Seed every built-in *renderable* component into `registry`'s
 * `components` bucket. Called by the element at construction so a
 * config that names one resolves to a constructor without consumer-side
 * registration. Mirrors `registerBuiltinAdapters`.
 *
 * Not idempotent: a second call re-registers each name and throws
 * `RegistryCollisionError` (components have no override path).
 *
 * @throws if `RENDERABLE_COMPONENTS` names a component twice — a library
 *   defect, not a consumer error.
 */
export function registerBuiltinComponents(registry: Registry): void {
  // Guard the table against copy-paste duplicates, so a doubled row
  // surfaces as a named defect rather than an opaque collision thrown
  // from inside the element's constructor.
  const seen = new Set<string>();
  for (const [name] of RENDERABLE_COMPONENTS) {
    if (seen.has(name)) {
      throw new Error(
        `RENDERABLE_COMPONENTS (src/built-in-components) registers '${name}' ` +
          `more than once. Each built-in component must appear exactly once — ` +
          `remove the duplicate entry.`
      );
    }
    seen.add(name);
  }

  for (const [name, ctor] of RENDERABLE_COMPONENTS) {
    registry.registerComponent(name, ctor);
  }
}
