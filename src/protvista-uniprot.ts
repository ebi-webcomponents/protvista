import { LitElement, html, svg } from 'lit';
import { customElement } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { frame } from 'timing-functions';

// Nightingale — type-only imports for the components this file
// queries/narrows against. The constructors are no longer imported
// here: they live in `src/built-in-components.ts` and are defined via
// the registry-driven registration walk (see `_init` / `connectedCallback`).
import type NightingaleTrackCanvas from '@nightingale-elements/nightingale-track-canvas';
import type NightingaleVariationCanvas from '@nightingale-elements/nightingale-variation-canvas';
import type NightingaleSequenceHeatmap from '@nightingale-elements/nightingale-sequence-heatmap';
import type NightingaleFilter from '@nightingale-elements/nightingale-filter';
import type { Filter } from '@nightingale-elements/nightingale-filter';
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
import { featuresCsv } from './schema/adapters/features-csv';
import { featuresTsv } from './schema/adapters/features-tsv';
import { featuresJson } from './schema/adapters/features-json';
import { bed } from './schema/adapters/bed';

import { loadComponent } from './utils';
import {
  STRUCTURAL_COMPONENTS,
  registerBuiltinComponents,
} from './built-in-components';
import {
  loadProtvistaData,
  UNFILTERED_SUFFIX,
  type CustomTrackData,
} from './load-data';
import {
  installClickTooltip,
  type TooltipController,
} from './tooltips/popover';
import { renderLabel } from './tooltips/resolve';

import filterConfig, { colorConfig } from './filter-config';

// Schema-driven config pipeline. The default YAML is
// bundled as a raw string so `js-yaml` stays lazy-loaded — adopters
// who pass a parsed `viewerConfig` object never pull in the parser.
import defaultConfigYaml from './default-config.yaml?raw';
import { loadConfig } from './schema/load';
import { type Registry, createRegistry } from './schema/registry';
import type {
  KnownComponentName,
  ProtvistaViewerConfig,
  AdapterFunction,
  SemanticKindDefinition,
  ColorStop,
} from './schema/types';
import type { NormalizedConfig, NormalizedTrack } from './schema/normalize';
import { renderingToAttrs } from './renderer/render-helpers';

import loaderIcon from './icons/spinner.svg';
import protvistaStyles from './styles/protvista-styles';
import loaderStyles from './styles/loader-styles';
import errorStyles from './styles/error-styles';
import { CSS_PREFIX } from './styles/css-prefix';
import { injectStyleOnce, installTokenDefaults } from './styles/inject';

// User-facing error surfaces. `ConfigValidationError` is a value import
// (used for the `instanceof` narrowing in `_init`'s catch); the display
// formatter is *not* imported here — it is pulled in lazily via
// `await import('./errors/format')` only when a config error actually
// occurs, so the happy path never downloads it.
import { ConfigValidationError, type ValidationIssue } from './schema/errors';
import type { ErrorPhase, ErrorContext } from './errors/report';
import type { FormattedError } from './errors/format';

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
  // Generic-format bring-your-own-data adapters. These are also seeded
  // into the schema Registry via BUILTIN_ADAPTERS (which gates config
  // validation); they must additionally live here because this is the
  // map the loader actually invokes to transform a track's fetched body.
  'features-csv': featuresCsv,
  'features-tsv': featuresTsv,
  'features-json': featuresJson,
  bed,
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

/** How a track's data fetch failed. See `_trackErrors`. */
type FetchErrorKind = 'network' | 'http' | 'parse';

/** A single track's fetch failure, correlated to its group/track. */
type TrackFetchError = {
  url: string;
  kind: FetchErrorKind;
  /** Present only for `kind: 'http'`. */
  status?: number;
  groupId: string;
  trackId: string;
};

/**
 * Outcome of the top-level sequence fetch (`loadEntry`). Either the parsed
 * entry body, or a classified failure — the same `network` / `http` /
 * `parse` taxonomy used per-track, so the mount panel can distinguish a
 * *broken* service (retryable) from a *missing* accession (a 4xx).
 */
type EntryResult =
  | { entry: { sequence?: { sequence?: string } } | undefined; error?: undefined }
  | { entry?: undefined; error: { kind: FetchErrorKind; status?: number } };

const isAbortError = (e: unknown): boolean =>
  (e as { name?: string } | null)?.name === 'AbortError';

/**
 * Whether a value carries something a Nightingale track can actually draw.
 * A bare truthiness check is wrong here: an empty array `[]` and an
 * all-`undefined` aggregate are both truthy yet have nothing to render, so
 * `!!data` would treat a wholly-failed group as if it had data and skip
 * the error row. Arrays must be non-empty; anything else (an object, or a
 * sequence string) must have at least one own key. Mirrors the inline
 * checks it replaces at the three render-gating sites so behaviour is
 * unchanged except for the `[]` / `[undefined]` cases this is fixing.
 */
const hasRenderableData = (value: unknown): boolean => {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value as object).length > 0;
};

/** Monotonic per-page counter giving each element a unique id nonce. */
let protvistaInstanceSeq = 0;

@customElement('protvista-uniprot')
class ProtvistaUniprot extends LitElement {
  private openGroups: string[];
  private nostructure: boolean;
  /**
   * Opt out of the built-in click tooltip. Consumers rendering a React overlay typically set this.
   * @see specs/config-approach.md "React host integration" (and docs/react-integration.md) for the
   * `change`-event listener pattern React hosts pair with this attribute.
   */
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
   * sources below. The renderer reads `NormalizedRow` /
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
   * In-flight `_loadData()` batches, each paired with the key-set it
   * targets (`only`) — or `undefined` for a full load. A new call aborts
   * and drops every batch whose key-set *intersects* its own: a full load
   * (no `only`) intersects everything, and two targeted retries that share
   * a track supersede the older one so the newer write wins. Disjoint
   * targeted retries share no keys, so they run concurrently instead of
   * silently cancelling each other — e.g. Retry clicks on two different
   * badges. The abort guard after the await discards a superseded batch so
   * a stale fetch can't land after and overwrite newer state.
   *
   * Re-entrant callers relying on this: `setTrackData()` firing mid-flight,
   * `_init()` re-running on `suspend`/`accession` change, and
   * `disconnectedCallback` tearing the element out (which aborts all).
   */
  private _loadBatches: Array<{
    controller: AbortController;
    only?: Set<string>;
  }> = [];

  /**
   * Mount-level error state. When set, `render()` shows the alert panel
   * instead of the viewer (or the silent blank it used to show for a
   * config / sequence failure). For a config failure the rich
   * `FormattedError` fields (grouped issues) are filled in after the
   * lazy `./errors/format` chunk resolves; until then the one-line
   * `summary` is enough to render. Not a reactive property (it's an
   * object) — every mutation is paired with `requestUpdate()`.
   */
  private _mountError:
    | ({
        phase: ErrorPhase;
        summary: string;
        /**
         * Offer a Retry button in the panel. Set for a *broken* sequence
         * fetch (network / HTTP 5xx / parse) — a transient service failure
         * worth re-trying in place. A *missing* entry (HTTP 4xx) sets this
         * false: re-fetching a 404 is deterministic.
         */
        retry?: boolean;
        issues?: ValidationIssue[];
      } & Partial<FormattedError>)
    | null = null;

  /**
   * Per-track "broken" fetch failures from the most recent `_loadData()`
   * run, keyed by `${groupId}-${trackId}`. Only genuine failures are
   * recorded — `network` (the request threw before a response — blocked,
   * offline, DNS, CORS, timeout), `parse` (a 2xx response whose body
   * failed to parse), and `http` 5xx (server error). An HTTP 4xx is
   * treated as "missing, not broken" and never recorded (see
   * `_collectTrackErrors`). `status` is present only for `http`.
   */
  private _trackErrors: Map<string, TrackFetchError> = new Map();

  /** Group ids whose *every* track failed (drives badge wording). */
  private _groupErrors: Set<string> = new Set();

  /**
   * Derived error sets, recomputed once per render (in
   * `_recomputeErrorVisibility`) so the badge/gating sites are O(1)
   * lookups. `_visibleGroupErrors` = groups with ≥1 track error;
   * `_anyVisibleError` = whether any track error exists. Every entry in
   * `_trackErrors` is already a broken failure, so these are simply
   * derived from its contents.
   */
  private _visibleGroupErrors: Set<string> = new Set();
  private _anyVisibleError = false;

  /**
   * Per-instance nonce for DOM ids. The component renders in light DOM,
   * so badge `aria-describedby` ids must be unique across multiple
   * `<protvista-uniprot>` elements on one page (two with the same
   * accession + track id would otherwise collide).
   */
  private readonly _instanceId: number = (protvistaInstanceSeq += 1);

  /**
   * Element focused at the moment a mount-level error was reported, so
   * the panel's close button can hand focus back where it came from.
   */
  private _prevFocus: HTMLElement | null = null;

  /**
   * Edge-detects the error panel's open→closed transition in
   * `updated()`, so focus is moved in on appear and restored on
   * dismiss (after Lit has removed the panel from the DOM).
   */
  private _panelWasOpen = false;

  /**
   * Per-instance runtime registry. Seeded with the built-in renderable
   * components (adapters / kinds / themes are seeded by
   * `createRegistry()` itself); consumers extend it through the public
   * `registerComponent` / `registerSemanticKind` / `registerAdapter` /
   * `registerTheme` methods. Passed to `loadConfig` so validation and
   * kind resolution see the consumer's registrations, and read by the
   * registration walk to resolve component names to constructors.
   *
   * One registry per element so custom registrations on one viewer never
   * leak into another on the same page.
   */
  private readonly registry: Registry = createRegistry();

  constructor() {
    super();
    registerBuiltinComponents(this.registry);
    this.openGroups = [];
    this.nostructure = false;
    this.hasData = false;
    this.loading = true;
    this.data = {};
    this.rawData = {};
    this.displayCoordinates = {};
    this.addStyles();
  }

  // ── Runtime extension API (ProtvistaRuntimeAPI) ─────────────
  // Thin delegates onto this element's registry. Call these before the
  // config loads (e.g. right after creating the element) so custom
  // names are known when `loadConfig` validates and normalizes.

  /** Register a custom adapter so config can reference it by name. */
  registerAdapter(name: string, fn: AdapterFunction): void {
    this.registry.registerAdapter(name, fn);
  }

  /** Register a custom semantic kind (component + adapter + rendering). */
  registerSemanticKind(name: string, def: SemanticKindDefinition): void {
    this.registry.registerSemanticKind(name, def);
  }

  /** Register a custom colour-scale theme. */
  registerTheme(name: string, stops: ColorStop[]): void {
    this.registry.registerTheme(name, stops);
  }

  /**
   * Register a custom component so a semantic kind (or explicit
   * `component:`) resolving to `name` gets its tag defined by the
   * registration walk — no consumer `customElements.define()` needed.
   */
  registerComponent(name: string, ctor: CustomElementConstructor): void {
    this.registry.registerComponent(name, ctor);
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
    // <protvista-uniprot-structure> rather than duplicated. The error
    // surface carries its own key too. (Multi-instance isolation — unique
    // DOM ids, scoped tooltip popovers, etc. — is tracked separately as a
    // next-branch issue.)
    installTokenDefaults();
    injectStyleOnce('loader', loaderStyles.toString());
    injectStyleOnce('viewer', protvistaStyles.toString());
    injectStyleOnce('error', errorStyles.toString());
  }

  /**
   * Define the structural chrome tags the template always emits
   * (`nightingale-manager`, `-navigation`, `-sequence`, `-filter`, and
   * the structure viewer). These are not config-selectable, so they are
   * registered directly from `STRUCTURAL_COMPONENTS` rather than via the
   * registry walk. `loadComponent` skips any tag already defined.
   */
  private registerStructuralComponents() {
    for (const [name, ctor] of STRUCTURAL_COMPONENTS) {
      loadComponent(name, ctor);
    }
  }

  /**
   * Apply author-set chrome colours from `config.theme` as inline
   * `--protvista-*` custom properties on the host. Because they are set
   * *inline on this element*, a config `theme` takes precedence over the
   * `:where(:root)` token defaults AND ordinary page CSS — an inherited
   * `:root` value or an element-selector rule both lose to an inline
   * declaration (see the precedence note in src/styles/inject.ts). A host
   * that must override a config theme uses `!important` (or sets the token
   * inline itself). A no-code theming shortcut — the tokens are documented
   * in docs/theming.md.
   */
  private applyTheme(theme: NormalizedConfig['theme']) {
    if (!theme) return;
    if (theme.labelColor) {
      // The row-label side panel: group + track label backgrounds.
      this.style.setProperty('--protvista-group-label-bg', theme.labelColor);
      this.style.setProperty('--protvista-track-label-bg', theme.labelColor);
    }
    if (theme.accentColor) {
      this.style.setProperty('--protvista-color-accent', theme.accentColor);
    }
  }

  /**
   * Define the components the resolved config actually references. Walks
   * every group's and track's resolved `component`, looks the
   * constructor up in the registry, and defines the tag via
   * `loadComponent` (which no-ops for already-defined tags). This is the
   * seam that lets a consumer-registered component reach
   * `customElements.define()` without the embedder calling it directly.
   */
  private registerConfigComponents(config: NormalizedConfig) {
    const names = new Set<string>();
    for (const row of config.rows) {
      names.add(row.component);
      for (const track of row.tracks) names.add(track.component);
    }
    for (const name of names) {
      const ctor = this.registry.getComponent(name);
      if (ctor) loadComponent(name, ctor);
      // A missing ctor means a config referenced a component name with no
      // registered constructor. Validation (unknown-component) catches
      // this before mount, so reaching here is unexpected — leave the tag
      // undefined rather than throwing mid-render.
    }
  }

  /**
   * Load (or reload) track data. With `only` set (a set of
   * `${groupId}-${trackId}` keys), only those tracks are re-fetched and
   * their results spliced into the existing `data` — the targeted-retry
   * path. Without it, every track is loaded.
   */
  async _loadData(only?: Set<string>) {
    const accession = this.accession;
    if (!accession || !this.config) {
      this.loading = false;
      this.requestUpdate();
      return;
    }

    // Abort and forget every in-flight batch this call supersedes: one
    // whose key-set intersects ours (a full load — no `only` — intersects
    // everything). Disjoint targeted retries share no keys, so they keep
    // running. Without this, a single shared AbortController meant any
    // second `_loadData()` silently aborted the first, so two Retry clicks
    // on different badges left the earlier badge stale — no data, no
    // error, no event, no feedback.
    const intersects = (batch: { only?: Set<string> }): boolean => {
      if (!only || !batch.only) return true;
      for (const key of only) if (batch.only.has(key)) return true;
      return false;
    };
    this._loadBatches = this._loadBatches.filter((batch) => {
      if (intersects(batch)) {
        batch.controller.abort();
        return false;
      }
      return true;
    });
    const controller = new AbortController();
    const batch = { controller, only };
    this._loadBatches.push(batch);
    const { signal } = controller;

    // Records HTTP 4xx/5xx fetch failures for this batch, keyed by the
    // *substituted* URL the closure was handed — the same URLs the loader
    // reports back in `trackUrls`, so `_collectTrackErrors` can correlate
    // failures to tracks without re-deriving anything. The closure still
    // logs to the console unconditionally (preserving legacy behaviour);
    // this map is what feeds the user-facing badges and the
    // `protvista-error` event.
    const fetchErrors = new Map<
      string,
      Omit<TrackFetchError, 'groupId' | 'trackId'>
    >();

    const { rawData, data, hasData, trackUrls } = await loadProtvistaData(
      accession,
      this.config,
      // Preserve the legacy fetchAll semantics: 4xx/5xx and thrown
      // errors are swallowed with a warning, leaving a null in the
      // per-URL slot. `AbortError` thrown by a later `_loadData()`
      // re-entry is recognised and silently returned as `null` so it
      // doesn't pollute the console.
      async (url, responseType) => {
        // Three distinct failure modes are recorded so the badge / event
        // can tell "couldn't reach the server" from "server said 500"
        // from "unparseable body". Each still returns `null` into the
        // per-URL slot (legacy swallow-and-continue). `AbortError` from a
        // superseding `_loadData()` re-entry is silently ignored.
        let response: Response;
        try {
          response = await fetch(url, { signal });
        } catch (error) {
          if (isAbortError(error)) return null;
          console.warn(`Failed to fetch from ${url}:`, error);
          fetchErrors.set(url, { url, kind: 'network' });
          return null;
        }
        if (!response.ok) {
          console.warn(`HTTP error status: ${response.status} at ${url}`);
          fetchErrors.set(url, { url, kind: 'http', status: response.status });
          return null;
        }
        // Delimited generic-format bodies (features-csv / features-tsv / bed)
        // are handed to their adapter as raw text; everything else — including
        // the JSON-body generic-format adapter (features-json) — is parsed
        // as JSON. `response.text()` does not reject on content, so the
        // parse-failure branch below only guards the JSON path.
        if (responseType === 'text') {
          try {
            return await response.text();
          } catch (error) {
            if (isAbortError(error)) return null;
            console.warn(`Failed to read text from ${url}:`, error);
            fetchErrors.set(url, { url, kind: 'parse' });
            return null;
          }
        }
        try {
          return await response.json();
        } catch (error) {
          if (isAbortError(error)) return null;
          console.warn(`Failed to parse JSON from ${url}:`, error);
          fetchErrors.set(url, { url, kind: 'parse' });
          return null;
        }
      },
      adapters,
      this.customTrackData,
      only ? { only, previousData: this.data } : undefined
    );

    // If a newer load started while we were awaiting, drop the result
    // on the floor — the newer call owns subsequent state writes.
    if (signal.aborted) return;

    // Correlate the "broken" fetch failures back to the tracks/groups
    // that own them (4xx is skipped as "missing" — see
    // `_collectTrackErrors`). Done after the abort guard so a stale batch
    // can't clobber a newer batch's error maps. A targeted retry passes
    // `only` so it updates just those tracks' error state.
    this._collectTrackErrors(trackUrls, fetchErrors, only);

    // A targeted retry only carries the reloaded URLs' raw responses —
    // merge so the rest of `rawData` survives; a full load replaces it.
    this.rawData = only ? { ...this.rawData, ...rawData } : rawData;
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
    const merged: Record<string, unknown> = { ...this.data, ...data };
    // Drop stale per-track entries for tracks this batch (re)loaded but
    // the loader intentionally produced no data for — a failed fetch, or
    // an adapter that early-returns on an empty payload (e.g. variation).
    // Without this, the merge above would keep the *previous* run's data,
    // so a failed retry — or a switch to an accession whose track fails —
    // would render stale content under an error badge. Only per-track
    // keys of the (re)loaded set are cleared; group aggregates and
    // un-reloaded tracks are untouched.
    const reloadedKeys =
      only ??
      new Set(
        this.config.rows.flatMap((g) =>
          g.tracks.map((t) => `${g.id}-${t.id}`)
        )
      );
    for (const key of reloadedKeys) {
      if (!(key in data)) delete merged[key];
    }

    // Recompute each reloaded group's aggregate from the LIVE merged
    // per-track values rather than the loader's snapshot-derived
    // `data[groupId]`. Two concurrent targeted retries on different tracks
    // of the *same* group each snapshot `this.data` (as `previousData`)
    // before either commits, so the loader's aggregate for the later batch
    // omits the earlier batch's just-recovered sibling — and merging its
    // `data[groupId]` would clobber the aggregate, silently dropping a
    // track. Rebuilding from the merged per-track keys is order-independent
    // and self-consistent (and a no-op for a full load). Mirrors the
    // loader's per-component aggregate rule.
    for (const group of this.config.rows) {
      const touched = group.tracks.some((t) =>
        reloadedKeys.has(`${group.id}-${t.id}`)
      );
      if (!touched) continue;
      const trackValues = group.tracks.map((t) => merged[`${group.id}-${t.id}`]);
      merged[group.id] =
        group.component === 'nightingale-linegraph-track' ||
        group.component === 'nightingale-colored-sequence'
          ? trackValues[0]
          : trackValues.flat().filter((entry) => entry != null);
    }
    this.data = merged;

    // The variation filter's pristine baseline now rides along in
    // `data` under `${groupId}-${trackId}${UNFILTERED_SUFFIX}` for any
    // track that opts into `filterUI: 'nightingale-filter'` — written by
    // the loader, consumed by `handleFilterClick`. No id-based copy step
    // is needed here anymore.

    // Drop ourselves from the in-flight set. A superseding call would have
    // aborted us and the guard above would have returned early, so
    // reaching here means we still own our writes.
    this._loadBatches = this._loadBatches.filter((b) => b !== batch);

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
      const currentGroup = this.config?.rows.find((c) => c.id === id);
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

    // Groups are `display: none` by default (see protvista-styles.ts) and
    // revealed imperatively above only when they have data. A group that
    // has *no* data but a visible fetch error still renders its header +
    // ⚠ badge (via `renderGroupErrorRow`, or the normal path with an
    // empty aggregate) — reveal those too, or the error indicator stays
    // hidden and the group looks like it vanished.
    for (const groupId of this._visibleGroupErrors) {
      const groupElt = this.findById<HTMLElement>(
        `${CSS_PREFIX}-group_${groupId}`
      );
      if (groupElt) {
        groupElt.style.display = 'flex';
      }
    }
  }

  updated(changedProperties: Map<string, string>) {
    super.updated(changedProperties);

    // Error-panel focus management. Kept at the very top so the early
    // returns below (suspend / accession change) can't skip it. On
    // appear, move focus into the alert panel once; on dismiss, restore
    // it to whatever was focused when the error was reported — done here
    // (not in the close handler) so the panel is already gone from the
    // DOM this cycle, avoiding focus landing on an unmounting node
    // (mirrors the popover controller's restore).
    const panelOpen = this._mountError !== null;
    if (panelOpen && !this._panelWasOpen) {
      this.querySelector<HTMLElement>(`.${CSS_PREFIX}-error-panel`)?.focus({
        preventScroll: true,
      });
    } else if (!panelOpen && this._panelWasOpen) {
      if (this._prevFocus && this._prevFocus.isConnected) {
        this._prevFocus.focus({ preventScroll: true });
      }
      this._prevFocus = null;
    }
    this._panelWasOpen = panelOpen;

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
        this.applyTheme(normalized.theme);
        // Define the components this config references (built-in or
        // consumer-registered) now that the resolved set is known. Runs
        // once per fresh config; re-inits (accession change / retry)
        // re-enter with `config` already set and skip this block —
        // `loadComponent` would no-op anyway.
        this.registerConfigComponents(normalized);
        // A now-valid config clears a stale config-error panel from a
        // previous attempt.
        if (this._mountError?.phase === 'config') {
          this._mountError = null;
          this.requestUpdate();
        }
      } catch (err) {
        // Validation / parse errors are surfaced on the console so
        // authors see the full `ConfigValidationError.issues[]` list
        // (developer channel, unchanged), AND routed through the shared
        // reporter so the user-facing alert panel and the
        // `protvista-error` event fire too. A config failure is always a
        // mount-level failure — there is no config to render past.
        const issues =
          err instanceof ConfigValidationError ? err.issues : [];
        const panelSummary = issues.length
          ? `Config validation failed (${issues.length} issue${issues.length === 1 ? '' : 's'})`
          : `Failed to load config: ${err instanceof Error ? err.message : String(err)}`;
        this.reportError('config', {
          consoleLevel: 'error',
          message: '[protvista-uniprot] Failed to load config.',
          consoleArgs: [err],
          issues,
          mountFailure: true,
          panelSummary,
        });
        // Upgrade the panel to the rich, path-grouped rendering. The
        // formatter is lazy so the happy path never downloads it. Guard
        // against an accession swap re-running `_init()` and replacing
        // `_mountError` while we awaited the chunk.
        if (issues.length) {
          const { formatValidationIssues } = await import('./errors/format');
          if (this._mountError?.phase === 'config') {
            this._mountError = {
              phase: 'config',
              ...formatValidationIssues(issues),
            };
            this.requestUpdate();
          }
        }
        this.loading = false;
        this.requestUpdate();
        return;
      }
    }

    if (!this.accession) return;
    this.loadEntry(this.accession)
      .then((result) => {
        const seq = result.entry?.sequence?.sequence;
        if (typeof seq === 'string' && seq.length > 0) {
          this.sequence = seq;
          this.displayCoordinates = { start: 1, end: this.sequence.length };
          // A now-valid accession clears any stale sequence-level panel
          // left over from a previous (bad-accession) attempt.
          if (this._mountError?.phase === 'sequence') {
            this._mountError = null;
            this.requestUpdate();
          }
          return;
        }
        // No usable sequence: distinguish *broken* (the service failed —
        // network / HTTP 5xx / unparseable — so the identifier may be
        // fine and a Retry is worth offering) from *missing* (an HTTP 4xx,
        // or a 2xx body with no sequence field — this accession has no
        // usable entry, so point the user at the identifier). This mirrors
        // the per-track broken-vs-missing model; the mount can't hide
        // itself, so both still render a panel — only the wording and the
        // Retry affordance differ.
        this._reportSequenceFailure(result.error);
      })
      .catch((err) => {
        // `loadEntry` classifies every expected failure itself, but an
        // unexpected throw could still escape. Without this handler the
        // rejection would surface as an unhandled promise rejection in the
        // host page's console. Treat it as a broken (retryable) failure.
        this.reportError('sequence', {
          consoleLevel: 'warn',
          message: `[protvista-uniprot] Unexpected error from loadEntry for '${this.accession}':`,
          panelSummary: `Couldn't load '${this.accession}' — the UniProt data service is unreachable or failing. This is usually temporary.`,
          consoleArgs: [err],
          context: { accession: this.accession },
          mountFailure: true,
          retry: true,
        });
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
    const loadOpts = { accession: this.accession, registry: this.registry };
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
      this.reportError('set-track-data', {
        consoleLevel: 'warn',
        message: `[protvista-uniprot] setTrackData: expected an array or plain object for '${groupId}/${trackId}', got ${data === null ? 'null' : typeof data}. Call ignored.`,
        context: { groupId, trackId },
      });
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

    const group = this.config.rows.find((c) => c.id === groupId);
    const track = group?.tracks.find((t) => t.id === trackId);
    if (!track) {
      this.reportError('set-track-data', {
        consoleLevel: 'warn',
        message: `[protvista-uniprot] setTrackData: track '${groupId}/${trackId}' not found in config.`,
        context: { groupId, trackId },
      });
      return;
    }
    const firstSource = track.data[0];
    if (firstSource?.from !== 'custom') {
      this.reportError('set-track-data', {
        consoleLevel: 'warn',
        message: `[protvista-uniprot] setTrackData: track '${groupId}/${trackId}' is not 'from: custom' (found '${firstSource?.from ?? 'undefined'}'). Injected data discarded; edit the config to change this track's data source.`,
        context: { groupId, trackId },
      });
      return;
    }

    // Post-mount: re-run the pipeline so the new data propagates
    // through filter / tooltip resolution and into the Nightingale
    // components. `_loadData()` already handles `this.loading` and
    // `this.requestUpdate()`.
    this._loadData();
  }

  /**
   * The single seam through which every error reaches a user. It keeps
   * the developer channel intact (the same `console.warn`/`console.error`
   * text as before, via `opts.message`) AND adds the two user channels:
   * the bubbling `protvista-error` event (always dispatched, so an
   * embedder wires one listener for every flavour) and — when the error
   * is fatal to the mount (`config`/`sequence`) or `strict` is on — the
   * visible alert panel.
   *
   * Per-track fetch failures pass through here too (for the event); their
   * visible surface is the `⚠` badge rendered from `_trackErrors`, and
   * they only raise the panel under `strict`.
   */
  private reportError(
    phase: ErrorPhase,
    opts: {
      /** The exact console string used today — keeps dev + user text in lockstep. */
      message: string;
      consoleLevel: 'warn' | 'error';
      /** Populated for `config`; forwarded on the event as `detail.issues`. */
      issues?: ValidationIssue[];
      /** Forwarded on the event as `detail.context` (merged over `{ accession }`). */
      context?: ErrorContext;
      /** Extra args appended to the `console.*` call (e.g. the caught error). */
      consoleArgs?: unknown[];
      /** Force the mount panel regardless of `strict` (used by `config`/`sequence`). */
      mountFailure?: boolean;
      /** Skip the console line (the caller already logged it — e.g. the fetch closure). */
      skipConsole?: boolean;
      /** User-friendly panel summary when it should differ from `message`. */
      panelSummary?: string;
      /**
       * Offer a Retry button on the promoted mount panel (broken, transient
       * failures — see `_mountError.retry`). Ignored when the error isn't
       * promoted to the panel.
       */
      retry?: boolean;
      /**
       * Suppress the mount-panel promotion even under `strict`. Used by
       * the per-track correlation pass, which fires one event per failed
       * track but raises a single *aggregated* panel afterwards rather
       * than letting each track overwrite the last.
       */
      skipPanel?: boolean;
    }
  ): void {
    if (!opts.skipConsole) {
      console[opts.consoleLevel](opts.message, ...(opts.consoleArgs ?? []));
    }

    this.dispatchEvent(
      new CustomEvent('protvista-error', {
        detail: {
          phase,
          issues: opts.issues ?? [],
          context: { accession: this.accession, ...opts.context },
        },
        bubbles: true,
      })
    );

    const promote =
      !opts.skipPanel && (opts.mountFailure || (this.config?.strict ?? false));
    if (promote) {
      this._setMountError(
        phase,
        opts.panelSummary ?? opts.message.split('\n')[0],
        opts.issues,
        opts.retry
      );
    }
    this.requestUpdate();
  }

  /**
   * Raise the mount-level alert panel, capturing the currently-focused
   * element first so the dismiss control can hand focus back (mirrors
   * `popover.ts`). Shared by `reportError`'s promotion path and the
   * aggregated per-track panel in `_collectTrackErrors`.
   */
  private _setMountError(
    phase: ErrorPhase,
    summary: string,
    issues?: ValidationIssue[],
    retry?: boolean
  ): void {
    // Capture the focus-restore target only on the closed→open
    // transition. A re-entrant call while the panel is already open (under
    // `strict`, `_collectTrackErrors` re-raises the aggregated panel on
    // every `_loadData()` batch while failures persist) must NOT
    // re-capture: focus has by then been moved into the panel itself, and
    // recording the panel as `_prevFocus` would break the "restore focus
    // to the pre-error element" contract when the panel is dismissed (the
    // panel is gone by then, so the restore silently no-ops to <body>).
    if (this._mountError === null) {
      const active = document.activeElement;
      this._prevFocus =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
    }
    this._mountError = { phase, summary, issues, retry };
  }

  /**
   * Raise the mount-level sequence panel, choosing wording + affordance by
   * the failure's classification. *Broken* (network / HTTP 5xx / parse) is
   * a transient service failure — the accession may be valid, so offer a
   * Retry. *Missing* (HTTP 4xx, or a 2xx body with no `sequence`) means the
   * entry doesn't exist — point the user at the identifier, no Retry.
   */
  private _reportSequenceFailure(error?: {
    kind: FetchErrorKind;
    status?: number;
  }): void {
    const broken =
      error !== undefined &&
      (error.kind === 'network' ||
        error.kind === 'parse' ||
        (error.kind === 'http' && (error.status ?? 0) >= 500));
    const panelSummary = broken
      ? `Couldn't load '${this.accession}' — the UniProt data service is unreachable or failing. This is usually temporary.`
      : `No UniProt entry found for '${this.accession}'. Check that the accession is correct.`;
    this.reportError('sequence', {
      consoleLevel: 'warn',
      message: `[protvista-uniprot] loadEntry returned no usable sequence for '${this.accession}'. Rendering empty-state.`,
      panelSummary,
      context: {
        accession: this.accession,
        ...(error?.kind ? { errorKind: error.kind } : {}),
        ...(error?.status !== undefined ? { status: error.status } : {}),
      },
      mountFailure: true,
      retry: broken,
    });
    this.loading = false;
    this.requestUpdate();
  }

  /**
   * Retry a *broken* mount failure in place: clear the panel, show the
   * loader, and re-run `_init()`. The config guard in `_init()` skips the
   * already-loaded config, so this re-fetches the sequence and every track
   * — the whole mount was broken, so a full re-fetch is what we want.
   */
  private _retryMount(): void {
    this._mountError = null;
    this.loading = true;
    this.requestUpdate();
    this._init();
  }

  /**
   * Correlate the batch's fetch failures (keyed by substituted URL) back
   * to the tracks that own them, and flag groups whose every track
   * failed. `trackUrls` is the authoritative per-track URL map returned
   * by `loadProtvistaData` (the loader is the single source of truth for
   * which URL each track fetched), so the component no longer re-derives
   * the substitution. Fires one `track-fetch` event per failed track
   * (`skipConsole` — the fetch closure already logged the status;
   * `skipPanel` — the panel is raised once, aggregated, below).
   */
  private _collectTrackErrors(
    trackUrls: Record<string, string[]>,
    fetchErrors: Map<string, Omit<TrackFetchError, 'groupId' | 'trackId'>>,
    only?: Set<string>
  ): void {
    if (!this.config) {
      this._trackErrors = new Map();
      this._groupErrors = new Set();
      this.requestUpdate();
      return;
    }

    // A targeted retry only clears the errors of the tracks it reloaded,
    // preserving every other track's error; a full load resets the map.
    if (only) {
      for (const key of only) this._trackErrors.delete(key);
    } else {
      this._trackErrors = new Map();
    }

    // Correlate this batch's "broken" fetch failures to the tracks that
    // own them. Untouched tracks aren't in `trackUrls` on a partial
    // reload, so their errors (cleared above only for the reloaded set)
    // are left intact.
    //
    // An HTTP 4xx is NOT a track error: for a per-entity endpoint it means
    // "this accession has no data of this kind" (a 404 is the common
    // case). We want the viewer to flag things that are *broken*, not
    // *missing* — so a 4xx is treated exactly like an empty response: the
    // track simply has no data and is hidden, with no badge, event, or
    // panel. Only `network`, `parse`, and HTTP `5xx` are recorded.
    for (const group of this.config.rows) {
      for (const track of group.tracks) {
        const key = `${group.id}-${track.id}`;
        const hit = (trackUrls[key] ?? []).find((u) => fetchErrors.has(u));
        if (!hit) continue;
        const err = fetchErrors.get(hit)!;
        if (err.kind === 'http' && (err.status ?? 0) < 500) continue; // missing, not broken
        this._trackErrors.set(key, {
          ...err,
          groupId: group.id,
          trackId: track.id,
        });
      }
    }

    // Recompute the "every track failed" set from the final error map.
    this._groupErrors = new Set();
    for (const group of this.config.rows) {
      if (
        group.tracks.length > 0 &&
        group.tracks.every((t) =>
          this._trackErrors.has(`${group.id}-${t.id}`)
        )
      ) {
        this._groupErrors.add(group.id);
      }
    }

    // Fire one event per track that (re)failed in THIS batch — for a
    // partial reload, only the reloaded tracks that still fail.
    const failedKeys = [...this._trackErrors.keys()].filter(
      (k) => !only || only.has(k)
    );
    for (const key of failedKeys) {
      const err = this._trackErrors.get(key)!;
      this.reportError('track-fetch', {
        consoleLevel: 'warn',
        message: this._describeFetchError(err),
        context: {
          groupId: err.groupId,
          trackId: err.trackId,
          url: err.url,
          errorKind: err.kind,
          ...(err.status !== undefined ? { status: err.status } : {}),
        },
        skipConsole: true, // the fetch closure already logged this line
        skipPanel: true, // the aggregated panel below replaces per-track ones
      });
    }

    // Under `strict`, keep ONE aggregated panel in sync with the current
    // error set — raised/refreshed while failures remain, cleared once a
    // (re)load resolves them all.
    if (this.config.strict ?? false) {
      if (this._trackErrors.size > 0) {
        const errs = [...this._trackErrors.values()];
        const summary =
          errs.length === 1
            ? `Track '${errs[0].groupId}/${errs[0].trackId}' failed to load — ${this._describeFetchError(errs[0])}.`
            : `${errs.length} tracks failed to load.`;
        // Offer Retry when at least one failure is recoverable (network /
        // HTTP 5xx) — mirrors the per-badge affordance so the strict panel
        // isn't the one place a transient failure can't be retried in
        // place. The panel's Retry re-runs the whole load (`_retryMount`),
        // which is the right scope: the panel has replaced the entire
        // viewer, so there's no partial UI to preserve.
        const retryable = errs.some((e) => this._isRecoverable(e));
        this._setMountError('track-fetch', summary, undefined, retryable);
      } else if (this._mountError?.phase === 'track-fetch') {
        this._mountError = null;
      }
    }
    this.requestUpdate();
  }

  /** Human-readable one-liner for a track fetch failure. */
  private _describeFetchError(err: TrackFetchError): string {
    switch (err.kind) {
      case 'network':
        return `Couldn't reach ${err.url}`;
      case 'parse':
        return `Unparseable response from ${err.url}`;
      default:
        return `HTTP ${err.status} — ${err.url}`;
    }
  }

  /**
   * Recompute the derived error sets from `_trackErrors` in a single
   * O(trackErrors) pass. Called once at the top of `render()` so the
   * badge/gating sites become O(1) lookups. Every entry in `_trackErrors`
   * is a "broken" failure (4xx is filtered out at collection time as
   * "missing"), so all of them surface — there is no per-error
   * visibility check.
   */
  private _recomputeErrorVisibility(): void {
    this._visibleGroupErrors = new Set();
    this._anyVisibleError = this._trackErrors.size > 0;
    for (const err of this._trackErrors.values()) {
      this._visibleGroupErrors.add(err.groupId);
    }
  }

  connectedCallback() {
    super.connectedCallback();
    markOnce('protvista:script-start');
    this.registerStructuralComponents();

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
    // Cancel every still-running fetch batch so the detached element
    // can't commit state writes back into a no-longer-mounted DOM.
    for (const batch of this._loadBatches) batch.controller.abort();
    this._loadBatches = [];
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
  async loadEntry(accession: string): Promise<EntryResult> {
    // Three-branch classification mirroring the per-track fetch closure so
    // the mount panel can tell *broken* (network / HTTP 5xx / unparseable —
    // the service is down, offer Retry) from *missing* (HTTP 4xx — this
    // accession has no entry, verify the identifier). The developer
    // `console.*` lines are preserved verbatim.
    let response: Response;
    try {
      response = await fetch(
        `https://www.ebi.ac.uk/proteins/api/proteins/${accession}`
      );
    } catch (e) {
      console.error(`Couldn't load UniProt entry`, e);
      return { error: { kind: 'network' } };
    }
    if (!response.ok) {
      console.warn(
        `[protvista-uniprot] loadEntry: HTTP ${response.status} for '${accession}'.`
      );
      return { error: { kind: 'http', status: response.status } };
    }
    try {
      return { entry: await response.json() };
    } catch (e) {
      console.error(`Couldn't load UniProt entry`, e);
      return { error: { kind: 'parse' } };
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
   * element id (`${CSS_PREFIX}-track-${group.id}-${track.id}`) match the
   * expanded grouped-track row, so the shared `_loadDataInComponents`
   * data-binding and the `${CSS_PREFIX}-group_${group.id}` visibility
   * toggle work unchanged. Every wrapper class/id carries `CSS_PREFIX`
   * for parity with the grouped path (so the `.${CSS_PREFIX}-group` /
   * `-track-label` / `-track-content` rules apply here too).
   */
  renderStandaloneTrack(group: NormalizedConfig['rows'][number]) {
    const track = group.tracks[0];
    const trackData = track && this.data[`${group.id}-${track.id}`];
    if (!track || !hasRenderableData(trackData)) {
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
          unsafeHTML(renderLabel(track.label, this.accession))}
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
    // Suspend still wins over everything (unchanged semantics).
    if (this.suspend) {
      return html``;
    }
    // Mount-level error panel BEFORE the readiness gate: config /
    // sequence failures leave `config` / `sequence` unset, so the old
    // gate below would have hidden the panel behind a blank render.
    if (this._mountError) {
      return this.renderErrorPanel();
    }
    // Component isn't ready
    if (!this.sequence || !this.config) {
      return html``;
    }
    if (this.loading) {
      return html`<div class="protvista-loader">
        ${svg`${unsafeHTML(loaderIcon)}`}
      </div>`;
    }
    // Derive error visibility once for this render — every group/track
    // badge decision below reads the precomputed sets.
    this._recomputeErrorVisibility();
    if (!this.hasData) {
      // Fall through to the viewer only when there's a *visible* track
      // error to show a badge for; otherwise the blanket no-results
      // message (the silent-hide path) stands.
      if (!this._anyVisibleError) {
        return html`<div class="protvista-no-results">
          No feature data available for ${this.accession}
        </div>`;
      }
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
        ${this.config.rows.map((group) => {
          const groupHasData = hasRenderableData(this.data[group.id]);
          const groupHasError = this._visibleGroupErrors.has(group.id);
          if (!groupHasData && !groupHasError) return '';
          // Group has a visible fetch failure but no aggregate to draw (all
          // or some tracks failed). While it's collapsed, render just the
          // header + badge so the failure stays visible; handles standalone
          // (never expandable) and collapsed grouped tracks alike. When
          // it's expanded, fall through instead so the per-track rows —
          // each with its own ⚠ badge and Retry — render; those are more
          // informative than a single group-level badge.
          if (
            !groupHasData &&
            groupHasError &&
            !this.openGroups.includes(group.id)
          ) {
            return this.renderGroupErrorRow(group);
          }
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
                ${unsafeHTML(
                  renderLabel(group.label, this.accession)
                )}${this._renderGroupBadge(group.id)}
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
                ${hasRenderableData(this.data[group.id])
                  ? this.getTrack(
                      group.component,
                      'non-overlapping',
                      groupAttrs.color,
                      groupAttrs.shape,
                      group.id,
                      groupAttrs.scale,
                      groupAttrs.colorRange
                    )
                  : ''}
              </div>
            </div>

            <!-- Expanded Groups -->
            ${group.tracks &&
            group.tracks.map((track) => {
              if (this.openGroups.includes(group.id)) {
                const trackKey = `${group.id}-${track.id}`;
                const trackData = this.data[trackKey];
                const trackHasData = hasRenderableData(trackData);
                const trackHasError = this._trackErrors.has(trackKey);
                // A track with neither data nor a (broken) error renders
                // nothing — this is also the 4xx "missing" path.
                if (!trackHasData && !trackHasError) {
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
                      unsafeHTML(
                        renderLabel(track.label, this.accession)
                      )}${this._renderTrackBadge(trackKey)}
                    </div>
                    ${trackHasData
                      ? html`<div
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
                        </div>`
                      : ''}
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

  /**
   * The mount-level alert panel. Replaces the whole viewer whenever
   * `_mountError` is set (config / sequence failure, or any promoted
   * warning under `strict`). `role="alert"` (which already implies an
   * assertive live region — we deliberately do NOT add a conflicting
   * `aria-live`) and `tabindex="-1"` so `updated()` can move focus in.
   */
  private renderErrorPanel() {
    const err = this._mountError;
    if (!err) return html``;
    const raw = err.raw ?? err.issues ?? [];
    const count = raw.length;
    // Only offer a dismiss control when there is a working viewer to
    // return to. A config / sequence failure leaves the component
    // unrenderable (no config or no sequence), so dismissing would just
    // reveal a blank element — omit the control for those. A warning
    // promoted under `strict` (config + sequence loaded fine) stays
    // dismissible so the author can reveal the partial viewer.
    const dismissible = !!(this.sequence && this.config);
    // Retry is offered for a broken (transient) failure — even when the
    // panel isn't dismissible (a broken sequence fetch leaves no viewer to
    // reveal, but re-fetching in place is exactly the recovery we want).
    const retryable = !!err.retry;
    return html`
      <div class="${CSS_PREFIX}-error-panel" role="alert" tabindex="-1">
        <div class="${CSS_PREFIX}-error-panel__head">
          <p class="${CSS_PREFIX}-error-panel__summary">${err.summary}</p>
          ${dismissible || retryable
            ? html`<div class="${CSS_PREFIX}-error-panel__actions">
                ${retryable
                  ? html`<button
                      type="button"
                      class="${CSS_PREFIX}-error-retry"
                      @click="${() => this._retryMount()}"
                    >
                      Retry
                    </button>`
                  : ''}
                ${dismissible
                  ? html`<button
                      type="button"
                      aria-label="Dismiss error"
                      @click="${() => this._dismissError()}"
                    >
                      Dismiss
                    </button>`
                  : ''}
              </div>`
            : ''}
        </div>
        ${err.groups && err.groups.length
          ? html`<details class="${CSS_PREFIX}-error-issues" open>
              <summary>${count} issue${count === 1 ? '' : 's'}</summary>
              ${err.groups.map(
                (g) => html`
                  <div class="${CSS_PREFIX}-error-issue">
                    <div class="${CSS_PREFIX}-error-issue__path">${g.path}</div>
                    ${g.items.map(
                      (it) => html`<div>
                        ${it.message}
                        <span class="${CSS_PREFIX}-error-issue__code"
                          >(${it.code})</span
                        >
                      </div>`
                    )}
                  </div>
                `
              )}
            </details>`
          : ''}
      </div>
    `;
  }

  /**
   * Minimal group row shown when a group has a visible fetch failure but
   * no data to draw: the header label plus a `⚠` badge, no content. Keeps
   * the failure visible even while the group is collapsed.
   */
  private renderGroupErrorRow(group: NormalizedConfig['rows'][number]) {
    return html`
      <div class="${CSS_PREFIX}-group" id="${CSS_PREFIX}-group_${group.id}">
        <div
          class="${CSS_PREFIX}-group-label"
          title="${group.description ?? ''}"
        >
          ${unsafeHTML(
            renderLabel(group.label, this.accession)
          )}${this._renderGroupBadge(group.id)}
        </div>
      </div>
    `;
  }

  /**
   * A keyboard-focusable `⚠` badge with its detail exposed both via
   * `aria-describedby` (screen readers) and `title` (pointer hover).
   *
   * `rawId` carries a per-instance nonce (`_instanceId`) so ids stay
   * unique across multiple `<protvista-uniprot>` elements in the same
   * (light) DOM, and is sanitised to a valid HTML id: the schema allows
   * any non-empty string for group/track ids, so an id containing
   * whitespace would otherwise produce an invalid `id` and split the
   * `aria-describedby` token list, breaking the association.
   */
  private _renderErrorBadge(
    ariaLabel: string,
    rawId: string,
    detail: string,
    retryLabel: string,
    retryKeys: string[]
  ) {
    const descId = rawId.replace(/[^A-Za-z0-9_-]/g, '-');
    // Retry is only offered when at least one of the failures is
    // *recoverable* — retrying a 4xx (e.g. a 404 "no data for this
    // accession") or an unparseable body just returns the same result.
    return html`<span
        class="${CSS_PREFIX}-error-badge"
        role="img"
        tabindex="0"
        aria-label="${ariaLabel}"
        aria-describedby="${descId}"
        title="${detail}"
        >⚠</span
      ><span id="${descId}" class="${CSS_PREFIX}-visually-hidden">${detail}</span
      >${retryKeys.length
        ? html`<button
            type="button"
            class="${CSS_PREFIX}-error-retry"
            aria-label="${retryLabel}"
            @click="${(e: Event) => {
              // Don't let the click bubble to the group-label's collapse
              // toggle — Retry should reload, not expand/collapse the group.
              e.stopPropagation();
              this._retry(retryKeys);
            }}"
          >
            Retry
          </button>`
        : ''}`;
  }

  /**
   * Whether a fetch failure is worth retrying: transport problems
   * (`network` — connectivity may return) and server errors (`http` 5xx —
   * may be transient). A 4xx is deterministic (a 404 means the entity has
   * no data of this kind) and a `parse` failure re-parses the same body,
   * so neither offers a Retry.
   */
  private _isRecoverable(err: TrackFetchError): boolean {
    return (
      err.kind === 'network' ||
      (err.kind === 'http' && (err.status ?? 0) >= 500)
    );
  }

  /** A `⚠` badge for a single failed track (only "broken" errors are recorded). */
  private _renderTrackBadge(key: string) {
    const err = this._trackErrors.get(key);
    if (!err) return '';
    return this._renderErrorBadge(
      'Track failed to load',
      `${CSS_PREFIX}-err-${this._instanceId}-${key}`,
      this._describeFetchError(err),
      `Retry loading track '${err.trackId}'`,
      this._isRecoverable(err) ? [key] : []
    );
  }

  /**
   * A `⚠` badge for a group with one or more visibly-failed tracks. The
   * gating lives here (both render sites call it unconditionally): the
   * badge is suppressed only when the group is expanded *and* has data,
   * because the per-track badges in the expanded rows cover it then. A
   * collapsed group, or a group with no data (its rows never render),
   * always surfaces the summary badge.
   */
  private _renderGroupBadge(groupId: string) {
    if (!this._visibleGroupErrors.has(groupId)) return '';
    if (this.openGroups.includes(groupId) && !!this.data[groupId]) return '';
    const detail = this._groupErrors.has(groupId)
      ? 'All tracks in this group failed to load'
      : 'Some tracks in this group failed to load';
    return this._renderErrorBadge(
      detail,
      `${CSS_PREFIX}-gerr-${this._instanceId}-${groupId}`,
      detail,
      `Retry loading group '${groupId}'`,
      this._groupRecoverableKeys(groupId)
    );
  }

  /**
   * `${groupId}-${trackId}` keys of this group's *recoverable* failed
   * tracks — the set the group's Retry button reloads. Empty when every
   * failure is a 4xx / parse (no Retry offered).
   */
  private _groupRecoverableKeys(groupId: string): string[] {
    const keys: string[] = [];
    for (const [key, err] of this._trackErrors) {
      if (err.groupId === groupId && this._isRecoverable(err)) keys.push(key);
    }
    return keys;
  }

  /**
   * Re-fetch only the given tracks (by `${groupId}-${trackId}` key) and
   * re-run the pipeline for them, splicing the results back in. If a
   * track now loads its badge clears and its data renders; otherwise the
   * badge stays — self-correcting. Passing no keys reloads everything.
   */
  private _retry(keys: string[]) {
    this._loadData(keys.length ? new Set(keys) : undefined);
  }

  /** Dismiss the mount panel; `updated()` restores focus next cycle. */
  private _dismissError() {
    this._mountError = null;
    this.requestUpdate();
  }

  handleGroupClick(e: MouseEvent) {
    const target = e.target as Element;
    // A Markdoc-rendered label can contain an inline link. A click on that
    // link should navigate only — not also collapse/expand the group — so
    // bail before the toggle logic when the click landed on (or inside) an
    // <a>.
    if (target.closest('a')) return;
    // Climb to the group-label host regardless of what inner inline
    // element (a `{% help %}` span, emphasis) the click landed on — a
    // Markdoc-rendered label can nest arbitrary inline markup, so a
    // single-level `parentElement` hop is no longer sufficient.
    const host = target.closest('[data-group-toggle]');
    if (!host) return;

    const toggle = host.getAttribute('data-group-toggle');

    if (toggle && !host.classList.contains('open')) {
      host.classList.add('open');
      this.openGroups = [...this.openGroups, toggle];
    } else {
      host.classList.remove('open');
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
        // Reached when a component is registered and validated but has
        // no `case` here — the current gap for consumer components (see
        // "Register + load + render" in docs/architecture.md). Name the
        // component and the row: validation deliberately accepts these
        // now, so this warning is the only signal the author gets that
        // the row rendered empty.
        console.warn(
          `[protvista-uniprot] No renderer for component '${component}'` +
            `${id ? ` (row '${id}')` : ''}. Custom components are defined ` +
            `and validated but not yet drawn — the row renders empty.`
        );
        break;
    }
  }
}

export default ProtvistaUniprot;
