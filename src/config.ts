/**
 * Side-effect-free entry point for the variant filter / colour config,
 * published as the `protvista-uniprot/config` subpath.
 *
 * Importing from the package root (`protvista-uniprot`) evaluates the
 * self-registering `<protvista-uniprot>` element: a global side effect
 * (`customElements.define`) that a bundler must retain, so it drags the whole
 * viewer bundle — Lit, every Nightingale track, Mol* — in with it. Consumers
 * that only need the pure `filterConfig` / `colorConfig` data import them from
 * here instead, and a bundler can shake the element and its deps away.
 *
 * The purity of this path is not incidental: `filter-config.ts` imports
 * nothing at runtime, and `src/__spec__/config-subpath-purity.spec.ts` walks
 * this module's static import graph and fails if it ever reaches a
 * custom-element registration. Keep this file a re-export of pure modules only
 * — do not add an import that pulls an element in.
 */
// The same config surface the package root exposes (see src/index.ts), just
// reachable without the element. Keep these two in step with the root's
// re-export so a consumer can move an import between the two specifiers
// unchanged.
export { default as filterConfig, colorConfig } from './filter-config.js';
