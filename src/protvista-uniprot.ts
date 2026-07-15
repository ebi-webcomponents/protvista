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

import { loadComponent } from './utils';
import {
  loadProtvistaData,
  UNFILTERED_SUFFIX,
  type CustomTrackData,
} from './load-data';
import {
  installClickTooltip,
  type TooltipController,
} from './tooltips/popover';

import filterConfig, { colorConfig } from './filter-config';

// Schema-driven config pipeline. The default YAML is
// bundled as a raw string so `js-yaml` stays lazy-loaded — adopters
// who pass a parsed `viewerConfig` object never pull in the parser.
import defaultConfigYaml from './default-config.yaml?raw';
import { loadConfig } from './schema/load';
import type { KnownComponentName, ProtvistaViewerConfig } from './schema/types';
import type { NormalizedConfig, NormalizedTrack } from './schema/normalize';
import { renderingToAttrs } from './renderer/render-helpers';

import loaderIcon from './icons/spinner.svg';
import protvistaStyles from './styles/protvista-styles';
import loaderStyles from './styles/loader-styles';
import { CSS_PREFIX } from './styles/css-prefix';
import { injectStyleOnce, installTokenDefaults } from './styles/inject';

// Performance marks emitted at three lifecycle transitions:
//   protvista:script-start    component connectedCallback runs
//   protvista:data-loaded     fetch + parse complete
//   protvista:first-render    nightingale-manager rendered with content
// These are part of the component's public observable surface — the
// `bench/` workflow relies on them to compare baselines across refactors.
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

// Exported so tests and the schema-driven loader can construct the
// exact same adapter map without risking drift. Keys are the canonical
// schema-level `<source>-<format>` adapter names — the same vocabulary
// config authors write in `adapter:` fields.
export const adapters = {
  'uniprot-features-json': featureAdapter,
  'interpro-entries-json': interproAdapter,
  'uniprot-proteomics-json': proteomicsAdapter,
  'uniprot-proteins-pdb-json': structureAdapter,
  'uniprot-variation-json': variationAdapter,
  'uniprot-variation-counts-json': variationGraphAdapter,
  'uniprot-rna-editing-json': rnaEditingAdapter,
  'uniprot-rna-editing-counts-json': rnaEditingGraphAdapter,
  'uniprot-proteomics-ptm-json': proteomicsPTMApdapter,
  'alphafold-prediction-json': alphaFoldConfidenceAdapter,
  'alphamissense-average-csv': alphaMissensePathogenicityAdapter,
  'alphamissense-full-csv': alphaMissenseHeatmapAdapter,
};

type NightingaleEvent = Event & {
  detail?: {
    displaystart?: number;
    displayend?: number;
    eventType?: 'click' | 'mouseover' | 'mouseout' | 'reset';
    feature?: any;
    coords?: [number, number];
  };
};

@customElement('protvista-uniprot')
class ProtvistaUniprot extends LitElement {
  private openGroups: string[];
  private nostructure: boolean;
  /** Opt out of the built-in click tooltip. Consumers rendering a React overlay typically set this. */
  private notooltip?: boolean;
  private hasData: boolean;
  private loading: boolean;
  private data: { [key: string]: any };
  private rawData: { [key: string]: any };
  private displayCoordinates: { start?: number; end?: number } = {};
  private suspend?: boolean;
  private accession?: string;
  private sequence?: string;
  /**
   * Fully-resolved config consumed by the renderer and
   * `loadProtvistaData()`. Populated in `_init()` by running the
   * schema pipeline (`loadConfig`) over one of the three input
   * sources below. The renderer reads `NormalizedGroup` /
   * `NormalizedTrack` fields (`id`, `description`, `component`,
   * `rendering.*`, `filterUI`, `data[]`) directly — no intermediate
   * adapter is involved.
   */
  private config?: NormalizedConfig;
  /**
   * Schema-driven config input. Accepts the three forms `loadConfig`
   * supports (`ProtvistaViewerConfig` object, JSON string, YAML
   * string). When `undefined`, the element falls back to
   * `configSrc` and then to the bundled `default-config.yaml`.
   */
  private viewerConfig?: ProtvistaViewerConfig | string;
  /**
   * URL / file path to a YAML or JSON config. Fetched and handed to
   * `loadConfig` at mount time. Lower precedence than
   * `viewerConfig`.
   */
  private configSrc?: string;
  /**
   * Data injected via `setTrackData()` for tracks whose first data
   * descriptor is `from: custom`. Keyed by `${groupId}-${trackId}`;
   * `loadProtvistaData` reads this map and feeds values directly into
   * the per-track pipeline, skipping the fetch + adapter stages.
   *
   * Preserved across re-renders so a consumer that injects once
   * doesn't need to re-inject on every data reload. Cleared only by
   * the consumer (there is no public `clearTrackData` — the canonical
   * way to swap data sources is to edit the config).
   */
  private customTrackData: CustomTrackData = {};

  /**
   * Controller for the click-triggered tooltip popover. Installed in
   * `connectedCallback`, torn down in `disconnectedCallback`. Gated by
   * the `notooltip` attribute via the `enabled` predicate — callers
   * who render their own tooltip layer (e.g. a React overlay) set
   * `notooltip` and this controller stays quiet.
   */
  private _tooltipController?: TooltipController;

  /**
   * Cancels the in-flight `_loadData()` run, if any. Held here so
   * re-entrant callers — `setTrackData()` firing mid-flight,
   * `_init()` re-running on `suspend` toggling, or
   * `disconnectedCallback` tearing the element out — can abort the
   * active fetch batch and discard its result rather than racing it
   * against the current one. Without this, a slow fetch from call N
   * could land after the `Object.assign` from call N+1 and overwrite
   * the newer state.
   */
  private _loadAbortController?: AbortController;

  constructor() {
    super();
    this.openGroups = [];
    this.nostructure = false;
    this.hasData = false;
    this.loading = true;
    this.data = {};
    this.rawData = {};
    this.displayCoordinates = {};
    this.addStyles();
  }

  static get properties() {
    return {
      suspend: { type: Boolean, reflect: true },
      accession: { type: String, reflect: true },
      sequence: { type: String },
      data: { type: Object },
      openGroups: { type: Array },
      config: { type: Object },
      viewerConfig: { type: Object },
      // HTML attribute form is kebab-case: `config-src="./my-config.yaml"`.
      configSrc: { type: String, attribute: 'config-src', reflect: true },
      notooltip: { type: Boolean, reflect: true },
      nostructure: { type: Boolean, reflect: true },
    };
  }

  addStyles() {
    // We are not using static get styles() as we are not using the shadowDOM because of Mol*.
    // Each stylesheet is installed once per page and shared by every
    // instance (see src/styles/inject.ts). The token defaults and loader
    // styles carry their own keys so they are shared with
    // <protvista-uniprot-structure> rather than duplicated. (Multi-instance
    // isolation — unique DOM ids, scoped tooltip popovers, etc. — is
    // tracked separately as a next-branch issue.)
    installTokenDefaults();
    injectStyleOnce('loader', loaderStyles.toString());
    injectStyleOnce('viewer', protvistaStyles.toString());
  }

  registerWebComponents() {
    loadComponent('nightingale-navigation', NightingaleNavigation);
    loadComponent('nightingale-track-canvas', NightingaleTrackCanvas);
    loadComponent('nightingale-colored-sequence', NightingaleColoredSequence);
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
    if (!accession || !this.config) {
      this.loading = false;
      this.requestUpdate();
      return;
    }

    // Cancel any still-running fetch batch. A second call to
    // `_loadData()` (from `setTrackData()`, `_init()` re-entry, or a
    // config swap) must invalidate the previous batch: without this,
    // the earlier batch could resolve later and overwrite newer state.
    this._loadAbortController?.abort();
    const controller = new AbortController();
    this._loadAbortController = controller;
    const { signal } = controller;

    const { rawData, data, hasData } = await loadProtvistaData(
      accession,
      this.config,
      // Preserve the legacy fetchAll semantics: 4xx/5xx and thrown
      // errors are swallowed with a warning, leaving a null in the
      // per-URL slot. `AbortError` thrown by a later `_loadData()`
      // re-entry is recognised and silently returned as `null` so it
      // doesn't pollute the console.
      async (url) => {
        try {
          const response = await fetch(url, { signal });
          if (!response.ok) {
            // TODO handle this better based on error code
            console.warn(`HTTP error status: ${response.status} at ${url}`);
            return null;
          }
          return await response.json();
        } catch (error) {
          if ((error as { name?: string })?.name === 'AbortError') {
            // Expected — a newer _loadData() call invalidated us.
            return null;
          }
          console.warn(`Failed to fetch or parse JSON from ${url}:`, error);
          return null;
        }
      },
      adapters,
      this.customTrackData
    );

    // If a newer load started while we were awaiting, drop the result
    // on the floor — the newer call owns subsequent state writes.
    if (signal.aborted) return;

    this.rawData = rawData;
    const wasHasData = this.hasData;
    this.hasData = this.hasData || hasData;
    // Fire the public protvista-event the moment data first becomes
    // available. (Previously this was hung off a `'load'` listener
    // that never fired.)
    if (this.hasData && !wasHasData) {
      this.dispatchEvent(
        new CustomEvent('protvista-event', {
          detail: { hasData: true },
          bubbles: true,
        })
      );
    }
    // Reference-swap so Lit's reactive system sees the change and
    // re-renders without needing a manual `requestUpdate()` at the
    // bottom of this method (the other two lines above still aren't
    // tracked properties, so we keep the call).
    this.data = { ...this.data, ...data };

    // The variation filter's pristine baseline now rides along in
    // `data` under `${groupId}-${trackId}${UNFILTERED_SUFFIX}` for any
    // track that opts into `filterUI: 'nightingale-filter'` — written by
    // the loader, consumed by `handleFilterClick`. No id-based copy step
    // is needed here anymore.

    // Clear the stored controller if it's still us — if a newer call
    // already overwrote it, leaving ours stale would defeat
    // future cancellation attempts.
    if (this._loadAbortController === controller) {
      this._loadAbortController = undefined;
    }

    this.loading = false;
    markOnce('protvista:data-loaded');
    measureOnce(
      'protvista:fetch-and-parse',
      'protvista:script-start',
      'protvista:data-loaded'
    );
    // `loading` and `hasData` are plain private fields (not in
    // `properties`), so Lit's reactive system doesn't pick them up.
    // `this.data` reassignment above *is* tracked, but we issue the
    // explicit update anyway to keep a single notify site.
    this.requestUpdate();
  }

  /**
   * Scope an `id`-style selector to this element's light-DOM subtree.
   * Replaces the legacy `document.getElementById(id)` pattern, which
   * would cross-talk between instances if two `<protvista-uniprot>`s
   * co-existed on a page (YAML-authored `track.id`s collide across
   * instances because they're drawn from the same canonical vocabulary).
   *
   * Uses `CSS.escape` so ids containing spaces (the YAML config legally
   * allows `"InterPro representative domain"` as a track id) still
   * match. Returns `null` on miss, same contract as the browser APIs.
   */
  private findById<T extends HTMLElement>(id: string): T | null {
    return this.querySelector<T>(`#${CSS.escape(id)}`);
  }

  async _loadDataInComponents() {
    await frame();
    Object.entries(this.data).forEach(([id, data]) => {
      // `__unfiltered` baselines are inert filter state, not renderable
      // track/group payloads — skip them so this walk's "every key maps
      // to a track or group" invariant holds.
      if (id.endsWith(UNFILTERED_SUFFIX)) return;
      const element = this.findById<NightingaleTrackCanvas>(
        `${CSS_PREFIX}-track-${id}`
      );
      // set data if it hasn't changed
      if (element && element.data !== data) {
        element.data = data;
      }
      const currentGroup = this.config?.groups.find((c) => c.id === id);
      if (
        currentGroup &&
        currentGroup.tracks &&
        data &&
        // Check there's data and special case for variants.
        // TODO(#variation-hardcoded): the `data.variants` branch
        // mirrors the pre-refactor variation-adapter contract where
        // the adapter emits `{ sequence, variants }` instead of a
        // plain array. Lifting the shape check into a track-level
        // capability (e.g. a `bundle: true` flag surfaced by the
        // schema) would remove this hardcoded special case and let
        // arbitrary adapters emit bundled outputs.
        (data.length > 0 || data.variants?.length)
      ) {
        // Make group element visible
        const groupElt = this.findById<HTMLElement>(
          `${CSS_PREFIX}-group_${currentGroup.id}`
        );
        if (groupElt) {
          groupElt.style.display = 'flex';
        }
        for (const track of currentGroup.tracks) {
          const elementTrack = this.findById<NightingaleTrackCanvas>(
            `${CSS_PREFIX}-track-${id}-${track.id}`
          );
          if (elementTrack) {
            elementTrack.data = this.data[`${id}-${track.id}`];
          }
        }
      }

      // TODO(#alphamissense-hardcoded): this branch matches on a
      // specific group id from the shipped config to drive the
      // heatmap-specific setHeatmapData/colour-scale wiring. A consumer
      // config that uses a different id for its AlphaMissense group
      // will silently skip this wiring. Lifting the branch out of the
      // component and into either (a) a track-level `kind:
      // 'alphamissense-heatmap'` that owns the setup, or (b) a generic
      // `nightingale-sequence-heatmap` lifecycle hook, would remove
      // the id match and let arbitrary consumer configs drive the
      // heatmap renderer.
      if (
        currentGroup?.id === 'ALPHAMISSENSE_PATHOGENICITY' &&
        currentGroup.tracks
      ) {
        for (const track of currentGroup.tracks) {
          if (track.component === 'nightingale-sequence-heatmap') {
            const heatmapComponent =
              this.querySelector<NightingaleSequenceHeatmap>(
                'nightingale-sequence-heatmap'
              );
            if (heatmapComponent && this.sequence) {
              const heatmapData = this.data[`${id}-${track.id}`];
              const xDomain = Array.from(
                { length: this.sequence.length },
                (_, i) => i + 1
              );
              const yDomain = [
                ...new Set(heatmapData.map((hotMapItem) => hotMapItem.yValue)),
              ] as string[];
              heatmapComponent.setHeatmapData(xDomain, yDomain, heatmapData);
              heatmapComponent.updateComplete.then(() => {
                heatmapComponent.heatmapInstance.setColor((d) =>
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
      variationComponent.colorConfig = colorConfig;
    }

    if (changedProperties.has('suspend')) {
      if (this.suspend) return;
      this._init();
    }

    // Post-mount `accession` change → re-run `_init()` so `loadEntry()`
    // refetches the sequence and `_loadData()` refetches the track
    // data against the new ID. Consumers like UniProt's own feature
    // viewer navigate between entries without unmounting the element,
    // so this is a live UX path.
    //
    // Guard: `changedProperties.get('accession') !== undefined` so the
    // initial-mount transition (`undefined → "<value>"`) doesn't
    // double-run — that transition is already covered by
    // `connectedCallback() → _init()`.
    //
    // Intentional early return: `_init()` is async and will update
    // `this.config` / `this.sequence` / `this.data` on its own
    // schedule, each firing another `updated()` cycle that will hit
    // the gate below. Running the push on THIS tick would inject
    // stale (old-accession) data into components.
    if (
      changedProperties.has('accession') &&
      changedProperties.get('accession') !== undefined
    ) {
      this._init();
      return;
    }

    // Only push data into Nightingale when something that could
    // affect the per-track payload or the track DOM has actually
    // changed. `updated()` fires for every reactive property —
    // running the DOM walk on each one was wasted work and churned
    // `element.data` setters that cost a canvas re-draw.
    //
    // `openGroups` must stay in the gate: when a group expands,
    // the render cycle mounts fresh per-track elements that need to be
    // populated on this same tick. `data` / `config` / `sequence`
    // cover the load-pipeline re-flow. Unrelated reactive churn
    // (`displayCoordinates`, `viewerConfig`, …) short-circuits.
    if (
      changedProperties.has('data') ||
      changedProperties.has('config') ||
      changedProperties.has('sequence') ||
      changedProperties.has('openGroups')
    ) {
      this._loadDataInComponents();
    }
  }

  /**
   * Mount-time entry point. Runs the schema pipeline (parse →
   * validate → normalize) and stashes the resulting
   * `NormalizedConfig` on `this.config` for the render loop and
   * `loadProtvistaData()` to consume. Kicks off the sequence and
   * track-data fetches.
   *
   * Accession precedence (highest wins):
   *   1. HTML attribute (`<protvista-uniprot accession="P05067">`)
   *   2. `viewerConfig.accession` (programmatic)
   *   3. `accession:` field in the YAML/JSON config file
   *
   * Re-entrancy: a consumer that calls `_init()` while a previous
   * call's `loadConfig` promise is in flight gets the later input's
   * config — the earlier resolve simply overwrites fields the later
   * one will overwrite again. Not worth an AbortController until we
   * observe a real consumer mutating `viewerConfig` on every tick.
   */
  async _init() {
    if (!this.config) {
      try {
        const normalized = await this.resolveViewerConfig();
        // Accession precedence: HTML attribute wins, so only backfill
        // from the config when the author left the attribute blank.
        if (!this.accession && normalized.accession) {
          this.accession = normalized.accession;
        }
        this.config = normalized;
      } catch (err) {
        // Validation / parse errors are surfaced on the console so
        // authors see the full `ConfigValidationError.issues[]` list;
        // the element falls through to the no-data render path below
        // and shows its empty-state markup rather than a stack trace.
        console.error('[protvista-uniprot] Failed to load config.', err);
        this.loading = false;
        this.requestUpdate();
        return;
      }
    }

    if (!this.accession) return;
    this.loadEntry(this.accession)
      .then((entryData) => {
        // `loadEntry` swallows network / parse errors and returns
        // `undefined`; it can also return a 4xx response body with no
        // `sequence` field. Guard both so the element falls through to
        // the no-data render path instead of crashing on a bare
        // dereference. The empty-state branch in `render()` is keyed on
        // `!this.sequence`, so leaving `sequence` unset is the
        // user-visible recovery path.
        const seq = entryData?.sequence?.sequence;
        if (typeof seq !== 'string' || seq.length === 0) {
          console.warn(
            `[protvista-uniprot] loadEntry returned no usable sequence for '${this.accession}'. Rendering empty-state.`
          );
          this.loading = false;
          this.requestUpdate();
          return;
        }
        this.sequence = seq;
        this.displayCoordinates = { start: 1, end: this.sequence.length };
        // We need to get the length of the protein before rendering it
      })
      .catch((err) => {
        // `loadEntry` is defensive and returns `undefined` on almost
        // every failure mode, but an unexpected throw (e.g. a
        // malformed-JSON `response.json()` on an otherwise-2xx reply)
        // can escape. Without this handler the rejection would surface
        // as an unhandled promise rejection in the host page's console.
        // Route it through the same empty-state recovery so the
        // component stays consistent with the documented
        // swallow-and-log contract.
        console.warn(
          `[protvista-uniprot] Unexpected error from loadEntry for '${this.accession}':`,
          err
        );
        this.loading = false;
        this.requestUpdate();
      });
    this._loadData();
  }

  /**
   * Resolve the config input in the documented precedence order and
   * drive it through `loadConfig()`. Isolated from `_init()` so
   * tests can exercise the branching without having to mount a
   * DOM-connected element.
   *
   * The HTML-attribute `accession` is forwarded to `loadConfig` so
   * the validator's `missing-accession` rule accepts template
   * configs (like the bundled default YAML) whose URLs carry
   * `{accession}` placeholders. `loadConfig` will ignore this when
   * the config already declares its own accession.
   */
  private async resolveViewerConfig(): Promise<NormalizedConfig> {
    const loadOpts = { accession: this.accession };
    if (this.viewerConfig !== undefined) {
      return loadConfig(this.viewerConfig, loadOpts);
    }
    if (this.configSrc) {
      // Intentionally let a bad URL / non-OK response propagate —
      // the catch in `_init()` logs it with the URL and falls back
      // to the no-data render path, same as a validation failure.
      const response = await fetch(this.configSrc);
      if (!response.ok) {
        throw new Error(
          `protvista-uniprot: failed to fetch configSrc '${this.configSrc}' (HTTP ${response.status})`
        );
      }
      const text = await response.text();
      return loadConfig(text, loadOpts);
    }
    return loadConfig(defaultConfigYaml, loadOpts);
  }

  /**
   * Runtime escape-hatch for `from: custom` tracks
   *
   * Provides data for a specific track programmatically, bypassing URL
   * fetching. Use this when your data doesn't live at a stable URL —
   * for instance, a React overlay that fetches through its own app-level
   * data layer and hands the result to ProtVista, or a server-rendered
   * page that inlines per-request data too large for `from: inline` and
   * the YAML `inlineData:` field.
   *
   * Contract:
   *   - The addressed track's first `data` descriptor must be
   *     `from: custom`. Attempts to inject into URL-, file-, or
   *     inline-sourced tracks are rejected with a `console.warn` and
   *     the injected value is discarded — to swap the data source for
   *     a non-`custom` track, edit the config instead.
   *   - Calls before mount (before `_init()` has produced a
   *     `NormalizedConfig`) are captured and applied on first load.
   *     Validation is deferred until the config is available, so
   *     pre-mount calls are never spuriously rejected.
   *   - Calls after mount trigger a re-run of the data pipeline so the
   *     new value flows through the track-level `filter:` sugar, the
   *     tooltip resolver, and the group aggregate. URL-sourced
   *     tracks continue to hit the network on each re-run — the
   *     browser's HTTP cache typically absorbs this, and no caching
   *     layer is added here to keep the pipeline transparent.
   *
   * @param groupId - The `id` of the enclosing group.
   * @param trackId    - The `id` of the track within that group.
   * @param data       - Data conforming to the track's expected
   *                     representation (already in post-adapter shape).
   */
  setTrackData(groupId: string, trackId: string, data: unknown): void {
    // Shape validation. The renderer hands `data` straight to a
    // Nightingale component's `.data` setter, so a primitive or
    // `null` would either be silently ignored (number, string) or
    // throw on a downstream `.forEach` (null). We reject those at the
    // boundary so the failure mode is a visible `console.warn` rather
    // than a cryptic runtime error.
    //
    // Accepted shapes: an array of post-adapter feature objects, or a
    // `{ sequence, variants }` bundle (the variation-shaped emission).
    // Anything else earns a warn + early-return and leaves the
    // existing track value untouched.
    const isArray = Array.isArray(data);
    const isPlainObject = data !== null && typeof data === 'object' && !isArray;
    if (!isArray && !isPlainObject) {
      console.warn(
        `[protvista-uniprot] setTrackData: expected an array or plain object for '${groupId}/${trackId}', got ${data === null ? 'null' : typeof data}. Call ignored.`
      );
      return;
    }

    const key = `${groupId}-${trackId}`;
    // Copy-on-write so downstream `===` checks against the previous map
    // (should any appear) see a fresh reference.
    this.customTrackData = { ...this.customTrackData, [key]: data };

    // Pre-mount: stash and return. `_loadData()` will read
    // `this.customTrackData` on its first run, so no further work is
    // needed here and no validation is possible yet (no config).
    if (!this.config) return;

    const group = this.config.groups.find((c) => c.id === groupId);
    const track = group?.tracks.find((t) => t.id === trackId);
    if (!track) {
      console.warn(
        `[protvista-uniprot] setTrackData: track '${groupId}/${trackId}' not found in config.`
      );
      return;
    }
    const firstSource = track.data[0];
    if (firstSource?.from !== 'custom') {
      console.warn(
        `[protvista-uniprot] setTrackData: track '${groupId}/${trackId}' is not 'from: custom' (found '${firstSource?.from ?? 'undefined'}'). Injected data discarded; edit the config to change this track's data source.`
      );
      return;
    }

    // Post-mount: re-run the pipeline so the new data propagates
    // through filter / tooltip resolution and into the Nightingale
    // components. `_loadData()` already handles `this.loading` and
    // `this.requestUpdate()`.
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

    // Click-triggered tooltip display. The controller listens for the
    // same `change` event on this host, filters to
    // `eventType === 'click'`, and positions a `role="tooltip"` popover
    // via `@floating-ui/dom`. `notooltip` is checked per-click so
    // attribute changes take effect without a re-install.
    this._tooltipController = installClickTooltip(this, {
      enabled: () => !this.notooltip,
    });
  }

  disconnectedCallback() {
    this._tooltipController?.dispose();
    this._tooltipController = undefined;
    // Cancel any still-running fetch batch so the detached element
    // can't commit state writes back into a no-longer-mounted DOM.
    this._loadAbortController?.abort();
    this._loadAbortController = undefined;
    super.disconnectedCallback();
  }

  /**
   * Minimal shape `_init()` consumes from the UniProt Proteins API. The
   * full response carries many more fields, but the element only needs
   * the canonical sequence (length + string) to size the track strip
   * and render the sequence rows. The optional chain matches the
   * runtime guard in `_init()` — if any segment is missing, the
   * element falls through to empty-state without crashing.
   */
  async loadEntry(
    accession: string
  ): Promise<{ sequence?: { sequence?: string } } | undefined> {
    try {
      const response = await fetch(
        `https://www.ebi.ac.uk/proteins/api/proteins/${accession}`
      );
      if (!response.ok) {
        console.warn(
          `[protvista-uniprot] loadEntry: HTTP ${response.status} for '${accession}'.`
        );
        return undefined;
      }
      return await response.json();
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

  /**
   * Render a standalone top-level track (a synthetic single-track group
   * flagged `standalone` by the normalizer) as one row: a plain
   * (non-clickable) track label plus the track content, with no
   * group-collapse affordance. The label affordances and the inner
   * element id (`${CSS_PREFIX}-track-${group.id}-${track.id}`) matches the
   * expanded grouped-track row, so the shared `_loadDataInComponents`
   * data-binding and the `${CSS_PREFIX}-group_${group.id}` visibility
   * toggle work the same way they do for a collapsible group.
   */
  renderStandaloneTrack(group: NormalizedConfig['groups'][number]) {
    const track = group.tracks[0];
    const trackData = track && this.data[`${group.id}-${track.id}`];
    if (
      !track ||
      !trackData ||
      !(
        (Array.isArray(trackData) && trackData.length) ||
        Object.keys(trackData).length
      )
    ) {
      return '';
    }
    const attrs = renderingToAttrs(track.rendering);
    return html`
      <div
        class="${CSS_PREFIX}-group ${CSS_PREFIX}-group--standalone"
        id="${CSS_PREFIX}-group_${group.id}"
      >
        <div
          class="${CSS_PREFIX}-track-label"
          title="${track.description ?? ''}"
        >
          ${(track.filterUI === 'nightingale-filter' &&
            this.getFilterComponent(`${group.id}-${track.id}`)) ||
          (track.labelUrl &&
            this.accession &&
            html`<a
              target="_blank"
              href="${track.labelUrl.replace('{accession}', this.accession)}"
              >${track.label}</a
            >`) ||
          (track.helpPage
            ? html`<span data-article-id="${track.helpPage}"
                >${track.label}</span
              >`
            : track.label)}
        </div>
        <div
          class="${CSS_PREFIX}-track-content ${track.component ===
          'nightingale-colored-sequence'
            ? `${CSS_PREFIX}-track-content__coloured-sequence`
            : ''}"
          data-id="${CSS_PREFIX}-track_${track.id}"
        >
          ${this.getTrack(
            track.component,
            'non-overlapping',
            attrs.color,
            attrs.shape,
            `${group.id}-${track.id}`,
            attrs.scale,
            attrs.colorRange
          )}
        </div>
      </div>
    `;
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
        <div class="${CSS_PREFIX}-nav-container">
          <div class="${CSS_PREFIX}-nav-track-label"></div>
          <div class="${CSS_PREFIX}-track-content">
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
        ${this.config.groups.map((group) => {
          if (!this.data[group.id]) return '';
          // A standalone track (authored as a top-level entry with no
          // `tracks:`) is wrapped by the normalizer in a synthetic
          // single-track group flagged `standalone`. Render it as one
          // row with a plain (non-clickable) track label and no
          // collapse affordance. A genuine one-track group keeps its
          // collapse header — the difference is author-controlled.
          if (group.standalone) {
            return this.renderStandaloneTrack(group);
          }
          // Flatten the structured rendering block onto the plain-string
          // attribute shape Nightingale consumes. Track rendering is
          // already cascaded (defaults → group → kind preset →
          // track), so we don't need the legacy `track.color ||
          // group.color` fallback chain any more.
          const groupAttrs = renderingToAttrs(group.rendering);
          return html`
            <div class="${CSS_PREFIX}-group" id="${CSS_PREFIX}-group_${group.id}">
              <div
                class="${CSS_PREFIX}-group-label"
                data-group-toggle="${group.id}"
                title="${group.description ?? ''}"
                @click="${this.handleGroupClick}"
              >
                ${group.helpPage
                  ? html`<span data-article-id="${group.helpPage}"
                      >${group.label}</span
                    >`
                  : group.label}
              </div>
              <div
                data-id="${CSS_PREFIX}-group_${group.id}"
                class="${CSS_PREFIX}-aggregate-track-content ${CSS_PREFIX}-track-content ${group.component ===
                'nightingale-colored-sequence'
                  ? `${CSS_PREFIX}-track-content__coloured-sequence`
                  : ''}"
                .style="${this.openGroups.includes(group.id)
                  ? 'opacity:0'
                  : 'opacity:1'}"
              >
                ${this.data[group.id] &&
                this.getTrack(
                  group.component,
                  'non-overlapping',
                  groupAttrs.color,
                  groupAttrs.shape,
                  group.id,
                  groupAttrs.scale,
                  groupAttrs.colorRange
                )}
              </div>
            </div>

            <!-- Expanded Groups -->
            ${group.tracks &&
            group.tracks.map((track) => {
              if (this.openGroups.includes(group.id)) {
                const trackData = this.data[`${group.id}-${track.id}`];
                if (
                  !trackData ||
                  !(
                    (Array.isArray(trackData) && trackData.length) ||
                    Object.keys(trackData).length
                  )
                ) {
                  return '';
                }
                const attrs = renderingToAttrs(track.rendering);
                return html`
                  <div
                    class="${CSS_PREFIX}-group__track"
                    id="${CSS_PREFIX}-track_${track.id}"
                  >
                    <div
                      class="${CSS_PREFIX}-track-label"
                      title="${track.description ?? ''}"
                    >
                      ${(track.filterUI === 'nightingale-filter' &&
                        this.getFilterComponent(`${group.id}-${track.id}`)) ||
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
                      class="${CSS_PREFIX}-track-content ${group.component ===
                      'nightingale-colored-sequence'
                        ? `${CSS_PREFIX}-track-content__coloured-sequence`
                        : ''}"
                      data-id="${CSS_PREFIX}-track_${track.id}"
                    >
                      ${this.getTrack(
                        track.component,
                        'non-overlapping',
                        attrs.color,
                        attrs.shape,
                        `${group.id}-${track.id}`,
                        attrs.scale,
                        attrs.colorRange
                      )}
                    </div>
                  </div>
                `;
              }
            })}
          `;
        })}
        <div class="${CSS_PREFIX}-nav-container">
          <div class="${CSS_PREFIX}-credits"></div>
          <div class="${CSS_PREFIX}-track-content">
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

  handleGroupClick(e: MouseEvent) {
    let target = e.target as Element;

    if (target instanceof HTMLSpanElement) {
      target = target.parentElement as Element;
    }

    const toggle = target.getAttribute('data-group-toggle');

    if (toggle && !target.classList.contains('open')) {
      target.classList.add('open');
      this.openGroups = [...this.openGroups, toggle];
    } else {
      target.classList.remove('open');
      this.openGroups = [...this.openGroups].filter((d) => d !== toggle);
    }
  }

  groupByGroup(filters, group) {
    return filters?.filter((f) => f.type.name === group);
  }

  getFilter(filters, filterName) {
    return filters?.filter((f) => f.name === filterName)?.[0];
  }

  // The write target is no longer hardcoded: `trackKey` is threaded in
  // from `getFilterComponent` (via the `@change` binding), and the
  // pristine baseline is read from the loader-written
  // `${trackKey}${UNFILTERED_SUFFIX}` slot — so any track that opts into
  // `filterUI: 'nightingale-filter'` gets the same behaviour regardless
  // of its id.
  //
  // TODO(#variation-filter-hardcoded): two things are still
  // variation-specific — (1) the `consequence` / `provenance` facet set
  // this handler reads, and (2) the `{ sequence, variants }` bundle
  // shape it filters. Non-bundle payloads are skipped by the guard below
  // rather than filtered. Moving the facet definitions plus a
  // shape-agnostic predicate onto the track spec (or into
  // `filter-config.ts`) would let arbitrary filterable tracks opt in.
  handleFilterClick(e: CustomEvent, trackKey: string) {
    const target = e.target as Element as NightingaleFilter;
    const consequenceFilters = this.groupByGroup(target.filters, 'consequence');
    const provenanceFilters = this.groupByGroup(target.filters, 'provenance');

    const selectedFilters = e.detail?.value;
    if (!selectedFilters) return;

    const baseline = this.data[`${trackKey}${UNFILTERED_SUFFIX}`] as
      | { sequence: string; variants: TransformedVariant[] }
      | undefined;
    // `filterUI` is a generic opt-in, so guard against a baseline that is
    // absent (filter fired before the loader ran) or not a variant
    // bundle (e.g. a plain feature array) — either would be silently
    // corrupted by the object-spread write below.
    if (!baseline || !Array.isArray(baseline.variants)) return;

    const selectedConsequenceFilters = selectedFilters
      .map((f) => this.getFilter(consequenceFilters, f))
      .filter(Boolean);
    const selectedProvenanceFilters = selectedFilters
      .map((f) => this.getFilter(provenanceFilters, f))
      .filter(Boolean);

    const filteredVariants = baseline.variants
      .filter((variant) =>
        selectedConsequenceFilters.some((filter) =>
          filter.filterPredicate(variant)
        )
      )
      .filter((variant) =>
        selectedProvenanceFilters.some((filter) =>
          filter.filterPredicate(variant)
        )
      );

    this.data[trackKey] = {
      ...baseline,
      variants: filteredVariants,
    };

    this._loadDataInComponents();
  }

  getGroupTypesAsString(tracks: NormalizedTrack[]) {
    return tracks.map((t) => t.filter).join(',');
  }

  getFilterComponent(forId: string) {
    return html`
      <nightingale-filter
        style="minWidth: 20%"
        for="${CSS_PREFIX}-track-${forId}"
        @change="${(e: CustomEvent) => this.handleFilterClick(e, forId)}"
      ></nightingale-filter>
    `;
  }

  getTrack(
    component: KnownComponentName | string,
    layout = '',
    color = '',
    shape = '',
    id = '',
    scale = '',
    colorRange = ''
  ) {
    // lit-html doesn't allow to have dynamic tag names, hence the switch/case
    // with repeated code
    switch (component) {
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
            id="${CSS_PREFIX}-track-${id}"
            highlight-event="onclick"
            use-ctrl-to-zoom
          >
          </nightingale-track-canvas>
        `;
      case 'nightingale-variation-canvas':
        return html`
          <nightingale-variation-canvas
            length="${this.sequence?.length}"
            height="500"
            display-start="${this.displayCoordinates?.start}"
            display-end="${this.displayCoordinates?.end}"
            id="${CSS_PREFIX}-track-${id}"
            highlight-event="onclick"
            use-ctrl-to-zoom
          >
          </nightingale-variation-canvas>
        `;
      case 'nightingale-linegraph-track':
        return html`
          <nightingale-linegraph-track
            length="${this.sequence?.length}"
            height="50"
            display-start="${this.displayCoordinates?.start}"
            display-end="${this.displayCoordinates?.end}"
            id="${CSS_PREFIX}-track-${id}"
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
            id="${CSS_PREFIX}-track-${id}"
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
            id="${CSS_PREFIX}-track-${id}"
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
