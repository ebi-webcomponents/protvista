/**
 * Per-group render-target characterization test.
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
 *     representative group per component renders the expected DOM
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

// `vi.mock` calls for every `@nightingale-elements/*` module + the
// structure sub-component + the SVG icon import are registered
// globally via `src/__spec__/nightingale-mocks.ts`, wired through
// `setupFiles` in `vite.config.mjs`. Static imports below therefore
// resolve against the stubs.
import { render } from 'lit';
import type { KnownComponentName, RenderingOptions } from '../schema/types';
import type { NormalizedConfig } from '../schema/normalize';
import { CSS_PREFIX } from '../styles/css-prefix';
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
  el.openGroups = [];
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
  'nightingale-variation-canvas',
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
  id: 'GROUP-track',
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

// -------------------- Tier 2: full-component render per group --------------------

/**
 * Minimal `NormalizedConfig` slice — one group per component. This
 * keeps the snapshot focused on the config → DOM mapping without
 * dragging in the full 15-group, 65-track real config.
 *
 * Each group exercises a distinct branch of the render template:
 * aggregate track vs. expanded tracks; filter component vs. Markdoc
 * label (a `{% help %}` span or an inline link); color/shape inherited
 * from group vs. overridden on the track.
 *
 * The fixture is hand-built as the canonical `NormalizedConfig` the
 * renderer consumes — `rendering.*` is structured (not flat
 * `scale`/`color-range`), and group-level rendering is already
 * cascaded onto the tracks (matching `normalize`'s output) so the
 * renderer doesn't need a fallback chain at render time.
 */
// Cached group-level rendering blocks. Re-used via spread when
// building the per-track entries below (group rendering is already
// cascaded onto each track after normalize, so the renderer doesn't
// walk a fallback chain — the fixture mirrors that).
const GROUP_CANVAS_RENDERING: RenderingOptions = {
  color: '#112233',
  shape: 'rectangle',
};
const GROUP_COLORED_SEQ_RENDERING: RenderingOptions = {
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
  groups: [
    {
      id: 'GROUP_CANVAS',
      label: '{% help slug="canvas_help" %}Canvas group{% /help %}',
      component: 'nightingale-track-canvas',
      rendering: GROUP_CANVAS_RENDERING,
      tracks: [
        {
          id: 'canvas_track_A',
          label: '{% help slug="canvas_A_help" %}Canvas Track A{% /help %}',
          component: 'nightingale-track-canvas',
          description: 'Canvas track tooltip',
          // Rendering is already cascaded: group rendering lives on
          // the track as well after normalize.
          rendering: { ...GROUP_CANVAS_RENDERING },
          data: [
            {
              from: 'url',
              url: 'stub://A',
              adapter: 'uniprot-features-json',
            },
          ],
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
      id: 'GROUP_LINEGRAPH',
      label: 'Linegraph group',
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
      id: 'GROUP_VARIATION',
      label: 'Variation group',
      component: 'nightingale-linegraph-track',
      rendering: {},
      tracks: [
        {
          id: 'variation',
          label: 'variation',
          component: 'nightingale-variation-canvas',
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
      id: 'GROUP_COLORED_SEQ',
      label: 'Colored sequence group',
      component: 'nightingale-colored-sequence',
      rendering: GROUP_COLORED_SEQ_RENDERING,
      tracks: [
        {
          id: 'colored_seq_track',
          label:
            '[Colored Sequence Track](https://example.com/{accession})',
          component: 'nightingale-colored-sequence',
          description: 'Colored sequence tooltip',
          rendering: { ...GROUP_COLORED_SEQ_RENDERING },
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
      id: 'GROUP_HEATMAP',
      label: 'Heatmap group',
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
  ],
};

/**
 * Frozen data slice keyed by `${group.id}` and
 * `${group.id}-${track.id}`. The values are minimally plausible:
 * arrays are non-empty (so the expanded-track branch is rendered),
 * the variation entry has the shape the filter hookup expects, and
 * group aggregates are populated so the aggregate-track branch also
 * renders.
 */
const testData: Record<string, unknown> = {
  GROUP_CANVAS: [{ type: 'DOMAIN', start: 1, end: 100 }],
  'GROUP_CANVAS-canvas_track_A': [{ type: 'DOMAIN', start: 1, end: 50 }],
  'GROUP_CANVAS-canvas_track_B': [{ type: 'REGION', start: 60, end: 80 }],
  GROUP_LINEGRAPH: [{ values: [1, 2, 3] }],
  'GROUP_LINEGRAPH-linegraph_track': [{ values: [1, 2, 3] }],
  GROUP_VARIATION: { sequence: SEQUENCE, variants: [] },
  'GROUP_VARIATION-variation': { sequence: SEQUENCE, variants: [] },
  GROUP_COLORED_SEQ: [{ values: [0.5, 0.9] }],
  'GROUP_COLORED_SEQ-colored_seq_track': [{ values: [0.5, 0.9] }],
  GROUP_HEATMAP: [{ values: [] }],
  'GROUP_HEATMAP-heatmap_track': [{ values: [] }],
};

describe('full render — shell + per-group DOM with frozen fixtures', () => {
  let el: any;
  let target: HTMLDivElement;

  beforeEach(() => {
    el = buildInstance({
      config: testConfig,
      data: testData,
      // Expand every group so the track-level render branch is
      // exercised for each component.
      openGroups: testConfig.groups.map((c) => c.id),
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

  it('renders one group block per group in config order', () => {
    const groupDivs = target.querySelectorAll(`div.${CSS_PREFIX}-group`);
    expect(
      Array.from(groupDivs).map((d) => d.getAttribute('id'))
    ).toEqual(testConfig.groups.map((c) => `${CSS_PREFIX}-group_${c.id}`));
  });

  for (const group of testConfig.groups) {
    it(`group ${group.id} — stable DOM snapshot`, () => {
      const div = target.querySelector(`#${CSS_PREFIX}-group_${group.id}`);
      expect(div).not.toBeNull();
      // Collect the group div plus its expanded-track siblings. Lit
      // emits each expanded track as a top-level sibling of the
      // group div (see `render()` in protvista-uniprot.ts), so we
      // walk `nextElementSibling` until we either run out or hit
      // something that isn't part of this group's block (a new
      // group div, or the trailing nav-container / structure block
      // after the last group).
      const collected: string[] = [];
      let cursor: Element | null = div;
      while (cursor) {
        collected.push(cursor.outerHTML);
        const next = cursor.nextElementSibling;
        if (!next) break;
        const isOwnExpandedTrack = next.classList.contains(
          `${CSS_PREFIX}-group__track`
        );
        if (!isOwnExpandedTrack) break;
        cursor = next;
      }
      expect(normalize(collected.join('\n'))).toMatchSnapshot();
    });
  }

  it('does not render expanded tracks for closed groups', () => {
    // Rebuild with no open groups; the expanded `${CSS_PREFIX}-group__track`
    // divs must disappear while `${CSS_PREFIX}-group` blocks remain.
    const closed = buildInstance({
      config: testConfig,
      data: testData,
      openGroups: [],
    });
    const closedTarget = document.createElement('div');
    render(closed.render(), closedTarget);
    expect(closedTarget.querySelectorAll(`.${CSS_PREFIX}-group`).length).toBe(
      testConfig.groups.length
    );
    expect(
      closedTarget.querySelectorAll(`.${CSS_PREFIX}-group__track`).length
    ).toBe(0);
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
    // that no nightingale / group DOM is emitted.
    expect(suspendedTarget.querySelector('nightingale-manager')).toBeNull();
    expect(suspendedTarget.querySelector(`.${CSS_PREFIX}-group`)).toBeNull();
    expect(suspendedTarget.querySelector('.protvista-no-results')).toBeNull();
  });
});

// -------------------- Standalone top-level tracks --------------------

/**
 * A standalone track is a top-level entry the normalizer wrapped in a
 * synthetic single-track group flagged `standalone`. The renderer must
 * draw it as one row with a plain (non-clickable) track label and no
 * group-collapse toggle, regardless of `openGroups`.
 */
const standaloneConfig: NormalizedConfig = {
  version: '1.0',
  sources: {},
  defaults: { rendering: {} },
  groups: [
    {
      id: 'signal_peptide',
      label: 'Signal peptide',
      component: 'nightingale-track-canvas',
      rendering: {},
      tracks: [
        {
          id: 'signal_peptide',
          label: 'Signal peptide',
          component: 'nightingale-track-canvas',
          description: 'N-terminal signal peptide',
          filter: 'SIGNAL',
          rendering: {},
          data: [
            { from: 'url', url: 'stub://sig', adapter: 'uniprot-features-json' },
          ],
        },
      ],
      standalone: true,
    },
    {
      id: 'DOMAINS',
      label: 'Domains',
      component: 'nightingale-track-canvas',
      rendering: {},
      tracks: [
        {
          id: 'domain',
          label: 'Domain',
          component: 'nightingale-track-canvas',
          rendering: {},
          data: [
            { from: 'url', url: 'stub://dom', adapter: 'uniprot-features-json' },
          ],
        },
      ],
    },
  ],
};

const standaloneData: Record<string, unknown> = {
  signal_peptide: [{ type: 'SIGNAL', start: 1, end: 20 }],
  'signal_peptide-signal_peptide': [{ type: 'SIGNAL', start: 1, end: 20 }],
  DOMAINS: [{ type: 'DOMAIN', start: 30, end: 90 }],
  'DOMAINS-domain': [{ type: 'DOMAIN', start: 30, end: 90 }],
};

describe('full render — standalone top-level tracks', () => {
  let target: HTMLDivElement;

  beforeEach(() => {
    // Crucially: openGroups is empty. The standalone row must still
    // render; the genuine group's child tracks must not.
    const el = buildInstance({
      config: standaloneConfig,
      data: standaloneData,
      openGroups: [],
    });
    target = document.createElement('div');
    render(el.render(), target);
  });

  it('renders the standalone entry as a single row with no collapse toggle', () => {
    const standalone = target.querySelector(
      `#${CSS_PREFIX}-group_signal_peptide`
    );
    expect(standalone).not.toBeNull();
    expect(
      standalone!.classList.contains(`${CSS_PREFIX}-group--standalone`)
    ).toBe(true);
    // No clickable group-label (collapse affordance) inside it.
    expect(standalone!.querySelector(`.${CSS_PREFIX}-group-label`)).toBeNull();
    // It carries a plain track label and the track element.
    expect(
      standalone!.querySelector(`.${CSS_PREFIX}-track-label`)
    ).not.toBeNull();
    expect(
      standalone!.querySelector(
        `#${CSS_PREFIX}-track-signal_peptide-signal_peptide`
      )
    ).not.toBeNull();
  });

  it('a genuine group still renders its collapse header and stays collapsed', () => {
    const group = target.querySelector(`#${CSS_PREFIX}-group_DOMAINS`);
    expect(group).not.toBeNull();
    expect(
      group!.classList.contains(`${CSS_PREFIX}-group--standalone`)
    ).toBe(false);
    // Collapse toggle present.
    expect(group!.querySelector(`.${CSS_PREFIX}-group-label`)).not.toBeNull();
    // openGroups is empty, so no expanded child track rows for the group.
    expect(target.querySelector(`#${CSS_PREFIX}-track_domain`)).toBeNull();
  });
});

// -------------------- Group collapse / expand interaction --------------------

describe('handleGroupClick — group collapse / expand toggle', () => {
  // A Markdoc-rendered group label can nest inline markup (a `{% help %}`
  // span, an inline link), so a click can land on a descendant of the
  // toggle host. handleGroupClick must climb via
  // `closest('[data-group-toggle]')` rather than a single parentElement hop.
  function toggleHost(id: string) {
    const host = document.createElement('div');
    host.setAttribute('data-group-toggle', id);
    const inner = document.createElement('span');
    inner.textContent = 'Label';
    host.append(inner);
    return { host, inner };
  }

  it('expands then collapses when a nested descendant of the label is clicked', () => {
    const el = buildInstance();
    const { host, inner } = toggleHost('GROUP_CANVAS');

    // First click — target is the nested span; the handler climbs to the
    // toggle host and expands the group.
    el.handleGroupClick({ target: inner } as unknown as MouseEvent);
    expect(el.openGroups).toContain('GROUP_CANVAS');
    expect(host.classList.contains('open')).toBe(true);

    // Second click on the same host collapses it again.
    el.handleGroupClick({ target: inner } as unknown as MouseEvent);
    expect(el.openGroups).not.toContain('GROUP_CANVAS');
    expect(host.classList.contains('open')).toBe(false);
  });

  it('ignores clicks that are not inside a group-toggle host', () => {
    const el = buildInstance();
    el.openGroups = ['GROUP_CANVAS'];
    const orphan = document.createElement('div');
    el.handleGroupClick({ target: orphan } as unknown as MouseEvent);
    // No toggle host in the ancestry → early return, openGroups untouched.
    expect(el.openGroups).toEqual(['GROUP_CANVAS']);
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
