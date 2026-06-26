import { LitElement, html, svg } from 'lit';
import { customElement } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { frame } from 'timing-functions';

// Nightingale
import NightingaleManager from '@nightingale-elements/nightingale-manager';
import NightingaleNavigation from '@nightingale-elements/nightingale-navigation';
import NightingaleSequence from '@nightingale-elements/nightingale-sequence';
import NightingaleColoredSequence from '@nightingale-elements/nightingale-colored-sequence';
import NightingaleTrackCanvas from '@nightingale-elements/nightingale-track-canvas';
import NightingaleInterproTrack from '@nightingale-elements/nightingale-interpro-track';
import NightingaleVariationCanvas from '@nightingale-elements/nightingale-variation-canvas';
import NightingaleLinegraphTrack from '@nightingale-elements/nightingale-linegraph-track';
import NightingaleSequenceHeatmap from '@nightingale-elements/nightingale-sequence-heatmap';
import NightingaleFilter, {
  Filter,
} from '@nightingale-elements/nightingale-filter';
import { amColorScale } from '@nightingale-elements/nightingale-structure';

// adapters
import featureAdapter from './adapters/feature-adapter';
import proteomicsAdapter from './adapters/proteomics-adapter';
import structureAdapter from './adapters/structure-adapter';
import variationAdapter, {
  TransformedVariant,
} from './adapters/variation-adapter';
import interproAdapter from './adapters/interpro-adapter';
import variationGraphAdapter from './adapters/variation-graph-adapter';
import rnaEditingGraphAdapter from './adapters/rna-editing-graph-adapter';
import rnaEditingAdapter from './adapters/rna-editing-adapter';
import proteomicsPTMApdapter from './adapters/ptm-exchange-adapter';
import alphaFoldConfidenceAdapter from './adapters/alphafold-confidence-adapter';
import alphaMissensePathogenicityAdapter from './adapters/alphamissense-pathogenicity-adapter';
import alphaMissenseHeatmapAdapter from './adapters/alphamissense-heatmap-adapter';

import ProtvistaUniprotStructure from './protvista-uniprot-structure';

import { fetchAll, loadComponent } from './utils';

import filterConfig, { colorConfig } from './filter-config';
import config, {
  ProtvistaConfig,
  ProtvistaTrackConfig,
  TrackType,
} from './config';

import { TransformedInterPro } from './adapters/types/interpro';
import { StructureFeature } from './adapters/structure-adapter';

/** Union of all possible per-track payload shapes stored in this.data */
type TrackPayload =
  | Record<string, unknown>[]
  | { sequence: string; variants: TransformedVariant[] }
  | ({ sequence: string; variants: TransformedVariant[] } & Record<
      string,
      unknown
    >)
  | TransformedInterPro
  | StructureFeature[]
  | { variants?: TransformedVariant[] }
  | string
  | null
  | undefined;

import loaderIcon from './icons/spinner.svg';
import protvistaStyles from './styles/protvista-styles';
import loaderStyles from './styles/loader-styles';

// Performance marks deliberately use stable, namespaced names so they
// survive component re-mount and tooling can pin to them by name.
// Renaming or moving them is a breaking change for perf measurement.
//
// Each mark fires at most once per page (subsequent component instances
// or re-loads no-op), and corresponding measures are emitted so they
// show up as named segments in Chrome DevTools and Lighthouse's
// user-timings audit.
const markOnce = (name: string) => {
  if (performance.getEntriesByName(name, 'mark').length === 0) {
    performance.mark(name);
  }
};
const measureOnce = (name: string, start: string, end: string) => {
  if (performance.getEntriesByName(name, 'measure').length === 0) {
    try {
      performance.measure(name, start, end);
    } catch {
      // Either start/end mark missing — surface marks but skip the measure
      // rather than throwing; comparing the marks directly still works.
    }
  }
};

/**
 * Typed adapter dispatch. Each case calls the real adapter with its real
 * signature so genuine mismatches become compile-time errors.
 *
 * Re-validation of the two bugs flagged in issue #133:
 *   - variation-adapter: returns `{ sequence, variants } | null` — the null
 *     case is handled downstream by the `if (!filteredData) return` guard.
 *   - proteomics-ptm-adapter (ProteomicsPtm): the adapter accepts a single
 *     ProteomicsPtm argument; trackData[0] is cast via Parameters<> which
 *     preserves the real type at the call site. No signature mismatch found.
 *
 * The `raw as Parameters<typeof adapter>` cast on each case is intentional:
 * trackData arrives as TrackPayload[] from the URL fetch and we cannot
 * statically prove its shape matches the adapter's expectation. The cast is
 * narrowed per-case (not a blanket unknown[]) so any future adapter signature
 * change will surface here.
 */
async function callAdapter(
  name: NonNullable<ProtvistaTrackConfig['data'][number]['adapter']>,
  raw: TrackPayload[]
): Promise<unknown> {
  switch (name) {
    case 'feature-adapter':
      return featureAdapter(...(raw as Parameters<typeof featureAdapter>));
    case 'interpro-adapter':
      return interproAdapter(...(raw as Parameters<typeof interproAdapter>));
    case 'proteomics-adapter':
      return proteomicsAdapter(
        ...(raw as Parameters<typeof proteomicsAdapter>)
      );
    case 'structure-adapter':
      return structureAdapter(...(raw as Parameters<typeof structureAdapter>));
    case 'variation-adapter':
      return variationAdapter(...(raw as Parameters<typeof variationAdapter>));
    case 'variation-graph-adapter':
      return variationGraphAdapter(
        ...(raw as Parameters<typeof variationGraphAdapter>)
      );
    case 'rna-editing-adapter':
      return rnaEditingAdapter(
        ...(raw as Parameters<typeof rnaEditingAdapter>)
      );
    case 'rna-editing-graph-adapter':
      return rnaEditingGraphAdapter(
        ...(raw as Parameters<typeof rnaEditingGraphAdapter>)
      );
    case 'proteomics-ptm-adapter':
      return proteomicsPTMApdapter(
        ...(raw as Parameters<typeof proteomicsPTMApdapter>)
      );
    case 'alphafold-confidence-adapter':
      return alphaFoldConfidenceAdapter(
        ...(raw as Parameters<typeof alphaFoldConfidenceAdapter>)
      );
    case 'alphamissense-pathogenicity-adapter':
      return alphaMissensePathogenicityAdapter(
        ...(raw as Parameters<typeof alphaMissensePathogenicityAdapter>)
      );
    case 'alphamissense-heatmap-adapter':
      return alphaMissenseHeatmapAdapter(
        ...(raw as Parameters<typeof alphaMissenseHeatmapAdapter>)
      );
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown adapter: ${_exhaustive as string}`);
    }
  }
}

type NightingaleEvent = Event & {
  detail?: {
    displaystart?: number;
    displayend?: number;
    eventType?: 'click' | 'mouseover' | 'mouseout' | 'reset';
    feature?: unknown;
    coords?: [number, number];
  };
};

@customElement('protvista-uniprot')
class ProtvistaUniprot extends LitElement {
  private openCategories: string[];
  private nostructure: boolean;
  private hasData: boolean;
  private loading: boolean;
  private data: Record<string, TrackPayload> = {};
  private rawData: Record<string, TrackPayload> = {};
  private displayCoordinates: { start?: number; end?: number } = {};
  private suspend?: boolean;
  private accession?: string;
  private sequence?: string;
  private notooltip?: boolean;
  private transformedVariants?: {
    sequence: string;
    variants: TransformedVariant[];
  };
  private config?: ProtvistaConfig;

  constructor() {
    super();
    this.openCategories = [];
    this.nostructure = false;
    this.hasData = false;
    this.loading = true;
    this.displayCoordinates = {};
    this.transformedVariants = { sequence: '', variants: [] };
    this.addStyles();
  }

  static get properties() {
    return {
      suspend: { type: Boolean, reflect: true },
      accession: { type: String, reflect: true },
      sequence: { type: String },
      data: { type: Object },
      openCategories: { type: Array },
      config: { type: Object },
      notooltip: { type: Boolean, reflect: true },
      nostructure: { type: Boolean, reflect: true },
    };
  }

  addStyles() {
    // We are not using static get styles() as we are not using the shadowDOM because of Mol*
    const styleTag = document.createElement('style');
    styleTag.textContent = `${protvistaStyles.toString()} ${loaderStyles.toString()}`;
    document.querySelector('head')?.append(styleTag);
  }

  registerWebComponents() {
    loadComponent('nightingale-navigation', NightingaleNavigation);
    loadComponent('nightingale-track-canvas', NightingaleTrackCanvas);
    loadComponent('nightingale-colored-sequence', NightingaleColoredSequence);
    loadComponent('nightingale-interpro-track', NightingaleInterproTrack);
    loadComponent('nightingale-sequence', NightingaleSequence);
    loadComponent('nightingale-variation-canvas', NightingaleVariationCanvas);
    loadComponent('nightingale-linegraph-track', NightingaleLinegraphTrack);
    loadComponent('nightingale-filter', NightingaleFilter);
    loadComponent('nightingale-manager', NightingaleManager);
    loadComponent('protvista-uniprot-structure', ProtvistaUniprotStructure);
    loadComponent('nightingale-sequence-heatmap', NightingaleSequenceHeatmap);
  }

  async _loadData() {
    const accession = this.accession;
    if (accession && this.config) {
      // Get the list of unique urls
      const urls = this.config.categories.flatMap(({ tracks }) =>
        tracks.flatMap(({ data }) => data[0].url)
      );

      // Get the data for all urls and store it
      this.rawData = await fetchAll([...new Set(urls)], (url: string) =>
        url.replace('{accession}', accession)
      );

      // Some endpoints return empty arrays, while most fail 🙄
      const wasHasData = this.hasData;
      this.hasData =
        this.hasData ||
        Object.values(this.rawData).some((d) => {
          if (d && typeof d === 'object' && 'features' in d) {
            const features = (d as { features?: unknown[] }).features;
            return Array.isArray(features) && features.length > 0;
          }
          return false;
        });

      // Fire the public protvista-event the moment data first becomes
      // available. (Previously this was hung off a `'load'` listener that
      // never fired — see `connectedCallback` history.)
      if (this.hasData && !wasHasData) {
        this.dispatchEvent(
          new CustomEvent('protvista-event', {
            detail: { hasData: true },
            bubbles: true,
          })
        );
      }

      // Now iterate over tracks and categories, transforming the data
      // and assigning it as adequate
      for (const { name: categoryName, tracks, trackType } of this.config
        .categories) {
        const categoryData = await Promise.all(
          tracks.map(async ({ data: dataConfig, name: trackName, filter }) => {
            const { url, adapter } = dataConfig[0]; // TODO handle array
            const trackData = (Array.isArray(url) ? url : [url]).map(
              (url) => this.rawData[url] || []
            );

            if (
              !trackData ||
              (adapter === 'variation-adapter' &&
                Array.isArray(trackData[0]) &&
                trackData[0].length === 0)
            ) {
              return;
            }

            // 1. Convert data
            let transformedData = adapter
              ? await callAdapter(adapter, trackData)
              : trackData;

            if (adapter === 'interpro-adapter') {
              const representativeDomains: TransformedInterPro = [];
              (transformedData as TransformedInterPro | undefined)?.forEach(
                (feature) => {
                  feature.locations?.forEach((location) => {
                    if (location.representative) {
                      location.fragments?.forEach((fragment) => {
                        representativeDomains.push({
                          ...feature,
                          type: 'InterPro Representative Domain',
                          start: fragment.start,
                          end: fragment.end,
                        });
                      });
                    }
                  });
                }
              );
              transformedData = representativeDomains;
            }

            // 2. Filter raw data if filter is specified
            const filteredData =
              Array.isArray(transformedData) && filter
                ? transformedData.filter(
                    ({ type }: { type?: string }) => type === filter
                  )
                : transformedData;
            if (!filteredData) {
              return;
            }

            // 3. Assign track data
            this.data[`${categoryName}-${trackName}`] = filteredData;

            if (trackName === 'variation') {
              this.transformedVariants = filteredData as {
                sequence: string;
                variants: TransformedVariant[];
              };
            }
            return filteredData;
          })
        );

        this.data[categoryName] =
          trackType === 'nightingale-linegraph-track' ||
          trackType === 'nightingale-colored-sequence'
            ? categoryData[0]
            : (categoryData.flat() as Record<string, unknown>[]);
      }
    }
    this.loading = false;
    markOnce('protvista:data-loaded');
    measureOnce(
      'protvista:fetch-and-parse',
      'protvista:script-start',
      'protvista:data-loaded'
    );
    this.requestUpdate(); // Why?
  }

  async _loadDataInComponents() {
    await frame();
    Object.entries(this.data).forEach(([id, data]) => {
      const element: NightingaleTrackCanvas | null = document.getElementById(
        `track-${id}`
      ) as NightingaleTrackCanvas;

      // set data if it hasn't changed
      if (element && element.data !== data) {
        element.data = data as NightingaleTrackCanvas['data'];
      }
      const currentCategory = this.config?.categories.find(
        ({ name }) => name === id
      );
      const dataAsArray = data as {
        length?: number;
        variants?: TransformedVariant[];
      } | null;
      if (
        currentCategory &&
        currentCategory.tracks &&
        dataAsArray &&
        // Check there's data and special case for variants
        // NOTE: should refactor variation-adapter
        // to return a list of variants and set the sequence
        // on protvista-variation separately
        ((dataAsArray.length ?? 0) > 0 ||
          (dataAsArray.variants?.length ?? 0) > 0)
      ) {
        // Make category element visible
        const categoryElt = document.getElementById(
          `category_${currentCategory.name}`
        );
        if (categoryElt) {
          categoryElt.style.display = 'flex';
        }
        for (const track of currentCategory.tracks) {
          const elementTrack = document.getElementById(
            `track-${id}-${track.name}`
          ) as NightingaleTrackCanvas | null;
          if (elementTrack) {
            elementTrack.data = this.data[
              `${id}-${track.name}`
            ] as NightingaleTrackCanvas['data'];
          }
        }
      }

      if (
        currentCategory?.name === 'ALPHAMISSENSE_PATHOGENICITY' &&
        currentCategory.tracks
      ) {
        for (const track of currentCategory.tracks) {
          if (track.trackType === 'nightingale-sequence-heatmap') {
            const heatmapComponent =
              this.querySelector<NightingaleSequenceHeatmap>(
                'nightingale-sequence-heatmap'
              );
            if (heatmapComponent && this.sequence) {
              const heatmapData = this.data[`${id}-${track.name}`] as {
                xValue: number;
                yValue: string;
                score: number;
              }[];
              const xDomain = Array.from(
                { length: this.sequence.length },
                (_, i) => i + 1
              );
              const yDomain = [
                ...new Set(heatmapData.map((hotMapItem) => hotMapItem.yValue)),
              ] as string[];
              heatmapComponent.setHeatmapData(
                xDomain,
                yDomain,
                heatmapData as Parameters<
                  typeof heatmapComponent.setHeatmapData
                >[2]
              );
              heatmapComponent.updateComplete.then(() => {
                heatmapComponent.heatmapInstance?.setColor((d) =>
                  amColorScale(d.score)
                );
              });
            }
          }
        }
      }
    });
  }

  updated(changedProperties: Map<string, string>) {
    super.updated(changedProperties);

    // First render with content — manager is in the DOM, not the loader.
    if (this.hasData && !this.loading) {
      markOnce('protvista:first-render');
      measureOnce(
        'protvista:render',
        'protvista:data-loaded',
        'protvista:first-render'
      );
      measureOnce(
        'protvista:total',
        'protvista:script-start',
        'protvista:first-render'
      );
    }

    const filterComponent =
      this.querySelector<NightingaleFilter>('nightingale-filter');
    if (filterComponent && filterComponent.filters !== filterConfig) {
      filterComponent.filters = filterConfig as Filter[];
    }

    const variationComponent = this.querySelector<NightingaleVariationCanvas>(
      'nightingale-variation-canvas'
    );

    if (variationComponent && variationComponent?.colorConfig !== colorConfig) {
      variationComponent.colorConfig = colorConfig as (
        v: import('@nightingale-elements/nightingale-variation').VariationDatum
      ) => string;
    }

    if (changedProperties.has('suspend')) {
      if (this.suspend) return;
      this._init();
    }

    this._loadDataInComponents();
  }

  _init() {
    if (!this.config) {
      this.config = config;
    }

    if (!this.accession) return;
    this.loadEntry(this.accession).then((entryData) => {
      if (!entryData) return;
      this.sequence = entryData.sequence.sequence;
      this.displayCoordinates = { start: 1, end: this.sequence?.length };
      // We need to get the length of the protein before rendering it
    });
    this._loadData();
  }

  connectedCallback() {
    super.connectedCallback();
    markOnce('protvista:script-start');
    this.registerWebComponents();

    if (!this.suspend) this._init();

    this.addEventListener('change', (e: NightingaleEvent) => {
      if (e.detail?.displaystart) {
        this.displayCoordinates.start = e.detail.displaystart;
      }
      if (e.detail?.displayend) {
        this.displayCoordinates.end = e.detail.displayend;
      }
    });
  }

  async loadEntry(
    accession: string
  ): Promise<{ sequence: { sequence: string } } | undefined> {
    try {
      return (await (
        await fetch(`https://www.ebi.ac.uk/proteins/api/proteins/${accession}`)
      ).json()) as { sequence: { sequence: string } };
    } catch (e) {
      console.error(`Couldn't load UniProt entry`, e);
      return undefined;
    }
  }

  /**
   * we need to use the light DOM.
   * */
  createRenderRoot() {
    return this;
  }

  render() {
    // Component isn't ready
    if (!this.sequence || !this.config || this.suspend) {
      return html``;
    }
    if (this.loading) {
      return html`<div class="protvista-loader">
        ${svg`${unsafeHTML(loaderIcon)}`}
      </div>`;
    }
    if (!this.hasData) {
      return html`<div class="protvista-no-results">
        No feature data available for ${this.accession}
      </div>`;
    }
    return html`
      <nightingale-manager
        reflected-attributes="length display-start display-end highlight activefilters filters"
      >
        <div class="nav-container">
          <div class="nav-track-label"></div>
          <div class="track-content">
            <nightingale-navigation
              length="${this.sequence.length}"
              height="40"
            ></nightingale-navigation>
            <nightingale-sequence
              length="${this.sequence.length}"
              height="40"
              sequence="${this.sequence}"
              display-start=${this.displayCoordinates?.start}
              display-end="${this.displayCoordinates?.end}"
              highlight-event="onclick"
              use-ctrl-to-zoom
            ></nightingale-sequence>
          </div>
        </div>
        ${this.config.categories.map(
          (category) =>
            this.data[category.name] &&
            html`
              <div class="category" id="category_${category.name}">
                <div
                  class="category-label"
                  data-category-toggle="${category.name}"
                  @click="${this.handleCategoryClick}"
                >
                  ${category.helpPage
                    ? html`<span data-article-id="${category.helpPage}"
                        >${category.label}</span
                      >`
                    : category.label}
                </div>
                <div
                  data-id="category_${category.name}"
                  class="aggregate-track-content track-content ${category.trackType ===
                  'nightingale-colored-sequence'
                    ? 'track-content__coloured-sequence'
                    : ''}"
                  .style="${this.openCategories.includes(category.name)
                    ? 'opacity:0'
                    : 'opacity:1'}"
                >
                  ${this.data[category.name] &&
                  this.getTrack(
                    category.trackType,
                    'non-overlapping',
                    category.color,
                    category.shape,
                    category.name,
                    category.scale,
                    category['color-range']
                  )}
                </div>
              </div>

              <!-- Expanded Categories -->
              ${category.tracks &&
              category.tracks.map((track) => {
                if (this.openCategories.includes(category.name)) {
                  const trackData = this.data[`${category.name}-${track.name}`];
                  return trackData &&
                    ((Array.isArray(trackData) && trackData.length) ||
                      Object.keys(trackData).length)
                    ? html`
                        <div class="category__track" id="track_${track.name}">
                          <div class="track-label" title="${track.tooltip}">
                            ${(track.filterComponent &&
                              this.getFilterComponent(
                                `${category.name}-${track.name}`
                              )) ||
                            (track.labelUrl &&
                              this.accession &&
                              html`<a
                                target="_blank"
                                href="${track.labelUrl.replace(
                                  '{accession}',
                                  this.accession
                                )}"
                                >${track.label}</a
                              >`) ||
                            (track.helpPage
                              ? html`<span data-article-id="${track.helpPage}"
                                  >${track.label}</span
                                >`
                              : track.label)}
                          </div>
                          <div
                            class="track-content"
                            class="track-content ${category.trackType ===
                            'nightingale-colored-sequence'
                              ? 'track-content__coloured-sequence'
                              : ''}"
                            data-id="track_${track.name}"
                          >
                            ${this.getTrack(
                              track.trackType,
                              'non-overlapping',
                              track.color || category.color,
                              track.shape || category.shape,
                              `${category.name}-${track.name}`,
                              track.scale || category.scale,
                              track['color-range'] || category['color-range']
                            )}
                          </div>
                        </div>
                      `
                    : '';
                }
              })}
              ${!category.tracks
                ? (this.data[category.name] as { accession?: string }[]).map(
                    (item: { accession?: string }) => {
                      if (this.openCategories.includes(category.name)) {
                        if (!item || !item.accession) return '';
                        return html`
                          <div
                            class="category__track"
                            id="track_${item.accession}"
                          >
                            <div class="track-label" title="${item.accession}">
                              ${item.accession}
                            </div>
                            <div
                              class="track-content"
                              data-id="track_${item.accession}"
                            >
                              ${this.getTrack(
                                category.trackType,
                                'non-overlapping',
                                category.color,
                                category.shape,
                                `${category.name}-${item.accession}`,
                                category.scale,
                                category['color-range']
                              )}
                            </div>
                          </div>
                        `;
                      }
                    }
                  )
                : ''}
            `
        )}
        <div class="nav-container">
          <div class="credits"></div>
          <div class="track-content">
            <nightingale-sequence
              length="${this.sequence.length}"
              height="40"
              sequence="${this.sequence}"
              display-start=${this.displayCoordinates.start}
              display-end="${this.displayCoordinates.end}"
              highlight-event="onclick"
              use-ctrl-to-zoom
            ></nightingale-sequence>
          </div>
        </div>
        ${!this.nostructure
          ? html`
              <protvista-uniprot-structure
                accession="${this.accession || ''}"
              ></protvista-uniprot-structure>
            `
          : ''}
      </nightingale-manager>
    `;
  }

  handleCategoryClick(e: MouseEvent) {
    let target = e.target as Element;

    if (target instanceof HTMLSpanElement) {
      target = target.parentElement as Element;
    }

    const toggle = target.getAttribute('data-category-toggle');

    if (toggle && !target.classList.contains('open')) {
      target.classList.add('open');
      this.openCategories = [...this.openCategories, toggle];
    } else {
      target.classList.remove('open');
      this.openCategories = [...this.openCategories].filter(
        (d) => d !== toggle
      );
    }
  }

  groupByCategory(filters: Filter[] | undefined, category: string) {
    return filters?.filter((f) => f.type.name === category);
  }

  getFilter(filters: Filter[] | undefined, filterName: string) {
    return filters?.filter((f) => f.name === filterName)?.[0];
  }

  handleFilterClick(e: CustomEvent) {
    const target = e.target as Element as NightingaleFilter;
    const consequenceFilters = this.groupByCategory(
      target.filters,
      'consequence'
    );
    const provenanceFilters = this.groupByCategory(
      target.filters,
      'provenance'
    );

    const selectedFilters = e.detail?.value;

    if (selectedFilters) {
      const selectedConsequenceFilters = selectedFilters
        .map((f: string) => this.getFilter(consequenceFilters, f))
        .filter(Boolean) as (Filter & {
        filterPredicate: (v: TransformedVariant) => unknown;
      })[];
      const selectedProvenanceFilters = selectedFilters
        .map((f: string) => this.getFilter(provenanceFilters, f))
        .filter(Boolean) as (Filter & {
        filterPredicate: (v: TransformedVariant) => unknown;
      })[];

      const filteredVariants = this.transformedVariants?.variants
        ?.filter((variant) =>
          selectedConsequenceFilters.some((filter) =>
            filter.filterPredicate(variant)
          )
        )
        .filter((variant) =>
          selectedProvenanceFilters.some((filter) =>
            filter.filterPredicate(variant)
          )
        );

      const existing = this.data['VARIATION-variation'];
      this.data['VARIATION-variation'] = {
        ...(existing && typeof existing === 'object' && !Array.isArray(existing)
          ? existing
          : {}),
        variants: filteredVariants,
      } as TrackPayload;

      this._loadDataInComponents();
    }
  }

  getCategoryTypesAsString(tracks: ProtvistaTrackConfig[]) {
    return tracks.map((t) => t.filter).join(',');
  }

  getFilterComponent(forId: string) {
    return html`
      <nightingale-filter
        style="minWidth: 20%"
        for="track-${forId}"
        @change="${this.handleFilterClick}"
      ></nightingale-filter>
    `;
  }

  getTrack(
    trackType: TrackType,
    layout = '',
    color = '',
    shape = '',
    id = '',
    scale = '',
    colorRange = ''
  ) {
    // lit-html doesn't allow to have dynamic tag names, hence the switch/case
    // with repeated code
    switch (trackType) {
      case 'nightingale-track-canvas':
        return html`
          <nightingale-track-canvas
            length="${this.sequence?.length}"
            height="40"
            layout="${layout}"
            color="${color}"
            shape="${shape}"
            display-start="${this.displayCoordinates?.start}"
            display-end="${this.displayCoordinates?.end}"
            id="track-${id}"
            highlight-event="onclick"
            use-ctrl-to-zoom
          >
          </nightingale-track-canvas>
        `;
      case 'nightingale-interpro-track':
        return html`
          <nightingale-interpro-track
            length="${this.sequence?.length}"
            height="40"
            color="${color}"
            shape="${shape}"
            display-start="${this.displayCoordinates?.start}"
            display-end="${this.displayCoordinates?.end}"
            id="track-${id}"
            highlight-event="onclick"
            use-ctrl-to-zoom
          >
          </nightingale-interpro-track>
        `;
      case 'nightingale-variation-canvas':
        return html`
          <nightingale-variation-canvas
            length="${this.sequence?.length}"
            height="500"
            display-start="${this.displayCoordinates?.start}"
            display-end="${this.displayCoordinates?.end}"
            id="track-${id}"
            highlight-event="onclick"
            use-ctrl-to-zoom
          >
          </nightingale-variation-canvas
        `;
      case 'nightingale-linegraph-track':
        return html`
          <nightingale-linegraph-track
            length="${this.sequence?.length}"
            height="50"
            display-start="${this.displayCoordinates?.start}"
            display-end="${this.displayCoordinates?.end}"
            id="track-${id}"
            show-label-name
            highlight-on-click
            use-ctrl-to-zoom
          >
          </nightingale-linegraph-track>
        `;
      case 'nightingale-colored-sequence':
        return html`
          <nightingale-colored-sequence
            length="${this.sequence?.length}"
            display-start="${this.displayCoordinates?.start}"
            display-end="${this.displayCoordinates?.end}"
            id="track-${id}"
            scale="${scale}"
            color-range="${colorRange}"
            height="13"
            highlight-event="onclick"
            use-ctrl-to-zoom
          >
          </nightingale-colored-sequence>
        `;

      case 'nightingale-sequence-heatmap':
        return html`
          <nightingale-sequence-heatmap
            id="track-${id}"
            heatmap-id="seq-heatmap"
            length="${this.sequence?.length}"
            display-start="${this.displayCoordinates?.start}"
            display-end="${this.displayCoordinates?.end}"
            highlight-event="onclick"
            highlight-color="#EB3BFF66"
            height="300"
            use-ctrl-to-zoom
          >
          </nightingale-sequence-heatmap>
        `;
      default:
        console.warn('No Matching ProtvistaTrack Found.');
        break;
    }
  }
}

export default ProtvistaUniprot;
// touched
