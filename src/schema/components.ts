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
 * Keep this set aligned by hand with the `KnownComponentName` union in
 * `types.ts` — the `ReadonlySet<KnownComponentName>` annotation rejects
 * an extra or misspelled name but does *not* force every union member to
 * appear (a strict subset still type-checks), so a name added to the
 * union but omitted here would slip through. A drift-guard test does
 * assert this set and the renderable half of `built-in-components.ts`
 * stay in lockstep.
 */

import type { KnownComponentName } from './types';

export const RENDERABLE_COMPONENT_NAMES: ReadonlySet<KnownComponentName> =
  new Set<KnownComponentName>([
    'nightingale-track-canvas',
    'nightingale-colored-sequence',
    'nightingale-variation-canvas',
    'nightingale-linegraph-track',
    'nightingale-sequence-heatmap',
  ]);
