/**
 * Per-category render-target characterization test.
 *
 * Pins down the config → nightingale-custom-element mapping as it flows
 * through `<protvista-uniprot>`'s Lit template. This complements the
 * data-pipeline baseline (`load-data-baseline.spec.ts`) by covering the
 * *rendering surface* that snapshot deliberately does not touch.
 *
 * What this guards
 *   • `getTrack(component, layout, color, shape, id, scale, colorRange)`
 *     — each `KnownComponentName` must emit the exact nightingale
 *     element with the exact attribute set (tier 1).
 *   • The top-level shell (manager + navigation + sequence) plus one
 *     representative category per component renders the expected DOM
 *     when supplied with frozen `config` and `data` fixtures (tier 2).
 *
 * Why mount-with-frozen-data rather than a screenshot: the schema-driven
 * loader produces a `NormalizedConfig` that the renderer consumes
 * directly, and the fixtures below are hand-crafted `NormalizedConfig`
 * slices. If a future refactor renames a field or drops a cascade rule,
 * the exact attribute set flowing into Nightingale will shift and the
 * snapshot will surface the diff.
 *
 * The nightingale custom-element packages are `vi.mock`ed to trivial
 * `HTMLElement` subclasses so (a) importing this module is cheap,
 * (b) we never execute real nightingale rendering (which pulls in d3
 * and does SVG layout work we don't need), and (c) the snapshots
 * capture the attributes our template wrote, not whatever the real
 * element would subsequently mutate.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------- mock all nightingale packages ----------
// Each import is `import X from '@nightingale-elements/nightingale-X'` so
// the mock only needs to provide a `default` export that's a harmless
// custom-element constructor. `vi.mock` factories are hoisted to the
// top of the file, so `StubElement` must be constructed inside each
// factory rather than shared from a module-level binding.
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
vi.mock('@nightingale-elements/nightingale-interpro-track', () => ({
  default: class extends HTMLElement {},
}));
vi.mock('@nightingale-elements/nightingale-variation', () => ({
  default: class extends HTMLElement {},
}));
vi.mock('@nightingale-elements/nightingale-linegraph-track', () => ({
  default: class extends HTMLElement {},
}));
vi.mock('@nightingale-elements/nightingale-sequence-heatmap', () => ({
  default: class extends HTMLElement {},
}));
vi.mock('@nightingale-elements/nightingale-filter', () => ({
  default: class extends HTMLElement {},
}));
// `amColorScale` is only used in `_loadDataInComponents`, which we
// never invoke in these tests. A no-op stub is fine.
vi.mock('@nightingale-elements/nightingale-structure', () => ({
  amColorScale: () => '#000000',
}));

// The structure sub-component pulls Mol* transitively. Stub it the same
// way; it's only referenced via `loadComponent('protvista-uniprot-
// structure', …)` and in the large-category branch we don't exercise.
vi.mock('../protvista-uniprot-structure', () => ({
  default: class extends HTMLElement {},
}));

// These imports resolve to raw SVG/CSS strings via vite plugins; in a
// vitest run they'd otherwise need the plugins configured for the test
// pipeline. Returning a trivial stub keeps the module graph loadable.
vi.mock('../icons/spinner.svg', () => ({ default: '' }));

// `vi.mock` calls above are hoisted by vitest so these static imports
// resolve against the stubs, not the real nightingale packages.
import { render } from 'lit';
import type { KnownComponentName, RenderingOptions } from '../schema/types';
import type { NormalizedConfig } from '../schema/normalize';
// Side-effect import: loading `protvista-uniprot` runs the
// `@customElement('protvista-uniprot')` decorator, registering the
// element so `document.createElement('protvista-uniprot')` returns a
// real instance (not a generic HTMLElement). We never reference the
// default export directly — all instances come from
// `document.createElement` below.
import '../protvista-uniprot';

// Reference sequence length chosen to match `P05067` (Amyloid precursor
// protein), the accession used in the load-data baseline.
const SEQ_LEN = 770;
const SEQUENCE = 'M'.repeat(SEQ_LEN);

/**
 * Build a component instance with all render-relevant state populated.
 * Intentionally avoids `document.body.appendChild` so `connectedCallback`
 * (which would kick off `_init()` → `_loadData()`) never fires — we want
 * the render output as a pure function of the inputs we set.
 */
function buildInstance(overrides: Partial<Record<string, unknown>> = {}) {
  const el = document.createElement('protvista-uniprot') as any;
  el.sequence = SEQUENCE;
  el.hasData = true;
  el.loading = false;
  el.suspend = false;
  el.openCategories = [];
  el.displayCoordinates = { start: 1, end: SEQ_LEN };
  el.accession = 'P05067';
  el.data = {};
  el.rawData = {};
  Object.assign(el, overrides);
  return el;
}

// -------------------- Tier 1: getTrack() per component --------------------

const COMPONENT_NAMES: KnownComponentName[] = [
  'nightingale-track-canvas',
  'nightingale-interpro-track',
  'nightingale-variation',
  'nightingale-linegraph-track',
  'nightingale-colored-sequence',
  'nightingale-sequence-heatmap',
];

/**
 * Representative argument set; values are chosen to be obviously
 * synthetic so the snapshot reads unambiguously and any accidental
 * renaming / reordering of getTrack's positional params shows up loudly.
 */
const GET_TRACK_ARGS = {
  layout: 'non-overlapping',
  color: '#ff00aa',
  shape: 'rectangle',
  id: 'CATEGORY-track',
  scale: 'hydrophobicity',
  colorRange: 'red,green,blue',
} as const;

describe('getTrack() per component — config → nightingale attribute mapping', () => {
  let el: any;

  beforeEach(() => {
    el = buildInstance();
  });

  for (const component of COMPONENT_NAMES) {
    it(`${component} → stable attribute set`, () => {
      const template = el.getTrack(
        component,
        GET_TRACK_ARGS.layout,
        GET_TRACK_ARGS.color,
        GET_TRACK_ARGS.shape,
        GET_TRACK_ARGS.id,
        GET_TRACK_ARGS.scale,
        GET_TRACK_ARGS.colorRange
      );
      const target = document.createElement('div');
      render(template, target);
      expect(normalize(target.innerHTML)).toMatchSnapshot();
    });
  }

  it('returns undefined and warns for unknown component', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = el.getTrack('not-a-real-component' as KnownComponentName);
    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('No Matching ProtvistaTrack Found.');
    warn.mockRestore();
  });
});

// -------------------- Tier 2: full-component render per category --------------------

/**
 * Minimal `NormalizedConfig` slice — one category per component. This
 * keeps the snapshot focused on the config → DOM mapping without
 * dragging in the full 15-category, 65-track real config.
 *
 * Each category exercises a distinct branch of the render template:
 * aggregate track vs. expanded tracks; filter component vs. label-url
 * vs. help-page; color/shape inherited from category vs. overridden on
 * the track.
 *
 * The fixture is hand-built as the canonical `NormalizedConfig` the
 * renderer consumes — `rendering.*` is structured (not flat
 * `scale`/`color-range`), and category-level rendering is already
 * cascaded onto the tracks (matching `normalize`'s output) so the
 * renderer doesn't need a fallback chain at render time.
 */
// Cached category-level rendering blocks. Re-used via spread when
// building the per-track entries below (category rendering is already
// cascaded onto each track after normalize, so the renderer doesn't
// walk a fallback chain — the fixture mirrors that).
const CAT_CANVAS_RENDERING: RenderingOptions = {
  color: '#112233',
  shape: 'rectangle',
};
const CAT_COLORED_SEQ_RENDERING: RenderingOptions = {
  colorScale: {
    stops: [
      { value: 0, color: '#ffffff' },
      { value: 1, color: '#000000' },
    ],
  },
};

const testConfig: NormalizedConfig = {
  version: '1.0',
  sources: {},
  defaults: { rendering: {} },
  categories: [
    {
      id: 'CAT_CANVAS',
      label: 'Canvas category',
      component: 'nightingale-track-canvas',
      rendering: CAT_CANVAS_RENDERING,
      helpPage: 'canvas_help',
      tracks: [
        {
          id: 'canvas_track_A',
          label: 'Canvas Track A',
          component: 'nightingale-track-canvas',
          description: 'Canvas track tooltip',
          // Rendering is already cascaded: category rendering lives on
          // the track as well after normalize.
          rendering: { ...CAT_CANVAS_RENDERING },
          data: [
            {
              from: 'url',
              url: 'stub://A',
              adapter: 'uniprot-features-json',
            },
          ],
          helpPage: 'canvas_A_help',
        },
        {
          id: 'canvas_track_B',
          label: 'Canvas Track B (color overridden)',
          component: 'nightingale-track-canvas',
          description: 'Override tooltip',
          rendering: { color: '#445566', shape: 'circle' },
          data: [
            {
              from: 'url',
              url: 'stub://B',
              adapter: 'uniprot-features-json',
            },
          ],
        },
      ],
    },
    {
      id: 'CAT_LINEGRAPH',
      label: 'Linegraph category',
      component: 'nightingale-linegraph-track',
      rendering: {},
      tracks: [
        {
          id: 'linegraph_track',
          label: 'Linegraph Track',
          component: 'nightingale-linegraph-track',
          description: 'Linegraph tooltip',
          rendering: {},
          data: [
            {
              from: 'url',
              url: 'stub://linegraph',
              adapter: 'uniprot-variation-counts-json',
            },
          ],
        },
      ],
    },
    {
      id: 'CAT_VARIATION',
      label: 'Variation category',
      component: 'nightingale-linegraph-track',
      rendering: {},
      tracks: [
        {
          id: 'variation',
          label: 'variation',
          component: 'nightingale-variation',
          description: 'Variation tooltip',
          filterUI: 'nightingale-filter',
          rendering: {},
          data: [
            {
              from: 'url',
              url: 'stub://variation',
              adapter: 'uniprot-variation-json',
            },
          ],
        },
      ],
    },
    {
      id: 'CAT_COLORED_SEQ',
      label: 'Colored sequence category',
      component: 'nightingale-colored-sequence',
      rendering: CAT_COLORED_SEQ_RENDERING,
      tracks: [
        {
          id: 'colored_seq_track',
          label: 'Colored Sequence Track',
          labelUrl: 'https://example.com/{accession}',
          component: 'nightingale-colored-sequence',
          description: 'Colored sequence tooltip',
          rendering: { ...CAT_COLORED_SEQ_RENDERING },
          data: [
            {
              from: 'url',
              url: 'stub://colored',
              adapter: 'alphafold-prediction-json',
            },
          ],
        },
      ],
    },
    {
      id: 'CAT_HEATMAP',
      label: 'Heatmap category',
      component: 'nightingale-colored-sequence',
      rendering: {},
      tracks: [
        {
          id: 'heatmap_track',
          label: 'Heatmap Track',
          component: 'nightingale-sequence-heatmap',
          description: 'Heatmap tooltip',
          rendering: {},
          data: [
            {
              from: 'url',
              url: 'stub://heatmap',
              adapter: 'alphamissense-full-csv',
            },
          ],
        },
      ],
    },
    {
      id: 'CAT_INTERPRO',
      label: 'InterPro category',
      component: 'nightingale-track-canvas',
      rendering: {},
      tracks: [
        {
          id: 'interpro_track',
          label: 'InterPro Track',
          component: 'nightingale-interpro-track',
          description: 'InterPro tooltip',
          rendering: {},
          data: [
            {
              from: 'url',
              url: 'stub://interpro',
              adapter: 'interpro-entries-json',
            },
          ],
        },
      ],
    },
  ],
};

/**
 * Frozen data slice keyed by `${category.id}` and
 * `${category.id}-${track.id}`. The values are minimally plausible:
 * arrays are non-empty (so the expanded-track branch is rendered),
 * the variation entry has the shape the filter hookup expects, and
 * category aggregates are populated so the aggregate-track branch also
 * renders.
 */
const testData: Record<string, unknown> = {
  CAT_CANVAS: [{ type: 'DOMAIN', start: 1, end: 100 }],
  'CAT_CANVAS-canvas_track_A': [{ type: 'DOMAIN', start: 1, end: 50 }],
  'CAT_CANVAS-canvas_track_B': [{ type: 'REGION', start: 60, end: 80 }],
  CAT_LINEGRAPH: [{ values: [1, 2, 3] }],
  'CAT_LINEGRAPH-linegraph_track': [{ values: [1, 2, 3] }],
  CAT_VARIATION: { sequence: SEQUENCE, variants: [] },
  'CAT_VARIATION-variation': { sequence: SEQUENCE, variants: [] },
  CAT_COLORED_SEQ: [{ values: [0.5, 0.9] }],
  'CAT_COLORED_SEQ-colored_seq_track': [{ values: [0.5, 0.9] }],
  CAT_HEATMAP: [{ values: [] }],
  'CAT_HEATMAP-heatmap_track': [{ values: [] }],
  CAT_INTERPRO: [{ accession: 'IPR000001', start: 1, end: 100 }],
  'CAT_INTERPRO-interpro_track': [{ accession: 'IPR000001', start: 1, end: 100 }],
};

describe('full render — shell + per-category DOM with frozen fixtures', () => {
  let el: any;
  let target: HTMLDivElement;

  beforeEach(() => {
    el = buildInstance({
      config: testConfig,
      data: testData,
      // Expand every category so the track-level render branch is
      // exercised for each component.
      openCategories: testConfig.categories.map((c) => c.id),
    });
    target = document.createElement('div');
    render(el.render(), target);
  });

  it('renders the top-level shell (manager + navigation + sequence)', () => {
    const manager = target.querySelector('nightingale-manager');
    const navigation = target.querySelector('nightingale-navigation');
    const sequence = target.querySelector('nightingale-sequence');
    expect(manager).not.toBeNull();
    expect(navigation?.getAttribute('length')).toBe(String(SEQ_LEN));
    expect(sequence?.getAttribute('length')).toBe(String(SEQ_LEN));
    expect(sequence?.getAttribute('sequence')).toBe(SEQUENCE);
  });

  it('renders one category block per category in config order', () => {
    const categoryDivs = target.querySelectorAll('div.category');
    expect(
      Array.from(categoryDivs).map((d) => d.getAttribute('id'))
    ).toEqual(testConfig.categories.map((c) => `category_${c.id}`));
  });

  for (const category of testConfig.categories) {
    it(`category ${category.id} — stable DOM snapshot`, () => {
      const div = target.querySelector(`#category_${category.id}`);
      expect(div).not.toBeNull();
      // Collect the category div plus its expanded-track siblings. Lit
      // emits each expanded track as a top-level sibling of the
      // category div (see `render()` in protvista-uniprot.ts), so we
      // walk `nextElementSibling` until we either run out or hit
      // something that isn't part of this category's block (a new
      // category div, or the trailing nav-container / structure block
      // after the last category).
      const collected: string[] = [];
      let cursor: Element | null = div;
      while (cursor) {
        collected.push(cursor.outerHTML);
        const next = cursor.nextElementSibling;
        if (!next) break;
        const isOwnExpandedTrack = next.classList.contains('category__track');
        if (!isOwnExpandedTrack) break;
        cursor = next;
      }
      expect(normalize(collected.join('\n'))).toMatchSnapshot();
    });
  }

  it('does not render expanded tracks for closed categories', () => {
    // Rebuild with no open categories; the expanded `.category__track`
    // divs must disappear while `.category` blocks remain.
    const closed = buildInstance({
      config: testConfig,
      data: testData,
      openCategories: [],
    });
    const closedTarget = document.createElement('div');
    render(closed.render(), closedTarget);
    expect(closedTarget.querySelectorAll('.category').length).toBe(
      testConfig.categories.length
    );
    expect(closedTarget.querySelectorAll('.category__track').length).toBe(0);
  });

  it('renders the no-results placeholder when hasData=false', () => {
    const none = buildInstance({
      config: testConfig,
      data: {},
      hasData: false,
      loading: false,
    });
    const noneTarget = document.createElement('div');
    render(none.render(), noneTarget);
    expect(noneTarget.querySelector('.protvista-no-results')).not.toBeNull();
    expect(noneTarget.querySelector('nightingale-manager')).toBeNull();
  });

  it('renders the loader when loading=true', () => {
    const loading = buildInstance({
      config: testConfig,
      data: {},
      loading: true,
    });
    const loadingTarget = document.createElement('div');
    render(loading.render(), loadingTarget);
    expect(loadingTarget.querySelector('.protvista-loader')).not.toBeNull();
  });

  it('renders an empty template when suspend=true', () => {
    const suspended = buildInstance({
      config: testConfig,
      data: testData,
      suspend: true,
    });
    const suspendedTarget = document.createElement('div');
    render(suspended.render(), suspendedTarget);
    // Lit's html`` still produces one comment marker; what matters is
    // that no nightingale / category DOM is emitted.
    expect(suspendedTarget.querySelector('nightingale-manager')).toBeNull();
    expect(suspendedTarget.querySelector('.category')).toBeNull();
    expect(suspendedTarget.querySelector('.protvista-no-results')).toBeNull();
  });
});

/**
 * Lit's html renderer inserts comment markers (`<!---->`, `<!--?lit$…-->`)
 * into the output. Those markers contain random numeric IDs that change
 * between vitest runs, so we strip them before snapshotting to keep the
 * snapshots deterministic.
 */
function normalize(html: string): string {
  return html
    .replace(/<!--\?lit\$\d+\$-->/g, '')
    .replace(/<!--\?-->/g, '')
    .replace(/<!---->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
