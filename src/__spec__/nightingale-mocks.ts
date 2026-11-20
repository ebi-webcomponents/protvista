/**
 * Global vitest mocks for every `@nightingale-elements/*` package plus
 * the `<protvista-uniprot-structure>` child component and the SVG icon
 * import. Wired via `setupFiles` in `vite.config.mjs` so every spec
 * gets the stubs before any spec runs.
 *
 * Why global: the nightingale packages pull in heavy runtime (d3, SVG
 * layout math, Mol* for the structure viewer). Specs that mount the
 * `<protvista-uniprot>` element rely on trivial `HTMLElement`
 * subclasses so the `@customElement` decorators register *something*
 * without actually executing Nightingale's canvas work. Other specs —
 * schema-layer tests that never reach for the element — simply don't
 * trigger the mocked modules' imports, so they pay zero cost.
 *
 * Previously these `vi.mock` calls lived at the top of each spec file
 * that mounted the element (`render-target.spec.ts`,
 * `set-track-data-integration.spec.ts`) as a byte-for-byte copy-paste
 * block. Centralising them here removes the duplication and the drift
 * risk that comes with it.
 *
 * If a future spec genuinely needs the *real* nightingale
 * implementation (integration / visual-regression test), that spec
 * can call `vi.unmock('@nightingale-elements/…')` locally to opt out.
 */
import { vi } from 'vitest';

vi.mock('@nightingale-elements/nightingale-manager', () => ({
  default: class extends HTMLElement {},
}));
vi.mock('@nightingale-elements/nightingale-navigation', () => ({
  default: class extends HTMLElement {},
}));
vi.mock('@nightingale-elements/nightingale-sequence', () => ({
  default: class extends HTMLElement {},
}));
vi.mock('@nightingale-elements/nightingale-colored-sequence', () => ({
  default: class extends HTMLElement {},
}));
vi.mock('@nightingale-elements/nightingale-track-canvas', () => ({
  default: class extends HTMLElement {},
}));
vi.mock('@nightingale-elements/nightingale-variation-canvas', () => ({
  default: class extends HTMLElement {},
  // Real (value) exports the app imports. Browser ESM links named
  // imports strictly, so these must exist even though the code paths
  // that read them aren't exercised by the mounting specs. (jsdom's
  // module runner tolerated their absence; a real browser does not.)
  AminoAcid: { Empty: '' },
  ClinicalSignificance: {},
}));
vi.mock('@nightingale-elements/nightingale-linegraph-track', () => ({
  default: class extends HTMLElement {},
}));
// The heatmap takes its cells through `setHeatmapData` and its colours
// through `heatmapInstance.setColor`, not `.data`. The stub records both, so
// a spec can read what each heatmap was handed (`heatmapCalls`) and the
// colour function it was given (`colorFn`).
vi.mock('@nightingale-elements/nightingale-sequence-heatmap', () => ({
  default: class extends HTMLElement {
    heatmapCalls: Array<{
      xDomain: number[];
      yDomain: string[];
      data: unknown[];
    }> = [];
    colorFn?: (d: { score: number }) => string;
    updateComplete = Promise.resolve(true);
    heatmapInstance = {
      setColor: (fn: (d: { score: number }) => string) => {
        this.colorFn = fn;
      },
    };
    setHeatmapData(xDomain: number[], yDomain: string[], data: unknown[]) {
      this.heatmapCalls.push({ xDomain, yDomain, data });
    }
  },
}));
vi.mock('@nightingale-elements/nightingale-filter', () => ({
  default: class extends HTMLElement {},
}));
// `<protvista-uniprot>` no longer imports this package by value (the
// heatmap's colours come from the track's `colorScale`). The stub stays so a
// spec whose module graph does reach it never pulls in Mol*. `default` is
// needed whenever the real `protvista-uniprot-structure` module loads (some
// specs unmock it, and in browser mode the module graph can be shared across
// spec files); without it the import fails with "does not provide an export
// named 'default'".
vi.mock('@nightingale-elements/nightingale-structure', () => ({
  default: class extends HTMLElement {},
  amColorScale: () => '#000000',
}));

// The structure sub-component pulls Mol* transitively. Stub it the
// same way; it's only referenced via
// `loadComponent('protvista-uniprot-structure', …)` and the
// large-group branch we don't exercise.
vi.mock('../protvista-uniprot-structure', () => ({
  default: class extends HTMLElement {},
}));

// SVG/CSS imports resolve via vite plugins. Vitest runs without those
// plugins configured; a trivial stub keeps the module graph loadable.
vi.mock('../icons/spinner.svg', () => ({ default: '' }));
