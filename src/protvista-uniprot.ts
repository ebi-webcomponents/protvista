import { LitElement, html, svg } from 'lit';
import { customElement } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { repeat } from 'lit/directives/repeat.js';
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

// Adapter functions are no longer imported or held here: they live in the
// schema registry (seeded from `BUILTIN_ADAPTERS`) and the loader resolves
// them by name via `this.registry.getAdapter`. Only this type is still
// needed for a local narrowing below.
import type { TransformedVariant } from './schema/adapters/variation-adapter.js';

import { loadComponent } from './utils/index.js';
import {
  STRUCTURAL_COMPONENTS,
  registerBuiltinComponents,
} from './built-in-components.js';
import {
  loadProtvistaData,
  UNFILTERED_SUFFIX,
  type CustomTrackData,
  type TrackProcessingFailure,
} from './load-data.js';
import {
  installClickTooltip,
  type TooltipController,
} from './tooltips/popover.js';
import { renderLabel } from './tooltips/resolve.js';
import { escapeHtml } from './utils/security.js';
import { getFeatureSource, type FeatureSource } from './feature-source.js';
import { warnLostProperties } from './lost-properties.js';
import type {
  ProtvistaChangeEvent,
  ProtvistaChangeEventDetail,
  ProtvistaTrackOrigin,
} from './events.js';

import filterConfig, { colorConfig } from './filter-config.js';

// Schema-driven config pipeline. The default YAML is
// bundled as a raw string so `js-yaml` stays lazy-loaded — adopters
// who pass a parsed `viewerConfig` object never pull in the parser.
import defaultConfigYaml from './default-config.yaml?raw';
import { loadConfigWithSource, type LoadedConfig } from './schema/load.js';
import {
  mergeVariables,
  referencedTokens,
  type Variables,
} from './schema/variables.js';
import { type Registry, createRegistry } from './schema/registry.js';
import type {
  KnownComponentName,
  ProtvistaViewerConfig,
  AdapterFunction,
  SemanticKindDefinition,
  ColorStop,
} from './schema/types.js';
import type {
  NormalizedConfig,
  NormalizedRow,
  NormalizedTrack,
} from './schema/normalize.js';
import { renderingToAttrs } from './renderer/render-helpers.js';
import {
  aggregatePayload,
  drawnAggregateTracks,
  isAuthoredSource,
} from './schema/normalize.js';
import {
  type LayoutPatch,
  type DisplayRow,
  applyPatch,
  diffLayout,
  displayRows,
  emptyPatch,
  hiddenCount,
  isRowHidden,
  moveRow,
  moveTrack,
  sameArrangement,
  setRowHidden,
  setTrackHidden,
  trackKey,
  visibleTracks,
} from './layout.js';
import {
  LAYOUT_PARAM,
  configIdentity,
  storageKey,
  isDefaultLayout,
  encodeLayout,
  decodeLayout,
} from './layout-persistence.js';
import { applyLayoutToConfig } from './schema/denormalize.js';

import loaderIcon from './icons/spinner.svg';
import slidersIcon from './icons/sliders.svg';
import chevronUpIcon from './icons/chevron-up.svg';
import { inlineSvg } from './icons/inline.js';
import protvistaStyles from './styles/protvista-styles.js';
import loaderStyles from './styles/loader-styles.js';
import errorStyles from './styles/error-styles.js';
import configPanelStyles from './styles/config-panel-styles.js';
import { CSS_PREFIX } from './styles/css-prefix.js';
import { injectStyleOnce, installTokenDefaults } from './styles/inject.js';
import {
  type Rgb,
  resolveColor,
  isCssColor,
  mix,
  tint,
  cssRgb,
  readableOn,
  defaultTextColor,
  TEXT_ON_DARK,
  TRACK_LABEL_TINT,
  MUTED_TEXT_WEIGHT,
  GROUP_LABEL_HOVER_SHIFT,
} from './styles/color.js';

// User-facing error surfaces. `ConfigValidationError` is a value import
// (used for the `instanceof` narrowing in `_init`'s catch); the display
// formatter is *not* imported here — it is pulled in lazily via
// `await import('./errors/format.js')` only when a config error actually
// occurs, so the happy path never downloads it.
import {
  ConfigValidationError,
  type ValidationIssue,
} from './schema/errors.js';
import { RENDERABLE_COMPONENT_NAMES } from './schema/components.js';
import type { ErrorPhase, ErrorContext } from './errors/report.js';
import {
  findOutOfRange,
  formatOutOfRangeWarning,
  type TrackCoordinates,
} from './schema/adapters/coordinates.js';
import {
  routeFailure,
  type FailureChannels,
  type FailureReport,
} from './errors/router.js';
import type { FormattedError } from './errors/format.js';

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

/**
 * What the polite live region says while the element is loading. A named
 * constant because `updated()` both sets it and tests for it when clearing —
 * a literal in two places would silently stop clearing if one was reworded.
 */
const LOADING_ANNOUNCEMENT = 'Loading protein data…';

/**
 * How long the loading text waits after the live region is mounted. Assistive
 * technology reads the accessibility tree once per rendered frame, so text set
 * in the same task as the region's insertion arrives *with* the region and is
 * usually not announced. A frame is not enough margin across engines and
 * screen readers; a short delay is the common remedy, and well under the
 * point where a quick load would never announce at all.
 */
const LIVE_REGION_SETTLE_MS = 100;

/**
 * How a track's data failed. See `_trackErrors`.
 *
 * The first three are transport outcomes, classified by the fetch closure in
 * `_loadData`. `adapter` is the processing outcome: the body arrived fine but
 * the decoder, the shape validator or the named adapter threw on it — a
 * malformed file, which is an authoring error and not a service one.
 * `render` is the last step: the payload was built, and the Nightingale
 * element rejected it when handed over (see `_assignComponentData`).
 */
type FetchErrorKind = 'network' | 'http' | 'parse' | 'adapter' | 'render';

/** A single track's data failure, correlated to its group/track. */
type TrackFetchError = {
  /** The URL that failed. Empty for an `adapter` failure on a non-URL source. */
  url: string;
  kind: FetchErrorKind;
  /** Present only for `kind: 'http'`. */
  status?: number;
  /**
   * The thrown error's own text. For `kind: 'adapter'` it already names the
   * author's file and the offending row, which is exactly what the badge
   * should say. For `kind: 'parse'` it is the parser's complaint (where in
   * the body it gave up), appended to the derived wording. Absent for the
   * other transport kinds, whose wording is derived.
   */
  message?: string;
  /**
   * The thrown value behind a `network` or `parse` failure, for the console
   * line — the stack and the parser's position, which the derived wording
   * leaves out.
   */
  cause?: unknown;
  /**
   * Whether the location is the author's own rather than a provider
   * endpoint. For a transport failure that is any descriptor with a `format`
   * (`isAuthoredSource`) or written as `from: file` — however it was written
   * (`./hits.csv`, an absolute URL, `{ url: … }`, a file with an explicit
   * `adapter:`), nothing publishes data at it conditionally, so it is what
   * makes a 4xx *broken* (a wrong path or URL) instead of *missing* (this
   * entity has no data of this kind). For an `adapter` failure it is only
   * `isAuthoredSource`: it decides whether the decoder's own text, which names
   * the file, can stand alone. See `_isRecoverable`.
   */
  authored?: boolean;
  /**
   * Whether the source was the `from: file` shorthand — a page-relative
   * path. Selects the path-specific wording only; see `_describeFetchError`.
   */
  fromFile?: boolean;
  /**
   * For `kind: 'adapter'`: the loader's `TrackProcessingFailure.retryable` —
   * a provider adapter's own throw, which may be transient.
   */
  retryable?: boolean;
  groupId: string;
  /**
   * The track that failed, or `null` for the row's *aggregate* — the single
   * payload a collapsed group draws all its tracks from. Only a `render`
   * failure can be aggregate-scoped: the aggregate is built from per-track
   * data that already loaded, so nothing upstream of the handover can fail
   * on it alone.
   */
  trackId: string | null;
};

/** A track-less fetch failure, as the fetch closure in `_loadData` records it. */
type UrlFetchError = Omit<TrackFetchError, 'groupId' | 'trackId'>;

/** Every fetch failure among one track's URLs, in URL order. */
const trackFetchFailures = (
  urls: readonly string[] | undefined,
  fetchErrors: ReadonlyMap<string, UrlFetchError>
): UrlFetchError[] =>
  (urls ?? []).flatMap((u) => {
    const err = fetchErrors.get(u);
    return err ? [err] : [];
  });

/**
 * A provider endpoint answering 4xx: the entity has no data of this kind,
 * which is an expected absence rather than a failure. Never true for an
 * authored source, where the same status means the path or URL is wrong.
 */
const isExpectedAbsence = (err: UrlFetchError, authored: boolean): boolean =>
  err.kind === 'http' && (err.status ?? 0) < 500 && !authored;

/**
 * Outcome of the top-level sequence fetch (`loadEntry`). Either the parsed
 * entry body, or a classified failure — the same `network` / `http` /
 * `parse` taxonomy used per-track, so the mount panel can distinguish a
 * *broken* service (retryable) from a *missing* accession (a 4xx).
 */
type EntryResult =
  | {
      entry: { sequence?: { sequence?: string } } | undefined;
      error?: undefined;
    }
  | {
      entry?: undefined;
      error: {
        kind: FetchErrorKind;
        status?: number;
        /** The thrown value, for the reporter's console line. */
        cause?: unknown;
      };
    };

/** The Proteins API entry `loadEntry` reads the sequence from. */
const entryUrl = (accession: string): string =>
  `https://www.ebi.ac.uk/proteins/api/proteins/${accession}`;

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
  // Variation / RNA-editing tracks carry a `{ sequence, variants }` bundle
  // (see the adapters). That object always has keys, so a plain
  // key-count reads an empty `variants: []` as "has data" — a phantom that
  // draws nothing yet keeps its track/group from being treated as empty
  // (leaving, e.g., RNA editing on a protein with none showing an empty lane
  // once expanded). Judge a bundle by its variants, matching the display gate.
  if (typeof value === 'object' && 'variants' in value) {
    const { variants } = value as { variants?: unknown };
    return Array.isArray(variants) && variants.length > 0;
  }
  return Object.keys(value as object).length > 0;
};

/**
 * Whether a line-graph track's hover readout should name its series.
 *
 * `nightingale-linegraph-track` composes the readout as
 * `` `${value} ${name}${value === 1 ? '' : 's'}` `` — it pluralises the series
 * name as if it were a count. That reads correctly for the domain count
 * adapters ("12 variants", "1 missense") but not for a bring-your-own metric,
 * where `linegraph`'s placeholder series name would turn a read depth of 12
 * into "12 values". Those tracks show the bare number instead.
 */
const showsSeriesLabel = (tracks: readonly NormalizedTrack[]): boolean =>
  !tracks.some((t) => t.data?.some((d) => isAuthoredSource(d)));

/**
 * How long a just-moved row stays highlighted. Long enough to find the row
 * after a move that scrolled it out of view, short enough not to linger over
 * the next one.
 */
const MOVED_HIGHLIGHT_MS = 2000;

/** Monotonic per-page counter giving each element a unique id nonce. */
let protvistaInstanceSeq = 0;

/**
 * Every token a config `theme` can write inline on the host — the closed
 * vocabulary `applyTheme` is allowed to touch, and nothing wider. What it
 * *clears* between applies is the narrower set it actually wrote last
 * time (`appliedThemeTokens`), so a consumer's own inline override on one
 * of these survives.
 */
type ThemeToken =
  | '--protvista-group-label-bg'
  | '--protvista-group-label-color'
  | '--protvista-group-label-color-muted'
  | '--protvista-group-label-hover-bg'
  | '--protvista-track-label-bg'
  | '--protvista-track-label-color'
  | '--protvista-track-label-color-muted'
  | '--protvista-caret-color'
  | '--protvista-color-accent';

@customElement('protvista-uniprot')
class ProtvistaUniprot extends LitElement {
  private openGroups: string[];
  /**
   * The {@link ThemeToken}s the last `applyTheme` actually wrote. Only
   * these are cleared on the next apply, so a runtime override a consumer
   * set inline is never collateral damage.
   */
  private readonly appliedThemeTokens = new Set<ThemeToken>();
  /**
   * The authored config as loaded, kept verbatim so `getConfig()` can export
   * the user's arrangement in the shape it was written rather than a
   * fully-explicit dump (see `src/schema/denormalize.ts`).
   */
  private _authoredConfig?: ProtvistaViewerConfig;
  /**
   * The pristine normalized rows, before any layout edit. The baseline for
   * "reset to default" and for the `LayoutPatch` diff the viewer persists —
   * `config.rows` itself carries the user's edits and is not a safe reference
   * for either.
   */
  private _baseRows?: NormalizedRow[];
  /**
   * Whether "Customize layout" mode is active — the mode that puts reorder
   * and show/hide controls on the rows themselves. Internal reactive state
   * (`state: true`, no attribute).
   */
  private _customizeMode: boolean;
  /**
   * Screen-reader announcement for the most recent layout action ("Domains
   * moved to position 2 of 12"). Rendered into a polite live region, so an
   * assistive-tech user hears the outcome of a move or toggle they cannot
   * see (WCAG 4.1.3).
   */
  private _announcement = '';
  /**
   * The row or track (`rowId` or `${rowId}-${trackId}`) most recently moved,
   * briefly highlighted so the user can see where it landed. A row can travel
   * far enough in one press to be easy to lose, and the live-region
   * announcement only helps people who hear it.
   */
  private _movedKey: string | null = null;
  /**
   * Whether the initial-load announcement has been made for the load in
   * flight. Latches so `updated()` — which runs for every reactive property —
   * announces the wait once rather than on every cycle, and resets when the
   * load settles so a later load (a `setConfig()`, a panel Retry) announces
   * again.
   */
  private _loadAnnounced = false;
  /** The pending loading announcement (see `LIVE_REGION_SETTLE_MS`). */
  private _announceTimer?: ReturnType<typeof setTimeout>;
  /**
   * Whether `_init()`'s `loadEntry()` and its first `_loadData()` are still
   * in flight. The sequence and the track data are fetched side by side, and
   * the spinner must cover whichever finishes last — see `_settleLoading`.
   */
  private _sequencePending = false;
  private _tracksPending = false;
  /**
   * `setTrackData()` calls made before the config loaded, in call order,
   * waiting for `_applyConfig` to validate them (see `setTrackData`).
   */
  private _pendingTrackData: Array<{
    groupId: string;
    trackId: string;
    data: unknown;
  }> = [];
  /** Bumped per `_init()` call; an older call's `loadEntry()` result is dropped. */
  private _entryGeneration = 0;
  /** Timer clearing `_movedKey`; re-armed on each move. */
  private _movedTimer?: ReturnType<typeof setTimeout>;
  /**
   * Opt out of layout persistence. When present as the `no-persist-layout`
   * attribute, a customized layout is neither restored on mount nor saved
   * (localStorage + the `?layout=` URL are both left untouched), so an
   * embedder that manages layout itself is unaffected.
   */
  noPersistLayout?: boolean;
  /** Hide the 3D structure group (`nostructure` attribute). */
  nostructure: boolean;
  /**
   * Opt out of the built-in click tooltip. Consumers rendering a React overlay typically set this.
   * @see specs/config-approach.md "React host integration" (and docs/react-integration.md) for the
   * `change`-event listener pattern React hosts pair with this attribute.
   */
  notooltip?: boolean;
  private hasData: boolean;
  private loading: boolean;
  private data: { [key: string]: any };
  private rawData: { [key: string]: any };
  private displayCoordinates: { start?: number; end?: number } = {};
  /**
   * Hold off loading (`suspend` attribute). Configure the element — register
   * adapters, set `viewerConfig` — then clear it to load.
   */
  suspend?: boolean;
  /** The UniProt accession to show (`accession` attribute). */
  accession?: string;
  /** The protein sequence, fetched from `accession` when not given. */
  sequence?: string;
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
  viewerConfig?: ProtvistaViewerConfig | string;
  /**
   * URL / file path to a YAML or JSON config. Fetched and handed to
   * `loadConfig` at mount time. Lower precedence than
   * `viewerConfig`.
   */
  configSrc?: string;
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
   * Watches the host's attributes for `data-*` changes, which feed URL
   * template variables. Installed in `connectedCallback`, disconnected in
   * `disconnectedCallback`. No `attributeFilter`: `data-*` names are
   * open-ended. The named `accession` attribute is *not* handled here —
   * it is a Lit reactive property with its own `updated()` → `_init()`
   * path, and reacting here too would double-load.
   */
  private _variablesObserver?: MutationObserver;

  /**
   * Pending `requestAnimationFrame` handle for a variables-driven reload,
   * so a burst of `data-*` writes in one tick coalesces to one load.
   */
  private _variablesFrame?: number;

  /**
   * The URL-relevant variable values the most recent full `_loadData()`
   * requested (see `_variablesKey`). A `data-*` change reloads only when
   * this differs — so `data-testid`, a same-value write, or a
   * `data-accession` shadowed by the named attribute costs nothing.
   */
  private _lastLoadVariables?: string;

  /**
   * Mount-level error state. When set, `render()` shows the alert panel
   * instead of the viewer (or the silent blank it used to show for a
   * config / sequence failure). For a config failure the rich
   * `FormattedError` fields (grouped issues) are filled in after the
   * lazy `./errors/format.js` chunk resolves; until then the one-line
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

  /**
   * The substituted URL(s) each track last fetched, keyed like
   * `_trackErrors` — the loader's own `trackUrls`, kept so a failure found
   * after the load (a component rejecting its payload) can still say where
   * the data came from. A full load replaces it; a targeted one merges in.
   */
  private _trackUrls: Record<string, string[]> = {};

  /** Group ids whose *every* track failed (drives badge wording). */
  private _groupErrors: Set<string> = new Set();

  /**
   * The accession `this.sequence` was fetched for. An accession change
   * re-runs `_init()` without clearing `sequence`, so the new protein's
   * track data can land while the old protein's sequence is still stored;
   * the coordinate check must not run against it.
   */
  private _sequenceAccession: string | undefined;

  /**
   * Authored tracks' decoded coordinates still waiting for the
   * sequence-bounds check, keyed by `${groupId}-${trackId}`, with the
   * accession their batch loaded. Filled by `_loadData` and drained by
   * `_checkCoordinates`, so each track is checked once per data load. A
   * load drops the entries it supersedes when it starts — so a sequence
   * landing mid-load can't check the data being replaced — and queues its
   * own when it commits.
   */
  private _pendingCoordinateChecks: Map<
    string,
    { accession: string; coordinates: TrackCoordinates }
  > = new Map();

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
   * Plain-text labels, keyed by `accession\nsource`. `_labelText` is called
   * per row and per track on every customize-mode render (and on the moved-key
   * clear timer), and the derived text is stable for a given label + protein,
   * so it is parsed once rather than on every frame. Cleared on every full
   * (re)load (`_loadData`) so it can't accumulate across proteins.
   */
  private _labelTextCache: Map<string, string> = new Map();

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

  /** Backing value of the public `adapters` property. */
  private _adapters?: Record<string, AdapterFunction>;

  /**
   * Track origins by the id suffix the renderer gives each track element
   * (`${rowId}-${trackId}` for a track, `rowId` for a group aggregate), built
   * once per `config.rows` array. A graph aggregate also carries the source of
   * the one track it draws. See `_onChangeCapture`.
   */
  private _trackOrigins = new WeakMap<
    NormalizedRow[],
    Map<string, { track: ProtvistaTrackOrigin; source?: FeatureSource }>
  >();

  constructor() {
    super();
    registerBuiltinComponents(this.registry);
    // `adapters` may have been set while this element was still an
    // undefined tag (before the module loaded). That value sits in an own
    // property shadowing the accessor; move it through the setter so the
    // adapters are registered before `connectedCallback` starts loading.
    if (Object.prototype.hasOwnProperty.call(this, 'adapters')) {
      const pending = (this as { adapters?: Record<string, AdapterFunction> })
        .adapters;
      delete (this as { adapters?: unknown }).adapters;
      this.adapters = pending;
    }
    // Capture phase on the host runs before every bubble-phase listener —
    // the built-in popover and any consumer listener, even one added before
    // this element upgraded — so they all see the enriched `detail`.
    this.addEventListener('change', this._onChangeCapture, { capture: true });
    this.openGroups = [];
    this._customizeMode = false;
    this.noPersistLayout = false;
    this.nostructure = false;
    this.hasData = false;
    this.loading = true;
    this.data = Object.create(null);
    this.rawData = {};
    this.displayCoordinates = {};
    this.addStyles();
  }

  // ── Runtime extension API (ProtvistaRuntimeAPI) ─────────────
  // Thin delegates onto this element's registry. Call these before the
  // config loads (e.g. right after creating the element) so custom
  // names are known when `loadConfig` validates and normalizes.

  /**
   * Adapters to register, by name — the declarative form of
   * `registerAdapter`. Set it before the element loads (it may be set before
   * the element is even defined, and is applied on upgrade), and the
   * config's `adapter:` names resolve to these functions, including
   * overrides of built-ins. Each value replaces the last: a name may take a
   * new function (an inline object re-created every React render is fine),
   * and a name the new value drops is unregistered, falling back to the
   * built-in it overrode. A name already registered some other way (e.g. via
   * `registerAdapter`) throws `RegistryCollisionError` and leaves the
   * element unchanged. Entries set after the data has loaded apply to the
   * next load.
   */
  get adapters(): Record<string, AdapterFunction> | undefined {
    return this._adapters;
  }

  set adapters(value: Record<string, AdapterFunction> | undefined) {
    this.registry.replaceAdapters(this._adapters, value);
    this._adapters = value;
  }

  /**
   * Register a custom adapter so config can reference it by name.
   * Registering the same function under the same name again is a no-op.
   */
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

  // ── Runtime layout API (ProtvistaRuntimeAPI) ────────────────
  // Drive row order + visibility from consumer code. Each mutation rewrites
  // `config.rows` — the config is what renders, so `getConfig()` exports
  // exactly what the user arranged — and dispatches a bubbling
  // `protvista-layout-change` event carrying the compact `LayoutPatch` diff,
  // so an embedder can save/restore without handling a whole config.
  //
  // Movement is two-level: rows among rows, tracks within their own row. The
  // pure transforms live in `./layout`; this layer only decides what changed
  // and commits it.

  /**
   * Reorder the rows by id. Ids not in the config are ignored; rows the list
   * omits keep their authored position, appended after — so a saved order
   * survives config edits.
   */
  setRowOrder(order: string[]): void {
    const rows = this.config?.rows;
    if (!rows) return;
    // Replay the id list as successive moves rather than a bulk reorder, so
    // this shares `moveRow`'s tolerance for unknown/omitted ids.
    let next = rows;
    let at = 0;
    for (const id of order) {
      if (next.some((r) => r.id === id)) next = moveRow(next, id, at++);
    }
    this._commitRows(next);
  }

  /** Reorder the tracks within one row by id. */
  setTrackOrder(rowId: string, order: string[]): void {
    const row = this.config?.rows.find((r) => r.id === rowId);
    if (!row) return;
    let next = this.config!.rows;
    let at = 0;
    for (const id of order) {
      if (row.tracks.some((t) => t.id === id)) {
        next = moveTrack(next, rowId, id, at++);
      }
    }
    this._commitRows(next);
  }

  /**
   * Show or hide a whole lane (a group or a standalone track) by row id.
   * Showing a group also reveals any per-track hides within it, so "show
   * group" fully reveals a group whose tracks were hidden individually.
   */
  setRowVisibility(rowId: string, visible: boolean): void {
    if (!this.config) return;
    this._commitRows(setRowHidden(this.config.rows, rowId, !visible));
  }

  /** Show or hide an individual track within a group. */
  setTrackVisibility(groupId: string, trackId: string, visible: boolean): void {
    if (!this.config) return;
    this._commitRows(
      setTrackHidden(this.config.rows, groupId, trackId, !visible)
    );
  }

  /**
   * Restore the authored config: drop every reorder and show/hide so the view
   * returns to its initial mount.
   */
  resetLayout(): void {
    const base = this._baseline();
    if (base) this._commitRows(base);
  }

  /**
   * A copy of the current layout patch — the diff from the authored config,
   * safe to keep or serialize; the `protvista-layout-change` event carries
   * the same shape. `order` is `null` when no row reorder has been applied.
   */
  getLayout(): LayoutPatch {
    const base = this._baseline();
    if (!base || !this.config) return emptyPatch();
    return diffLayout(base, this.config.rows);
  }

  /**
   * The authored rows to diff against and reset to.
   *
   * `_applyConfig` sets this when it loads a config, but the `config`
   * property is public and assignable — a consumer or test that sets it
   * directly would otherwise have no baseline at all. Seeding on first use
   * covers that: the first read always happens before any edit, since every
   * edit goes through `_commitRows`, which reads it first.
   */
  private _baseline(): NormalizedRow[] | undefined {
    if (!this._baseRows && this.config) this._baseRows = this.config.rows;
    return this._baseRows;
  }

  /**
   * The viewer's current configuration in authored form, including whatever
   * the user rearranged — suitable for saving, sharing, or handing back to
   * `setConfig()`. `undefined` before the config has loaded.
   */
  getConfig(): ProtvistaViewerConfig | undefined {
    if (!this._authoredConfig || !this.config) return undefined;
    return applyLayoutToConfig(this._authoredConfig, this.config.rows);
  }

  /**
   * Single mutation point for the row arrangement: swap `config` immutably
   * (Lit dirty-checks by identity, and the `updated()` gate turns that into a
   * data re-push) and announce the new patch. Every layout change — API or UI
   * control — routes through here, so the event fires exactly once per change
   * and never for a no-op.
   */
  private _commitRows(rows: NormalizedRow[]): void {
    // Capture the baseline before the first edit lands (see `_baseline`).
    this._baseline();
    if (!this.config || rows === this.config.rows) return;
    if (sameArrangement(this.config.rows, rows)) return;
    this._rebuildAggregates(this.config.rows, rows);
    this.config = { ...this.config, rows };
    this.dispatchEvent(
      new CustomEvent('protvista-layout-change', {
        detail: this.getLayout(),
        bubbles: true,
      })
    );
    this._persistLayout();
  }

  /**
   * Rebuild the collapsed-view payload (`data[groupId]`) of every group whose
   * drawn tracks (`drawnAggregateTracks`) a layout change alters — a track
   * hidden or shown, or a reorder that changes which track a graph group
   * draws. Built from the per-track payloads already loaded, so nothing is
   * refetched; groups the change leaves alone keep their payload, so
   * Nightingale isn't handed an equal copy to re-render.
   */
  private _rebuildAggregates(
    before: NormalizedRow[],
    after: NormalizedRow[]
  ): void {
    const drawn = (row: NormalizedRow) =>
      drawnAggregateTracks(row.tracks)
        .map((t) => t.id)
        .join('\n');
    const previous = new Map(before.map((row) => [row.id, drawn(row)]));
    let next: Record<string, unknown> | undefined;
    for (const row of after) {
      if (row.standalone || previous.get(row.id) === drawn(row)) continue;
      next ??= Object.assign(Object.create(null), this.data);
      next[row.id] = aggregatePayload(
        row,
        (t) => this.data[trackKey(row.id, t.id)]
      );
    }
    if (next) this.data = next;
  }

  // ── Layout persistence (localStorage + ?layout= URL) ────────
  // A customized layout survives reload (localStorage, keyed per-config) and
  // is shareable by link (the `?layout=` URL). Restore precedence on mount
  // is URL > localStorage > authored default. The `no-persist-layout`
  // attribute opts out of both, read and write.
  //
  // What is stored is the compact `LayoutPatch` diff, not the config itself:
  // the user's edits genuinely live in the config, but a whole config would
  // be far too large for a URL. `_restoreLayout` replays the patch onto the
  // authored rows before the first render.

  /**
   * Storage key for the current config, or `null` if unavailable. Derived
   * from the *authored* rows, not the arranged ones, so a user's own reorder
   * never moves their layout to a different key mid-session.
   */
  private _layoutStorageKey(): string | null {
    if (!this._baseRows) return null;
    return storageKey(configIdentity(this._baseRows));
  }

  /** Read the `?layout=` token from the current URL (browser only). */
  private _readUrlLayout(): string | null {
    if (typeof window === 'undefined' || !window.location) return null;
    return new URLSearchParams(window.location.search).get(LAYOUT_PARAM);
  }

  /**
   * Replay a saved / shared patch onto `config.rows`, honouring the
   * URL > localStorage > default precedence. Assigns `config` directly (not
   * via `_commitRows`) so restoring neither re-persists nor fires a change
   * event. A no-op when persistence is opted out or nothing was saved.
   */
  private _restoreLayout(): void {
    if (this.noPersistLayout || !this.config || !this._baseRows) return;
    const patch = this._readStoredPatch();
    if (!patch || isDefaultLayout(patch)) return;
    this.config = { ...this.config, rows: applyPatch(this._baseRows, patch) };
  }

  /** The saved patch, URL first, or `null` if there is none to replay. */
  private _readStoredPatch(): LayoutPatch | null {
    const fromUrl = decodeLayout(this._readUrlLayout());
    if (fromUrl) return fromUrl;
    const key = this._layoutStorageKey();
    if (!key) return null;
    try {
      return decodeLayout(window.localStorage.getItem(key));
    } catch {
      // localStorage can throw (privacy mode, disabled). Ignore — the
      // authored default stands.
      return null;
    }
  }

  /**
   * Persist the current patch to localStorage and mirror it into the
   * `?layout=` URL so the view is copy-shareable. A default (unedited)
   * layout clears both, so "reset to default" leaves no trace. A no-op when
   * opted out.
   */
  private _persistLayout(): void {
    if (this.noPersistLayout) return;
    const key = this._layoutStorageKey();
    if (!key) return;
    const patch = this.getLayout();
    const token = isDefaultLayout(patch) ? null : encodeLayout(patch);

    try {
      if (token === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, token);
    } catch {
      // Ignore storage failures (privacy mode / quota); the URL still
      // reflects the view for sharing.
    }

    if (typeof window === 'undefined' || !window.history || !window.location) {
      return;
    }
    const url = new URL(window.location.href);
    if (token === null) url.searchParams.delete(LAYOUT_PARAM);
    else url.searchParams.set(LAYOUT_PARAM, token);
    window.history.replaceState(window.history.state, '', url);
  }

  static get properties() {
    return {
      suspend: { type: Boolean, reflect: true },
      accession: { type: String, reflect: true },
      sequence: { type: String },
      data: { type: Object },
      openGroups: { type: Array },
      _customizeMode: { state: true },
      _announcement: { state: true },
      _movedKey: { state: true },
      noPersistLayout: {
        type: Boolean,
        reflect: true,
        attribute: 'no-persist-layout',
      },
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
    injectStyleOnce('config-panel', configPanelStyles.toString());
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
   *
   * Clears the tokens *this method wrote last time* up front, then sets
   * what the theme supplies, so a re-init (accession change / retry) with
   * a removed-or-narrowed theme can't leave stale inline values on the
   * host. Deliberately not the whole {@link ThemeToken} vocabulary:
   * docs/theming.md
   * advertises `element.style.setProperty('--protvista-…', …)` as the
   * runtime theming lever, and clearing a token we never set would make
   * any later `setConfig()` silently wipe a consumer's own override.
   */
  private applyTheme(theme: NormalizedConfig['theme']) {
    for (const token of this.appliedThemeTokens) {
      this.style.removeProperty(token);
    }
    this.appliedThemeTokens.clear();
    if (!theme) return;
    // `labelColor` recolours the row-label side panel while keeping the
    // shipped hierarchy: the colour itself on group headers, a light tint
    // of it on track labels — the default grey/white pair, in the
    // author's hue. One value on both surfaces flattened the group/track
    // distinction. `groupLabelColor` / `trackLabelColor` pin either
    // surface exactly, overriding the derived pair.
    //
    // Every label colour is resolved to `rgb()` here rather than handed to
    // CSS as written, because a background is only half a surface: the text,
    // caret and hover state on top of it have to be derived from the same
    // numbers (see `applyLabelSurface`). Resolving also means an
    // unparseable colour is dropped instead of reaching the stylesheet.
    //
    // An override that doesn't resolve falls back to what `labelColor`
    // would have given rather than to nothing: the field is ignored, as
    // though it had not been written.
    //
    // A dropped colour is announced rather than swallowed: `theme` is not
    // schema-validated beyond "a non-empty string", so this report is the
    // only signal a typo (or a syntax this browser cannot parse) gets. It
    // routes as a config warning — the viewer loaded as written, minus one
    // field — so it reaches the console and the `protvista-error` event, and
    // never the panel. Same wording as before; one more channel.
    const resolve = (field: string, value: string): Rgb | null => {
      const resolved = resolveColor(value, this.ownerDocument);
      if (!resolved) {
        this._reportThemeFieldIgnored(
          `Ignoring theme.${field}: "${value}" is not a colour that resolves in this browser.`
        );
      }
      return resolved;
    };
    const pick = (
      field: string,
      value: string | undefined,
      fallback: Rgb | null
    ) => (value ? resolve(field, value) : null) ?? fallback;

    const base = theme.labelColor
      ? resolve('labelColor', theme.labelColor)
      : null;
    const group = pick('groupLabelColor', theme.groupLabelColor, base);
    const track = pick(
      'trackLabelColor',
      theme.trackLabelColor,
      base && tint(base, TRACK_LABEL_TINT)
    );

    if (group) this.applyLabelSurface('group', group);
    if (track) this.applyLabelSurface('track', track);

    // Nothing is derived from the accent, so, unlike a label surface, it
    // does not need resolving to numbers and is handed to CSS as written.
    // That keeps everything the stylesheet itself accepts: `var(--brand)`,
    // `light-dark()`, a translucent value, any colour space this browser
    // draws. It is still checked, so a typo is dropped with the same
    // warning as a label colour rather than reaching the stylesheet.
    if (theme.accentColor) {
      if (isCssColor(theme.accentColor, this.ownerDocument)) {
        this.setThemeToken(
          '--protvista-color-accent',
          theme.accentColor.trim()
        );
      } else {
        this._reportThemeFieldIgnored(
          `Ignoring theme.accentColor: "${theme.accentColor}" is not a colour this browser accepts.`
        );
      }
    }
  }

  /**
   * Report a `theme:` field dropped for being unresolvable. A config-phase
   * warning scoped to the viewer: the config loaded, one field of it did not
   * take effect, and there is nothing to retry.
   */
  private _reportThemeFieldIgnored(message: string): void {
    this._report({
      severity: 'warning',
      phase: 'config',
      scope: 'viewer',
      consoleLevel: 'warn',
      message,
    });
  }

  /**
   * Set one managed theme token and remember that we set it, so the next
   * apply clears exactly what this one wrote and nothing else.
   */
  private setThemeToken(name: ThemeToken, value: string) {
    this.style.setProperty(name, value);
    this.appliedThemeTokens.add(name);
  }

  /**
   * Paint one label surface — background plus everything that has to stay
   * legible on it.
   *
   * A themed background is not a standalone choice: the shipped body text
   * is near-black, so an author who picks a dark `labelColor` would get
   * near-black on near-black. CSS cannot pick the better of two text
   * colours, so the choice is made numerically (`readableOn`) and written
   * to the label's own text token. The group surface carries two extras:
   * its collapse caret, which is a UI affordance that has to stay visible
   * (WCAG 1.4.11), and its hover state, which would otherwise swap in the
   * near-white global hover under text just flipped to white.
   */
  private applyLabelSurface(surface: 'group' | 'track', bg: Rgb) {
    const text = readableOn(bg, [defaultTextColor(), TEXT_ON_DARK]);
    // "Muted" has to stay a step toward the background *from the chosen
    // text colour*, not the global grey, which is only muted against a
    // light surface.
    const muted = mix(text, bg, MUTED_TEXT_WEIGHT);

    this.setThemeToken(`--protvista-${surface}-label-bg`, cssRgb(bg));
    this.setThemeToken(`--protvista-${surface}-label-color`, cssRgb(text));
    this.setThemeToken(
      `--protvista-${surface}-label-color-muted`,
      cssRgb(muted)
    );
    if (surface !== 'group') return;

    this.setThemeToken('--protvista-caret-color', cssRgb(muted));
    // A small step *toward* the text colour — darkening a light cell,
    // lightening a dark one. That is the conventional hover cue, and
    // because the step is small the surface never crosses the light/dark
    // line the text colour was chosen for.
    this.setThemeToken(
      '--protvista-group-label-hover-bg',
      cssRgb(mix(bg, text, 1 - GROUP_LABEL_HOVER_SHIFT))
    );
  }

  /**
   * Define the components the resolved config actually references. Walks
   * every group's and track's resolved `component`, looks the
   * constructor up in the registry, and defines the tag via
   * `loadComponent` (which no-ops for already-defined tags). This is the
   * seam that lets a consumer-registered component reach
   * `customElements.define()` without the embedder calling it directly.
   *
   * Also the place a component the renderer cannot *draw* is reported.
   * `getTrack()` can only emit the five tags `RENDERABLE_COMPONENT_NAMES`
   * lists — lit-html has no dynamic tag names, so each one is a literal
   * `case` — and a consumer component passes validation without gaining one
   * (see "Register + load + render" in docs/architecture.md). That used to be
   * a `console.warn` from inside the `switch`, which is the wrong place twice
   * over: it fired once per render rather than once per config, and nothing
   * reported from inside `render()` can route (raising a surface there
   * re-enters the update cycle it is already in). The set is static, so the
   * answer is known here, before anything draws.
   */
  private registerConfigComponents(config: NormalizedConfig) {
    // Name → the rows that reference it, so the report can say where to look.
    const names = new Map<string, string[]>();
    const note = (name: string, rowId: string) => {
      const rows = names.get(name);
      if (rows) rows.push(rowId);
      else names.set(name, [rowId]);
    };
    for (const row of config.rows) {
      note(row.component, row.id);
      for (const track of row.tracks) note(track.component, row.id);
    }
    for (const [name, rows] of names) {
      const ctor = this.registry.getComponent(name);
      if (ctor) loadComponent(name, ctor);
      // A missing ctor means a config referenced a component name with no
      // registered constructor. Validation (unknown-component) catches
      // this before mount, so reaching here is unexpected — leave the tag
      // undefined rather than throwing mid-render.

      if (RENDERABLE_COMPONENT_NAMES.has(name as KnownComponentName)) continue;
      // A config-phase warning: the config is legal and loads, but these rows
      // will draw nothing, which is not something an author can see.
      // A row that names the component on both itself and its tracks is still
      // one row — dedupe before counting, or the wording says "rows 'MINE'".
      const rowIds = [...new Set(rows)];
      const where = rowIds.map((r) => `'${r}'`).join(', ');
      this._report({
        severity: 'warning',
        phase: 'config',
        scope: 'viewer',
        consoleLevel: 'warn',
        message:
          `[protvista-uniprot] No renderer for component '${name}' ` +
          `(row${rowIds.length === 1 ? '' : 's'} ${where}). Custom components ` +
          `are defined and validated but not yet drawn — ` +
          `${rowIds.length === 1 ? 'the row renders' : 'those rows render'} empty.`,
      });
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
      this._tracksPending = false;
      this.loading = false;
      this.requestUpdate();
      return;
    }

    // A targeted Retry while a full load is in flight has nothing to add: the
    // full load is already re-fetching those tracks and will update their
    // badges when it lands. Superseding it instead would abort every *other*
    // track's result with it — a `setTrackData()` payload included — leaving
    // them stale (on the previous accession's or variables' data) until some
    // later full load. Returning here also leaves `_lastLoadVariables` to the
    // full load, which is the one that will commit it.
    if (only && this._loadBatches.some((b) => !b.only)) return;

    // Drop the coordinate checks this load supersedes (see
    // `_pendingCoordinateChecks`) — after the promotion above, so a
    // promoted retry drops them all.
    if (only) {
      for (const key of only) this._pendingCoordinateChecks.delete(key);
    } else {
      this._pendingCoordinateChecks.clear();
    }

    // A full (re)load means a new protein or config, so the plain-text label
    // cache (keyed by accession+source) is stale — drop it, bounding growth to
    // the current view. A targeted retry (`only`) leaves labels unchanged.
    if (!only) this._labelTextCache.clear();

    // Read the template variables now, at fetch time, so a `data-*` set
    // while the config was still loading is honoured, and record what this
    // load requested for `_onVariablesChanged` to compare against.
    const variables = this._variables();
    if (!only) this._lastLoadVariables = this._variablesKey(variables);

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

    // Records this batch's fetch failures, keyed by the *substituted* URL the
    // closure was handed — the same URLs the loader reports back in
    // `trackUrls`, so `_collectTrackErrors` can correlate failures to tracks
    // without re-deriving anything.
    //
    // The closure classifies and returns; it does not log. A URL is not a
    // failure site that knows anything worth saying: it cannot name the track
    // that wanted the data, and whether a 404 here even *is* a failure depends
    // on the source kind, which only the correlation pass can see. So the
    // whole decision — including the console line — moves there, behind the
    // routing table.
    const fetchErrors = new Map<
      string,
      Omit<TrackFetchError, 'groupId' | 'trackId'>
    >();

    const {
      rawData,
      data,
      hasData,
      trackUrls,
      trackCoordinates,
      trackFailures,
      skipWarnings,
    } = await loadProtvistaData(
      variables,
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
          fetchErrors.set(url, { url, kind: 'network', cause: error });
          return null;
        }
        if (!response.ok) {
          fetchErrors.set(url, {
            url,
            kind: 'http',
            status: response.status,
          });
          return null;
        }
        // Delimited bodies (CSV / TSV / BED) reach their decoder as raw text;
        // everything else — JSON files included — is parsed as JSON.
        // `response.text()` does not reject on content, so the parse-failure
        // branch below only guards the JSON path.
        if (responseType === 'text') {
          try {
            return await response.text();
          } catch (error) {
            if (isAbortError(error)) return null;
            fetchErrors.set(url, { url, kind: 'parse', cause: error });
            return null;
          }
        }
        try {
          return await response.json();
        } catch (error) {
          if (isAbortError(error)) return null;
          // The parser's own text says where it gave up — on an author's
          // malformed file, the one detail that makes it fixable.
          fetchErrors.set(url, {
            url,
            kind: 'parse',
            ...(error instanceof Error && error.message
              ? { message: error.message }
              : {}),
            cause: error,
          });
          return null;
        }
      },
      // Resolve adapter functions by name through the registry — the same
      // source of truth config validation consults, so a consumer's
      // `registerAdapter()` adapter both validates and runs.
      (name) => this.registry.getAdapter(name),
      this.customTrackData,
      only ? { only, previousData: this.data } : undefined
    );

    // If a newer load started while we were awaiting, drop the result
    // on the floor — the newer call owns subsequent state writes.
    if (signal.aborted) return;

    // Correlate the "broken" fetch failures back to the tracks/groups
    // that own them (4xx is skipped as "missing" — see
    // `_collectTrackErrors`), and surface the tracks whose *processing*
    // threw. Done after the abort guard so a stale batch can't clobber a
    // newer batch's error maps. A targeted retry passes `only` so it updates
    // just those tracks' error state.
    this._trackUrls = only ? { ...this._trackUrls, ...trackUrls } : trackUrls;
    this._collectTrackErrors(trackUrls, fetchErrors, trackFailures, only);

    // A URL template left unfetched because a `{token}` had no usable value.
    // Viewer-scoped: one template can feed several tracks, and the fix (a
    // `variables:` entry or a `data-*` attribute) is not any one row's.
    for (const message of skipWarnings) {
      this._report({
        severity: 'warning',
        phase: 'track-fetch',
        scope: 'viewer',
        message,
        consoleLevel: 'warn',
      });
    }

    // A targeted retry only carries the reloaded URLs' raw responses —
    // merge so the rest of `rawData` survives; a full load replaces it.
    this.rawData = only ? { ...this.rawData, ...rawData } : rawData;
    const wasHasData = this.hasData;
    // A full load is a new accession or config, so it decides afresh: carried
    // over, the previous entry's data would keep an all-missing one off the
    // no-results message. A targeted retry only adds to what is there.
    this.hasData = only ? this.hasData || hasData : hasData;
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
    // Null-prototype so a bare-id aggregate lookup (`this.data[group.id]`)
    // can't resolve to an inherited `Object.prototype` member for a group
    // literally named `constructor`/`toString`/… — the same guarantee the
    // layout patch maps get. Access is only ever bracket/`Object.entries`.
    const merged: Record<string, unknown> = Object.assign(
      Object.create(null),
      this.data,
      data
    );
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
        this.config.rows.flatMap((g) => g.tracks.map((t) => `${g.id}-${t.id}`))
      );
    for (const key of reloadedKeys) {
      if (!(key in data)) delete merged[key];
    }

    // Queue this batch's authored tracks for the sequence-bounds check,
    // replacing any unchecked entry a reloaded track left behind.
    for (const key of reloadedKeys) this._pendingCoordinateChecks.delete(key);
    for (const [key, coordinates] of Object.entries(trackCoordinates)) {
      this._pendingCoordinateChecks.set(key, { accession, coordinates });
    }

    // Recompute each reloaded group's aggregate from the LIVE merged
    // per-track values rather than the loader's snapshot-derived
    // `data[groupId]`. Two concurrent targeted retries on different tracks
    // of the *same* group each snapshot `this.data` (as `previousData`)
    // before either commits, so the loader's aggregate for the later batch
    // omits the earlier batch's just-recovered sibling — and merging its
    // `data[groupId]` would clobber the aggregate, silently dropping a
    // track. Rebuilding from the merged per-track keys is order-independent
    // and self-consistent (and a no-op for a full load). Uses the loader's
    // aggregate rule (`aggregatePayload`) against the current layout.
    for (const group of this.config.rows) {
      const touched = group.tracks.some((t) =>
        reloadedKeys.has(`${group.id}-${t.id}`)
      );
      if (!touched) continue;
      merged[group.id] = aggregatePayload(
        group,
        (t) => merged[`${group.id}-${t.id}`]
      );
    }
    this.data = merged;
    this._checkCoordinates();

    // The variation filter's pristine baseline now rides along in
    // `data` under `${groupId}-${trackId}${UNFILTERED_SUFFIX}` for any
    // track that opts into `filterUI: 'nightingale-filter'` — written by
    // the loader, consumed by `handleFilterClick`. No id-based copy step
    // is needed here anymore.

    // Drop ourselves from the in-flight set. A superseding call would have
    // aborted us and the guard above would have returned early, so
    // reaching here means we still own our writes.
    this._loadBatches = this._loadBatches.filter((b) => b !== batch);

    this._tracksPending = false;
    this._settleLoading();
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
   * The merged template-variables dictionary every data-URL `{token}`
   * resolves against. Precedence, lowest first: the config's `variables:`
   * block < the host's `data-*` attributes < the named `accession`
   * attribute (an alias for `data-accession` that wins on conflict).
   * `this.accession` is always set by the time this is read (`_loadData`
   * won't run without it), so `data-accession` never reaches a URL here.
   */
  private _variables(): Variables {
    return mergeVariables({
      configVariables: this.config?.variables,
      dataset: this.dataset,
      accession: this.accession,
    });
  }

  /**
   * A comparable key for the values of the variables the config's data
   * URLs actually reference — the only ones whose change can alter a
   * fetch. Absent values are kept distinct from empty ones.
   */
  private _variablesKey(variables: Variables): string {
    if (!this.config) return '';
    const tokens = [...referencedTokens(this.config)].sort();
    return JSON.stringify(
      tokens.map((name) =>
        Object.prototype.hasOwnProperty.call(variables, name)
          ? [name, variables[name]]
          : [name]
      )
    );
  }

  /**
   * `MutationObserver` callback: schedule one reload per animation frame
   * when any `data-*` attribute changes.
   */
  private _onAttributesMutated = (records: MutationRecord[]): void => {
    if (this._variablesFrame !== undefined) return;
    if (!records.some((r) => r.attributeName?.startsWith('data-'))) return;
    this._variablesFrame = requestAnimationFrame(() => {
      this._variablesFrame = undefined;
      this._onVariablesChanged();
    });
  };

  /**
   * Re-run the full track-data load if a `data-*` change altered a
   * variable the config's URLs use. Before the config has loaded there
   * is nothing to do — the pending first `_loadData()` reads `dataset`
   * at fetch time. The superseded batch is aborted by `_loadData()`.
   */
  private _onVariablesChanged(): void {
    if (!this.config || this.suspend || !this.accession) return;
    if (this._variablesKey(this._variables()) === this._lastLoadVariables) {
      return;
    }
    this._loadData();
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

  /**
   * Give every variation payload the protein sequence it needs to render.
   *
   * `nightingale-variation-canvas` builds one row per residue and indexes
   * variants by `start - 1`, so `processVariants` returns `null` — drawing
   * nothing, silently — unless the payload carries `sequence`. The UniProt
   * adapters get it from their own API response; an author's
   * `./my-variants.csv` has no sequence in it, so the viewer supplies the one
   * it already fetched for the sequence track.
   *
   * Runs on every update rather than once at load: the sequence and a track's
   * data arrive from independent fetches, so a payload can land first. It
   * mutates the stored payload in place — assigning a fresh object would
   * defeat the `element.data !== data` guard below and re-run `processData`
   * on every render.
   */
  private _fillVariationSequence() {
    if (!this.sequence) return;
    for (const payload of Object.values(this.data)) {
      if (!payload || typeof payload !== 'object') continue;
      const p = payload as { variants?: unknown; sequence?: unknown };
      if (!Array.isArray(p.variants)) continue;
      if (typeof p.sequence === 'string' && p.sequence !== '') continue;
      p.sequence = this.sequence;
    }
  }

  /**
   * Run the sequence-bounds check for every authored track that is waiting
   * for one, and report a `track-data` warning for each track with rows
   * below 1 or past the last residue.
   *
   * The sequence and a track's data come from independent fetches and can
   * land in either order, so this runs after each: a track is checked only
   * once both are present for the current accession. If no usable sequence
   * loads, nothing runs — the `sequence` phase already reports that. Each
   * pending entry is drained when checked, so a re-render never re-emits;
   * a reload queues the track again.
   *
   * The warning never touches rendering: the track already holds its data
   * as authored. Its routing row (`src/errors/router.ts`) keeps it off the
   * mount panel even under `strict`, and off the row's `⚠` badge.
   */
  private _checkCoordinates() {
    const sequence = this.sequence;
    if (!sequence || !this.config) return;
    for (const group of this.config.rows) {
      for (const track of group.tracks) {
        const key = `${group.id}-${track.id}`;
        const pending = this._pendingCoordinateChecks.get(key);
        if (!pending) continue;
        if (
          pending.accession !== this._sequenceAccession ||
          pending.accession !== this.accession
        ) {
          continue;
        }
        this._pendingCoordinateChecks.delete(key);
        const { coordinates } = pending;
        const found = findOutOfRange(coordinates.rows, sequence.length);
        if (!found) continue;
        const message = formatOutOfRangeWarning(
          coordinates,
          pending.accession,
          sequence.length,
          found
        );
        this._report(
          {
            severity: 'warning',
            phase: 'track-data',
            scope: { trackKey: key },
            ...(coordinates.url !== undefined
              ? { source: coordinates.url }
              : {}),
            message: `[protvista-uniprot] ${message}`,
            consoleLevel: 'warn',
          },
          {
            issues: [
              {
                path: group.standalone ? track.id : `${group.id}/${track.id}`,
                message,
                code: 'coordinate-out-of-range',
                severity: 'warning',
              },
            ],
            context: {
              groupId: group.id,
              trackId: track.id,
              ...(coordinates.url !== undefined
                ? { url: coordinates.url }
                : {}),
            },
          }
        );
      }
    }
  }

  /**
   * Hand one payload to one Nightingale element, containing any throw.
   *
   * A component's `data` setter runs its own processing synchronously, so a
   * payload it cannot read throws right here — `nightingale-linegraph-track`
   * spreads `d.range` and raises `TypeError: undefined is not iterable` on a
   * shape it did not expect. Without this guard that throw escapes the
   * `Object.entries(this.data)` walk below, so **one** malformed track leaves
   * every track after it in the iteration blank, with a stack trace that
   * names neither.
   *
   * Contained per element, the blast radius is the one track that is actually
   * wrong, and the message names it.
   *
   * The failure routes like any other (`error`, scoped to the row): a `⚠`
   * badge, the `protvista-error` event, the console line, and the panel under
   * `strict`. It used to be console-only, which made the advice it ends with
   * — check the shape documented for the kind — reach nobody who was not
   * already looking at a console, while the track rendered blank.
   *
   * Reporting from here is safe even though the push walk runs inside
   * `updated()`: `_report` ends in a bare `requestUpdate()`, which produces no
   * `changedProperties`, and the walk is gated on `data` / `config` /
   * `sequence` / `openGroups` / `_customizeMode` appearing in them. So the
   * extra cycle draws the badge without re-entering the push — no loop.
   *
   * A payload the element accepts clears a `render` failure recorded for the
   * same key. The key does not always carry the same payload: a layout edit
   * rebuilds a collapsed group's aggregate without the track that broke it,
   * and a sibling's targeted Retry recomputes it. Without the clear, the row
   * kept a `⚠` saying it could not draw while it drew correctly — and a
   * `render` failure offers no Retry, so nothing else would ever lift it.
   */
  private _assignComponentData(
    element: NightingaleTrackCanvas,
    payload: unknown,
    key: string
  ) {
    try {
      element.data = payload as never;
    } catch (error) {
      this._reportRenderFailure(key, error);
      return;
    }
    if (this._trackErrors.get(key)?.kind === 'render') {
      this._trackErrors.delete(key);
      this._recomputeErrorVisibility();
      this.requestUpdate();
    }
  }

  /**
   * Record and route a Nightingale element rejecting its payload.
   *
   * The push walk hands over two shapes of key — a bare row id for a group's
   * collapsed aggregate, and `${rowId}-${trackId}` for a track — so the origin
   * is resolved against the config rather than split on `-`, which a row or
   * track id may itself contain.
   *
   * Re-entrant by design: the walk re-runs whenever a group expands or data
   * changes, and the same payload will not read any better the second time.
   * So a failure already recorded for this key is left alone — the badge is
   * up, and re-firing the event on every expand would be noise. A fresh
   * `_loadData()` resets `_trackErrors`, so a reload reports again, and a
   * different payload that reads fine clears it (`_assignComponentData`).
   *
   * That includes a failure recorded *upstream* of the handover. A track
   * whose fetch failed hands its component whatever partial payload was left,
   * and if that throws, the fetch failure is still the explanation — the
   * same rule `_collectTrackErrors` applies to an adapter choking on an empty
   * body. Overwriting it would swap a Retry that could fix the track for a
   * render message that cannot.
   */
  private _reportRenderFailure(key: string, error: unknown): void {
    if (this._trackErrors.has(key)) return;

    // The badge and panel text; the console line adds the `[protvista]` tag
    // the developer channel uses to say where a line came from.
    const detail =
      `track '${key}' could not render the data it was given ` +
      `(${(error as Error)?.message ?? error}). The other tracks are ` +
      `unaffected. If this track's data came from setTrackData(), check ` +
      `it matches the record shape documented for its kind.`;
    const message = `[protvista] ${detail}`;

    const origin = this._resolveRowOrigin(key);
    // A key matching no row means the push walk and the config disagree, which
    // should not happen. There is then no row to badge, so claiming a
    // track-scoped route would promise a surface that cannot appear — it
    // routes viewer-scoped instead, reaching the console and the event without
    // a visible surface. What it must not do is go unreported.
    if (!origin) {
      this._report(
        {
          severity: 'warning',
          phase: 'track-fetch',
          scope: 'viewer',
          message,
          consoleLevel: 'error',
        },
        { consoleArgs: [error] }
      );
      return;
    }

    // Where the track's data came from, so the event names the file or URL
    // whose payload could not be drawn. An aggregate key names no single
    // track, and an inline / custom track fetched nothing — both have none.
    const url = this._trackUrls[key]?.[0] ?? '';
    const err: TrackFetchError = {
      url,
      kind: 'render',
      message: detail,
      groupId: origin.groupId,
      trackId: origin.trackId,
    };
    this._trackErrors.set(key, err);
    this._recomputeErrorVisibility();

    const channels = this._report(this._trackFailureReport(key, err), {
      context: {
        groupId: origin.groupId,
        ...(origin.trackId ? { trackId: origin.trackId } : {}),
        ...(url ? { url } : {}),
        errorKind: 'render',
      },
      consoleArgs: [error],
      deferPanel: true,
    });
    // The panel is the aggregate over every failing track, not this one: a
    // retryable 503 still outstanding elsewhere keeps its count and its Retry.
    this._syncTrackPanel(channels.panel);
  }

  /**
   * Which row (and track, when the key names one) a data-push key belongs to.
   * `trackId: null` means the key named a row's collapsed aggregate.
   */
  private _resolveRowOrigin(
    key: string
  ): { groupId: string; trackId: string | null } | undefined {
    const rows = this.config?.rows ?? [];
    for (const row of rows) {
      if (row.id === key) return { groupId: row.id, trackId: null };
      for (const track of row.tracks) {
        if (`${row.id}-${track.id}` === key) {
          return { groupId: row.id, trackId: track.id };
        }
      }
    }
    return undefined;
  }

  async _loadDataInComponents() {
    await frame();
    this._fillVariationSequence();
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
        this._assignComponentData(element, data, id);
      }
      const currentGroup = this.config?.rows.find((c) => c.id === id);
      if (
        currentGroup &&
        // Reveal the group when it shows something: its collapsed view, or
        // any visible track. Not the collapsed view alone — it leaves out
        // hidden and `detailOnly` tracks, so a group whose only feeding
        // track is hidden still shows its visible `detailOnly` track.
        // `hasRenderableData` owns the shape rules (including the
        // `{ sequence, variants }` bundle).
        (hasRenderableData(data) ||
          visibleTracks(currentGroup).some((t) =>
            hasRenderableData(this.data[trackKey(currentGroup.id, t.id)])
          ))
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
            this._assignComponentData(
              elementTrack,
              this.data[`${id}-${track.id}`],
              `${id}-${track.id}`
            );
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
    // Captured before `_panelWasOpen` is overwritten: the push gate below needs
    // to know the panel closed on this cycle.
    const panelClosed = !panelOpen && this._panelWasOpen;
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

    // Announce the wait politely. A live region only announces a *change* to
    // its contents, so the text cannot go in with the region — it would arrive
    // already holding it, and most screen readers would stay silent. Nor is
    // setting it here enough on its own: `updated()` runs in the same task as
    // the render that inserted the (empty) region, so no frame — and no
    // accessibility-tree update — happens in between. The text therefore goes
    // in `LIVE_REGION_SETTLE_MS` later, as an update to a region assistive
    // technology has already seen.
    //
    // The `_loadAnnounced` latch is what keeps it to once per load: `updated()`
    // runs for every reactive property, and re-announcing on each would talk
    // over the user. Clearing on completion leaves the region empty for the
    // layout announcements that share it, and an empty string announces
    // nothing.
    //
    // It latches only while the spinner — and so the region — is actually on
    // screen. A `suspend`ed element or one showing the alert panel renders no
    // region, and latching then would make the text arrive *with* the region
    // once it mounted: the silent case above, with the latch blocking a retry.
    const regionMounted = !this.suspend && this._mountError === null;
    if (this.loading && regionMounted && !this._loadAnnounced) {
      this._loadAnnounced = true;
      this._announceTimer = setTimeout(() => {
        if (this.loading) this._announce(LOADING_ANNOUNCEMENT);
      }, LIVE_REGION_SETTLE_MS);
    } else if (!this.loading && this._loadAnnounced) {
      this._loadAnnounced = false;
      clearTimeout(this._announceTimer);
      if (this._announcement === LOADING_ANNOUNCEMENT) this._announce('');
    }

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
    //
    // A layout edit swaps `config` (it rewrites `config.rows`), so it is
    // already covered: a reorder moves Nightingale DOM nodes via the keyed
    // `repeat` and a show re-mounts a previously-hidden row, and both need
    // their payload (re-)pushed on the same tick, exactly like an
    // `openGroups` expand.
    //
    // `_customizeMode` is in the gate for the same reason as `openGroups`:
    // the mode wraps each row in a different template (controls, a drop gap,
    // stubs for rows that would otherwise not render), so Lit tears down and
    // rebuilds the row subtrees — including the Nightingale elements, which
    // come back empty unless their payload is pushed again on this tick.
    //
    // `panelClosed` is the same case once more: the alert panel replaces the
    // whole viewer, so dismissing it mounts every row afresh — hidden and
    // empty — while none of the properties above has changed. Without it a
    // strict-mode Dismiss "revealed" a viewer with nothing in it.
    if (
      changedProperties.has('data') ||
      changedProperties.has('config') ||
      changedProperties.has('sequence') ||
      changedProperties.has('openGroups') ||
      changedProperties.has('_customizeMode') ||
      panelClosed
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
    // A later `_init()` (an accession change, a panel Retry) supersedes this
    // one's sequence fetch. Its result must then touch nothing: clearing
    // `_sequencePending` would drop the spinner while the newer sequence is
    // still on the wire, and a late failure would raise a panel naming the
    // *new* accession, since `_reportSequenceFailure` reads `this.accession`.
    // Taken before the first `await`, so it orders calls, not completions.
    const generation = ++this._entryGeneration;
    if (!this.config) {
      try {
        const loaded = await this.resolveViewerConfig();
        this._applyConfig(loaded);
        // Issues on a config that still validated — warnings. Reported
        // through the same seam as a failure so they reach the
        // `protvista-error` event. A console-only warning would not, which
        // is the whole reason warnings are issues and not `console.warn`
        // calls. Never promoted to the panel, even under `strict`: `strict`
        // makes broken states fail loudly, and a warning names something
        // legal that loads as written. Listeners tell it from a failure by
        // each issue's `severity: 'warning'`.
        if (loaded.issues.length > 0) {
          const n = loaded.issues.length;
          this._report(
            {
              severity: 'warning',
              phase: 'config',
              scope: 'viewer',
              consoleLevel: 'warn',
              message: `[protvista-uniprot] Config loaded with ${n} warning${n === 1 ? '' : 's'}.`,
            },
            {
              consoleArgs: [
                loaded.issues.map((i) => `${i.path}: ${i.message}`),
              ],
              issues: loaded.issues,
            }
          );
        }
      } catch (err) {
        // Validation / parse errors are surfaced on the console so
        // authors see the full `ConfigValidationError.issues[]` list
        // (developer channel, unchanged), AND routed through the shared
        // reporter so the user-facing alert panel and the
        // `protvista-error` event fire too. A config failure is always a
        // mount-level failure — there is no config to render past.
        const issues = err instanceof ConfigValidationError ? err.issues : [];
        const panelSummary = issues.length
          ? `Config validation failed (${issues.length} issue${issues.length === 1 ? '' : 's'})`
          : `Failed to load config: ${err instanceof Error ? err.message : String(err)}`;
        this._report(
          {
            severity: 'error',
            phase: 'config',
            scope: 'viewer',
            consoleLevel: 'error',
            message: '[protvista-uniprot] Failed to load config.',
          },
          { consoleArgs: [err], issues, panelSummary }
        );
        // Upgrade the panel to the rich, path-grouped rendering. The
        // formatter is lazy so the happy path never downloads it. Guard
        // against an accession swap re-running `_init()` and replacing
        // `_mountError` while we awaited the chunk.
        if (issues.length) {
          const { formatValidationIssues } = await import('./errors/format.js');
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

    // No accession means nothing to fetch, and `_loadData()` — the only other
    // place `loading` is cleared — is below this return, so leaving the flag
    // set spun the loader forever. Harmless while the readiness gate hid it;
    // now that the spinner covers the whole initial load, a misconfigured
    // element would sit under a permanent spinner, which reads as "working on
    // it" rather than "nothing was asked for". Clear it and render what the
    // gate in `render()` produces: an empty element, or — when the host
    // supplied `sequence` itself — the no-results message.
    if (!this.accession) {
      this.loading = false;
      this.requestUpdate();
      return;
    }
    // Both fetches start now, side by side; the spinner stays up until the
    // later of the two lands (`_settleLoading`).
    this._sequencePending = true;
    this._tracksPending = true;
    const requested = this.accession;
    this.loadEntry(requested)
      .then((result) => {
        if (generation !== this._entryGeneration) return;
        this._sequencePending = false;
        const seq = result.entry?.sequence?.sequence;
        if (typeof seq === 'string' && seq.length > 0) {
          this.sequence = seq;
          this._sequenceAccession = requested;
          this.displayCoordinates = { start: 1, end: this.sequence.length };
          this._checkCoordinates();
          // A now-valid accession clears any stale sequence-level panel
          // left over from a previous (bad-accession) attempt.
          if (this._mountError?.phase === 'sequence') {
            this._mountError = null;
          }
          this._settleLoading();
          this.requestUpdate();
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
        if (generation !== this._entryGeneration) return;
        this._sequencePending = false;
        // `loadEntry` classifies every expected failure itself, but an
        // unexpected throw could still escape. Without this handler the
        // rejection would surface as an unhandled promise rejection in the
        // host page's console. Treat it as a broken (retryable) failure.
        this._report(
          {
            severity: 'error',
            phase: 'sequence',
            scope: 'viewer',
            consoleLevel: 'warn',
            message: `[protvista-uniprot] Unexpected error from loadEntry for '${this.accession}': ${err instanceof Error ? err.message : String(err)}`,
            recoverable: true,
          },
          {
            panelSummary: `Couldn't load '${this.accession}' — the UniProt data service is unreachable or failing. This is usually temporary.`,
            consoleArgs: [err],
            context: { accession: this.accession },
          }
        );
        this.loading = false;
        this.requestUpdate();
      });
    this._loadData();
  }

  /**
   * Adopt a freshly-loaded config: install it, replay any saved layout onto
   * it, apply the theme, and define the components it references.
   *
   * Split out of `_init()` because it must be re-runnable — `setConfig()`
   * replaces the config on a live element, and `_init()`'s `if (!this.config)`
   * guard would otherwise skip every one of these steps.
   */
  private _applyConfig(loaded: LoadedConfig): void {
    const normalized = loaded.config;
    // Accession precedence: HTML attribute wins, so only backfill
    // from the config when the author left the attribute blank.
    if (!this.accession && normalized.accession) {
      this.accession = normalized.accession;
    }
    this._authoredConfig = loaded.authored;
    // The pristine rows, kept before any layout edit: the baseline "reset to
    // default" restores and the patch diff is measured against.
    this._baseRows = normalized.rows;
    this.config = normalized;
    // Restore a previously-saved / shared layout now that the config (and
    // thus its identity) is known. Runs before data loads, so the customized
    // order/visibility is in place for the first render.
    this._restoreLayout();
    this.applyTheme(normalized.theme);
    // Define the components this config references (built-in or
    // consumer-registered) now that the resolved set is known.
    // `loadComponent` no-ops for anything already defined, so re-entering
    // with a new config only pays for what it adds.
    this.registerConfigComponents(normalized);
    // A now-valid config clears a stale config-error panel from a
    // previous attempt.
    if (this._mountError?.phase === 'config') {
      this._mountError = null;
      this.requestUpdate();
    }
    // Replay the `setTrackData()` calls made before there was a config to
    // check them against. Ahead of `_init()`'s first `_loadData()`, so what
    // is accepted loads on the first pass.
    for (const { groupId, trackId, data } of this._pendingTrackData.splice(0)) {
      this._acceptTrackData(groupId, trackId, data);
    }
  }

  /**
   * Replace the entire viewer configuration at runtime (`ProtvistaRuntimeAPI`).
   * Re-registers components, re-applies the theme, and re-loads data. Accepts
   * the same three input forms as the `viewerConfig` property (object, JSON
   * string, YAML string) — including a config previously exported by
   * `getConfig()`, which is how an arranged view round-trips.
   *
   * A config failure is reported through the same path as a mount-time one,
   * so a bad `setConfig()` surfaces in the error panel rather than silently
   * leaving the old view in place.
   */
  async setConfig(config: ProtvistaViewerConfig | string): Promise<void> {
    this.viewerConfig = config;
    // Drop the current config so `_init` re-resolves rather than
    // short-circuiting, and so a failure can't leave a half-swapped state.
    this.config = undefined;
    this._baseRows = undefined;
    this._authoredConfig = undefined;
    this.data = Object.create(null);
    this.rawData = {};
    this._pendingCoordinateChecks.clear();
    this.loading = true;
    await this._init();
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
   * the config already declares its own accession. Likewise the host's
   * `data-*` attributes, so `missing-variable` accepts their tokens.
   */
  private async resolveViewerConfig(): Promise<LoadedConfig> {
    // `data-*` names go along so `missing-variable` accepts the tokens this
    // host supplies; values are read later, at fetch time.
    const loadOpts = {
      accession: this.accession,
      registry: this.registry,
      variables: { ...this.dataset },
    };
    if (this.viewerConfig !== undefined) {
      return loadConfigWithSource(this.viewerConfig, loadOpts);
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
      return loadConfigWithSource(text, loadOpts);
    }
    return loadConfigWithSource(defaultConfigYaml, loadOpts);
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
   *     `NormalizedConfig`) are queued and validated once the config
   *     arrives, then applied on first load. Validation is deferred, not
   *     skipped: a pre-mount call naming a missing or non-`custom` track,
   *     or passing a value of the wrong shape, is reported exactly as the
   *     same call after mount would be — including under `strict`, which
   *     is not known until the config is.
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
    // Pre-mount: queue and return. Nothing can be validated yet — not the
    // track, and not `strict`, which decides whether a rejection raises the
    // panel — so `_applyConfig` replays the call once both are known.
    if (!this.config) {
      this._pendingTrackData.push({ groupId, trackId, data });
      return;
    }
    // Post-mount: re-run the pipeline so the new data propagates
    // through filter / tooltip resolution and into the Nightingale
    // components. `_loadData()` already handles `this.loading` and
    // `this.requestUpdate()`.
    if (this._acceptTrackData(groupId, trackId, data)) this._loadData();
  }

  /**
   * Validate a `setTrackData()` call against the loaded config and, if it
   * passes, store the data for the next load. Every rejection is reported
   * through `_report`. Returns whether the data was accepted.
   */
  private _acceptTrackData(
    groupId: string,
    trackId: string,
    data: unknown
  ): boolean {
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
      this._report(
        {
          severity: 'warning',
          phase: 'set-track-data',
          scope: 'viewer',
          consoleLevel: 'warn',
          message: `[protvista-uniprot] setTrackData: expected an array or plain object for '${groupId}/${trackId}', got ${data === null ? 'null' : typeof data}. Call ignored.`,
        },
        { context: { groupId, trackId } }
      );
      return false;
    }

    const group = this.config?.rows.find((c) => c.id === groupId);
    const track = group?.tracks.find((t) => t.id === trackId);
    if (!track) {
      this._report(
        {
          severity: 'warning',
          phase: 'set-track-data',
          scope: 'viewer',
          consoleLevel: 'warn',
          message: `[protvista-uniprot] setTrackData: track '${groupId}/${trackId}' not found in config.`,
        },
        { context: { groupId, trackId } }
      );
      return false;
    }
    const firstSource = track.data[0];
    if (firstSource?.from !== 'custom') {
      this._report(
        {
          severity: 'warning',
          phase: 'set-track-data',
          scope: 'viewer',
          consoleLevel: 'warn',
          message: `[protvista-uniprot] setTrackData: track '${groupId}/${trackId}' is not 'from: custom' (found '${firstSource?.from ?? 'undefined'}'). Injected data discarded; edit the config to change this track's data source.`,
        },
        { context: { groupId, trackId } }
      );
      return false;
    }

    // Copy-on-write so downstream `===` checks against the previous map
    // (should any appear) see a fresh reference.
    this.customTrackData = {
      ...this.customTrackData,
      [`${groupId}-${trackId}`]: data,
    };
    return true;
  }

  /**
   * The single seam through which every failure reaches anyone, and the only
   * place `console` is called or a panel is raised.
   *
   * A failure site's job is to describe itself — how severe, how much of the
   * viewer it takes down, whether retrying could help — and hand that
   * {@link FailureReport} here. `routeFailure` decides which channels it
   * reaches, from the table in `src/errors/router.ts`; this method performs
   * them. No site decides for itself, and no site reads `strict`: that is what
   * stops the surfaces from drifting apart as failure classes are added, which
   * is exactly how they drifted before (a 4xx reaching nothing, an adapter
   * throw reaching only the console, a badge appearing on grouped rows but not
   * standalone ones).
   *
   * Returns the routed channels so a caller that aggregates — the per-track
   * correlation pass, which must raise ONE panel for a whole batch rather than
   * let each track overwrite the last — can honour the decision instead of
   * re-deriving it. That is what `deferPanel` is for; it suppresses the panel
   * here, never the decision.
   */
  private _report(
    report: FailureReport,
    opts: {
      /** Populated for `config`; forwarded on the event as `detail.issues`. */
      issues?: ValidationIssue[];
      /** Forwarded on the event as `detail.context` (merged over `{ accession }`). */
      context?: ErrorContext;
      /** Extra args appended to the `console.*` call (e.g. the caught error). */
      consoleArgs?: unknown[];
      /** User-friendly panel summary when it should differ from `message`. */
      panelSummary?: string;
      /**
       * The caller raises the routed panel itself, aggregated over its batch.
       * The routing decision is still made here and returned.
       */
      deferPanel?: boolean;
    } = {}
  ): FailureChannels {
    const channels = this._route(report);

    if (channels.console) {
      console[channels.console](report.message, ...(opts.consoleArgs ?? []));
    }

    if (channels.event) {
      this.dispatchEvent(
        new CustomEvent('protvista-error', {
          detail: {
            phase: report.phase,
            // How bad it is, so a listener can tell a warning from a failure
            // without inferring it. A viewer-scoped warning (a theme colour
            // that did not resolve, a component with no renderer) carries no
            // `issues`, so the `issue.severity` check that works for config
            // warnings has nothing to read.
            severity: report.severity,
            // What the visible surface says. Without it the event was the one
            // channel that could not say *what* went wrong: a malformed file
            // reported `errorKind: 'adapter'` and a URL, while the text naming
            // the file and the offending row — the whole reason the failure is
            // worth surfacing — reached only the badge. A failure that raises
            // the panel carries the panel's own summary rather than the
            // developer line, and the console's `[protvista…]` tag is dropped:
            // the documented use is putting this text in front of a user.
            message: (opts.panelSummary ?? report.message).replace(
              /^\[protvista(?:-uniprot)?\] /,
              ''
            ),
            ...(report.source !== undefined ? { source: report.source } : {}),
            issues: opts.issues ?? [],
            context: { accession: this.accession, ...opts.context },
          },
          bubbles: true,
        })
      );
    }

    if (channels.panel && !opts.deferPanel) {
      this._setMountError(
        report.phase,
        opts.panelSummary ?? report.message.split('\n')[0],
        opts.issues,
        channels.retry
      );
    }

    this.requestUpdate();
    return channels;
  }

  /**
   * The channels a report would reach, without reaching them — the routing
   * half of `_report`, and the single place `strict` is read. An aggregate
   * that must re-ask the router about failures it already reported
   * (`_syncTrackPanel`) calls this rather than `_report`, which would log and
   * dispatch them again.
   */
  private _route(report: FailureReport): FailureChannels {
    return routeFailure(report, { strict: this.config?.strict ?? false });
  }

  /**
   * Raise the mount-level alert panel, capturing the currently-focused
   * element first so the dismiss control can hand focus back (mirrors
   * `popover.ts`). Shared by `_report`'s routed promotion and the aggregated
   * per-track panel in `_collectTrackErrors`.
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
    cause?: unknown;
  }): void {
    const broken =
      error !== undefined &&
      (error.kind === 'network' ||
        error.kind === 'parse' ||
        (error.kind === 'http' && (error.status ?? 0) >= 500));
    const panelSummary = broken
      ? `Couldn't load '${this.accession}' — the UniProt data service is unreachable or failing. This is usually temporary.`
      : `No UniProt entry found for '${this.accession}'. Check that the accession is correct.`;
    this._report(
      {
        severity: 'error',
        phase: 'sequence',
        scope: 'viewer',
        consoleLevel: 'warn',
        message: `[protvista-uniprot] loadEntry returned no usable sequence for '${this.accession}'. Rendering empty-state.`,
        // Where the sequence was asked for, when the fetch itself failed. A
        // 2xx body with no sequence (`error` absent) fetched fine.
        ...(error ? { source: entryUrl(this.accession) } : {}),
        recoverable: broken,
      },
      {
        panelSummary,
        context: {
          accession: this.accession,
          ...(error ? { url: entryUrl(this.accession) } : {}),
          ...(error?.kind ? { errorKind: error.kind } : {}),
          ...(error?.status !== undefined ? { status: error.status } : {}),
        },
        // The classified cause, which `loadEntry` no longer logs itself.
        ...(error?.cause !== undefined ? { consoleArgs: [error.cause] } : {}),
      }
    );
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
   * Drop the spinner once *both* halves of the initial load have landed.
   * `_init()` fetches the sequence and the track data side by side, and either
   * can finish first: tracks that are all inline, or a fast-failing endpoint,
   * settle in a few microtasks while the sequence is still on the wire.
   * Clearing `loading` on the tracks alone fell through to the readiness gate
   * — a blank region for the rest of the sequence fetch, the very state the
   * spinner exists to replace.
   *
   * A sequence *failure* clears `loading` directly instead: it raises the
   * panel, which `render()` puts ahead of the spinner either way.
   */
  private _settleLoading(): void {
    if (!this._sequencePending && !this._tracksPending) this.loading = false;
  }

  /**
   * Correlate the batch's per-track outcomes back to the rows that own them,
   * then route every one of them.
   *
   * `trackUrls` is the authoritative per-track URL map returned by
   * `loadProtvistaData` (the loader is the single source of truth for which
   * URL each track fetched), so this never re-derives the substitution.
   * `fetchErrors` is the transport outcome per URL and `trackFailures` the
   * processing outcome per track — neither source logs or renders anything
   * itself, so this is the only place either reaches a person.
   *
   * Each failure becomes a {@link FailureReport} handed to `_report`, which
   * routes it. The panel is the one channel this method performs itself
   * (`deferPanel`): a batch of ten broken tracks must raise ONE aggregated
   * panel, not ten that overwrite each other. Whether there is a panel at all
   * is still the router's answer, not a `strict` check here.
   */
  private _collectTrackErrors(
    trackUrls: Record<string, string[]>,
    fetchErrors: Map<string, Omit<TrackFetchError, 'groupId' | 'trackId'>>,
    trackFailures: Record<string, TrackProcessingFailure>,
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
    // An HTTP 4xx from a *provider endpoint* is NOT a track error: it means
    // "this accession has no data of this kind" (a 404 is the common case).
    // We want the viewer to flag things that are *broken*, not *missing* — so
    // that 4xx is treated exactly like an empty response: the track simply
    // has no data and is hidden, with no badge, event, or panel.
    //
    // An *authored* source — the author's own data, a descriptor with a
    // `format` — is the opposite case, however it was written: `./hits.csv`,
    // an absolute URL, or the `{ url: … }` object form. The author wrote that
    // location themselves, and nothing publishes data at it conditionally — a
    // 404 can only mean the path or URL is wrong, which is the single most
    // common authoring mistake (a relative path resolves against the *hosting
    // page*, not the config file). The descriptor already says which kind of
    // source it is, so the classification reads it rather than discarding it.
    //
    // `from: file` is the author's location too, even when it names an
    // explicit `adapter:` instead of a `format` — the very descriptor the
    // validator recommends for a file it cannot sniff — so it counts here
    // alongside `isAuthoredSource` (`ownsLocation`).
    //
    // A track can fetch several URLs (an AlphaFold track reads the prediction
    // API *and* the Proteins API), so every one of its failures is weighed,
    // not just the first: a 503 on one URL must not hide behind a provider 404
    // on another.
    for (const group of this.config.rows) {
      for (const track of group.tracks) {
        const key = `${group.id}-${track.id}`;
        const authored = isAuthoredSource(track.data[0]);
        const fromFile = track.data[0]?.from === 'file';
        const ownsLocation = authored || fromFile;
        const failed = trackFetchFailures(trackUrls[key], fetchErrors);
        const broken = failed.find((e) => !isExpectedAbsence(e, ownsLocation));
        if (broken) {
          this._trackErrors.set(key, {
            ...broken,
            ...(ownsLocation ? { authored: true } : {}),
            ...(fromFile ? { fromFile } : {}),
            groupId: group.id,
            trackId: track.id,
          });
          continue;
        }
        // Only provider 4xxs — missing, not broken. Logged by the pass below.
        if (failed.length > 0) continue;
        // A track whose *processing* threw: a malformed file, a body the
        // adapter rejected, or an unregistered adapter name. Only reached
        // when none of the track's fetches failed — when one did, that
        // outcome is the explanation, and an adapter choking on the empty
        // body left behind must not resurrect a deliberately-silent 4xx.
        //
        // Severity gates this: an `info` outcome (a `from: custom` track
        // nobody injected data into) is an expected absence, so it must not
        // land in `_trackErrors` — that map is what draws badges and counts
        // towards a group being wholly broken.
        const failure = trackFailures[key];
        if (failure?.severity !== 'error') continue;
        this._trackErrors.set(key, {
          url: trackUrls[key]?.[0] ?? '',
          kind: 'adapter',
          message: failure.message,
          ...(authored ? { authored } : {}),
          ...(failure.retryable ? { retryable: true } : {}),
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
        group.tracks.every((t) => this._trackErrors.has(`${group.id}-${t.id}`))
      ) {
        this._groupErrors.add(group.id);
      }
    }

    // Report every track that (re)failed in THIS batch — for a partial
    // reload, only the reloaded tracks that still fail. `deferPanel` holds
    // back the panel channel so the aggregate below owns it; everything else
    // (console, event) is performed per track as routed.
    const failedKeys = [...this._trackErrors.keys()].filter(
      (k) => !only || only.has(k)
    );
    let panelWanted = false;
    for (const key of failedKeys) {
      const err = this._trackErrors.get(key)!;
      // The thrown value, so the developer channel keeps the stack (and a
      // parser's position) the derived wording leaves out. An `adapter`
      // failure's is the loader's; a `network` / `parse` failure carries its
      // own. Never a downstream cause under a fetch failure: a track whose
      // fetch failed can have one too — its adapter choking on the empty body
      // left behind — and printing that `TypeError` under an "HTTP 503" line
      // reads as a viewer bug rather than the outage it is.
      const cause =
        err.kind === 'adapter' ? trackFailures[key]?.cause : err.cause;
      const channels = this._report(this._trackFailureReport(key, err), {
        context: {
          groupId: err.groupId,
          // Omitted for an aggregate-scoped failure — there is no one track
          // to name, and reporting `null` would read as "track null".
          ...(err.trackId ? { trackId: err.trackId } : {}),
          // An `adapter` failure on an inline / custom source has no URL to
          // name, so the field is omitted rather than reported as `''`.
          ...(err.url ? { url: err.url } : {}),
          errorKind: err.kind,
          ...(err.status !== undefined ? { status: err.status } : {}),
        },
        ...(cause !== undefined ? { consoleArgs: [cause] } : {}),
        deferPanel: true,
      });
      panelWanted = panelWanted || channels.panel;
    }

    // A provider endpoint answering 4xx is an expected absence, not a
    // failure — the entity simply has no data of this kind. It routes to the
    // console and nowhere else (`info`), which is the one thing the old code
    // got backwards: it logged from the fetch closure, where the log could
    // not know whose track the URL belonged to, and dropped the fact
    // entirely once the closure stopped being the reporter.
    for (const group of this.config.rows) {
      for (const track of group.tracks) {
        const key = `${group.id}-${track.id}`;
        if (this._trackErrors.has(key)) continue;
        if (only && !only.has(key)) continue;
        // The only fetch failures the loop above leaves unpromoted: 4xxs from
        // provider endpoints. Spelt out rather than inferred so the two halves
        // of the classification cannot drift apart. One line per URL, so a
        // track reading two endpoints says which of them had nothing.
        const ownsLocation =
          isAuthoredSource(track.data[0]) || track.data[0]?.from === 'file';
        const absent = trackFetchFailures(trackUrls[key], fetchErrors).filter(
          (e) => isExpectedAbsence(e, ownsLocation)
        );
        for (const skipped of absent) {
          this._report(
            {
              severity: 'info',
              phase: 'track-fetch',
              scope: { trackKey: key },
              source: skipped.url,
              message: `[protvista-uniprot] track ${group.id}/${track.id}: no data (HTTP ${skipped.status}) at ${skipped.url}.`,
              consoleLevel: 'info',
            },
            { context: { groupId: group.id, trackId: track.id } }
          );
        }
        if (absent.length > 0) continue;
        // `from: custom` with nothing injected. Same expected absence, and the
        // wording is the one `specs/config-approach.md` pins.
        const failure = trackFailures[key];
        if (failure?.severity === 'info') {
          this._report(
            {
              severity: 'info',
              phase: 'track-fetch',
              scope: { trackKey: key },
              message: failure.message,
              consoleLevel: 'info',
            },
            { context: { groupId: group.id, trackId: track.id } }
          );
        }
      }
    }

    this._syncTrackPanel(panelWanted);
    this.requestUpdate();
  }

  /**
   * The {@link FailureReport} a recorded track failure routes as. One builder
   * for the correlation pass, the render walk, and `_syncTrackPanel`'s
   * re-evaluation of the whole set, so the three cannot route the same failure
   * differently.
   */
  private _trackFailureReport(
    key: string,
    err: TrackFetchError
  ): FailureReport {
    if (err.kind === 'render') {
      return {
        severity: 'error',
        phase: 'track-fetch',
        scope: { trackKey: key },
        ...(err.url ? { source: err.url } : {}),
        message: `[protvista] ${this._describeFetchError(err)}`,
        consoleLevel: 'error',
      };
    }
    return {
      severity: 'error',
      phase: 'track-fetch',
      scope: { trackKey: key },
      source: err.url || undefined,
      message: this._describeFetchError(err),
      recoverable: this._isRecoverable(err),
      consoleLevel: 'warn',
    };
  }

  /**
   * Keep the ONE aggregated track-fetch panel in step with the whole error
   * set — not with whichever batch or render walk happened to run last.
   *
   * Whether there should be a panel, and whether it offers Retry, is asked of
   * the router for every failure still in `_trackErrors`. Two concurrent
   * targeted Retries are separate batches, so the batch that *succeeds* must
   * not clear a panel the other's still-failing track keeps wanting; and a
   * render failure must not replace an aggregate that counts a retryable 503
   * with a one-track summary that offers nothing.
   *
   * `raise` is the caller's own routing answer: a new failure that wants the
   * panel raises (or re-raises) it. Without one, an open panel is refreshed
   * to the current set or cleared once nothing wants it, and a panel the user
   * dismissed stays dismissed — no new failure arrived to justify putting it
   * back. The summary names the single failure when there is one and counts
   * them otherwise. Its Retry re-runs the whole load (`_retryMount`), the
   * right scope for a notice that has replaced the entire viewer.
   */
  private _syncTrackPanel(raise: boolean): void {
    const entries = [...this._trackErrors.entries()];
    const routed = entries.map(([key, err]) =>
      this._route(this._trackFailureReport(key, err))
    );
    const wanted = routed.some((c) => c.panel);
    const isOpen = this._mountError?.phase === 'track-fetch';
    if (wanted && (raise || isOpen)) {
      const errs = entries.map(([, err]) => err);
      const summary =
        errs.length === 1
          ? `Track '${errs[0].groupId}${errs[0].trackId ? `/${errs[0].trackId}` : ''}' failed to load — ${this._describeFetchError(errs[0]).replace(/\.$/, '')}.`
          : `${errs.length} tracks failed to load.`;
      // Retryability spans the whole error set: the panel's Retry reloads
      // everything, so one transient failure among them is enough.
      const retryable = routed.some((c) => c.retry);
      this._setMountError('track-fetch', summary, undefined, retryable);
    } else if (!wanted && isOpen) {
      this._mountError = null;
    }
  }

  /**
   * Human-readable one-liner for a track data failure — the badge's detail
   * text, the `protvista-error` message, and the strict panel's summary, all
   * from one place.
   *
   * An `adapter` failure says exactly what was thrown: the decoders already
   * name the author's file and the offending row ("./hits.csv (parsed as
   * CSV): row 3, column \"start\": expected a number, got \"abc\""), which is
   * better than anything this method could synthesise. A `from: file` 4xx
   * names the path and the gotcha behind it, because a wrong relative path is
   * what it almost always is.
   */
  private _describeFetchError(err: TrackFetchError): string {
    switch (err.kind) {
      case 'network':
        return `Couldn't reach ${err.url}`;
      case 'parse':
        return err.message
          ? `Unparseable response from ${err.url} (${err.message})`
          : `Unparseable response from ${err.url}`;
      case 'adapter':
        // The author's own file: the decoder's text names the file and the
        // row, and is better than anything synthesised here. A provider
        // adapter's text names neither, so say where the data came from —
        // and not in words that send the reader looking for a file to fix.
        if (err.authored) {
          return err.message ?? `Couldn't process the data for ${err.url}`;
        }
        return err.url
          ? `Couldn't process the data from ${err.url}${err.message ? `: ${err.message}` : ''}`
          : (err.message ?? "Couldn't process this track's data");
      case 'render':
        return err.message ?? 'This track could not draw the data it was given';
      default:
        if (err.authored && (err.status ?? 0) < 500) {
          return err.fromFile
            ? `${err.url} could not be found (HTTP ${err.status}) — check the path is relative to the page.`
            : `${err.url} could not be found (HTTP ${err.status}) — check the URL.`;
        }
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

  /**
   * Host-level `change` handler, registered in capture phase in the
   * constructor so it runs before any other listener. It:
   *
   *   - records zoom/pan (`display-start` / `display-end`);
   *   - copies `nightingale-linegraph-track`'s lowercase `eventtype` to
   *     `eventType`, so there is one spelling for every track;
   *   - fills in a line-graph click, which Nightingale sends without a
   *     feature (see `_fillLinegraphClick`);
   *   - sets `detail.track` — which row/track the event came from, with the
   *     normalised kind, plus the clicked feature's own source track for a
   *     collapsed group's aggregate. A graph aggregate's points are built
   *     by Nightingale (or `_fillLinegraphClick`) and carry no source tag,
   *     so its source is the one track it draws.
   */
  private _onChangeCapture = (e: Event): void => {
    const detail = (e as ProtvistaChangeEvent).detail as
      ProtvistaChangeEventDetail | null | undefined;
    if (!detail || typeof detail !== 'object') return;

    if (detail['display-start']) {
      this.displayCoordinates.start = detail['display-start'];
    }
    if (detail['display-end']) {
      this.displayCoordinates.end = detail['display-end'];
    }
    if (detail.eventType === undefined && detail.eventtype !== undefined) {
      detail.eventType = detail.eventtype;
    }

    const origin = this._originOf(e);
    if (!origin) return;
    if (
      detail.eventType === 'click' &&
      detail.feature == null &&
      origin.element.localName === 'nightingale-linegraph-track'
    ) {
      this._fillLinegraphClick(detail, origin.key);
    }
    const source = getFeatureSource(detail.feature) ?? origin.source;
    detail.track = {
      ...origin.track,
      ...(source
        ? { sourceTrackId: source.trackId, sourceKind: source.kind }
        : {}),
    };
  };

  /**
   * The track element an event came from, found by walking its path for
   * the first id the renderer gave a track (`${CSS_PREFIX}-track-<key>`),
   * with the origin that key maps to.
   */
  private _originOf(e: Event):
    | {
        element: Element;
        key: string;
        track: ProtvistaTrackOrigin;
        source?: FeatureSource;
      }
    | undefined {
    const rows = this.config?.rows;
    if (!rows) return undefined;
    let origins = this._trackOrigins.get(rows);
    if (!origins) {
      origins = new Map();
      for (const row of rows) {
        // A graph aggregate draws only its first drawn track — the same rule
        // its payload is built with (`aggregatePayload`).
        const drawn =
          row.component === 'nightingale-linegraph-track' ||
          row.component === 'nightingale-colored-sequence'
            ? drawnAggregateTracks(row.tracks)[0]
            : undefined;
        origins.set(row.id, {
          track: { rowId: row.id, trackId: null, kind: null },
          ...(drawn
            ? { source: { trackId: drawn.id, kind: drawn.kind ?? null } }
            : {}),
        });
      }
      // Track keys after row keys: a standalone row renders only its track,
      // keyed `${row.id}-${track.id}`.
      for (const row of rows) {
        for (const track of row.tracks) {
          origins.set(trackKey(row.id, track.id), {
            track: {
              rowId: row.id,
              trackId: track.id,
              kind: track.kind ?? null,
            },
          });
        }
      }
      this._trackOrigins.set(rows, origins);
    }
    const prefix = `${CSS_PREFIX}-track-`;
    for (const node of e.composedPath()) {
      if (node === this) break;
      if (!(node instanceof Element) || !node.id.startsWith(prefix)) continue;
      const key = node.id.slice(prefix.length);
      const origin = origins.get(key);
      if (origin) return { element: node, key, ...origin };
    }
    return undefined;
  }

  /**
   * `nightingale-linegraph-track` sends a click with no `feature` and no
   * `coords`, so neither a consumer nor the built-in popover has anything
   * to show. Rebuild what its mouseover sends — each series' point at the
   * clicked position, keyed by series name — from the data this element
   * gave the track, add a `tooltipContent` listing them, and take `coords`
   * from the pointer event. The position comes from `highlight`
   * (`"i:i"`), which the track sets because we render it with
   * `highlight-on-click`.
   */
  private _fillLinegraphClick(
    detail: ProtvistaChangeEventDetail,
    key: string
  ): void {
    const position = Number(detail.highlight?.split(':')[0]);
    const series = this.data[key];
    if (!Number.isFinite(position) || !Array.isArray(series)) return;

    const feature: Record<string, unknown> = {};
    const rows: string[] = [];
    for (const { name, values } of series as Array<{
      name?: string;
      values?: Array<{ position: number; value: number }>;
    }>) {
      if (name === undefined) continue;
      const point = values?.find((v) => v.position === position);
      feature[name] = point;
      if (point) {
        rows.push(
          `<h5>${escapeHtml(name)}</h5><p>${escapeHtml(point.value)}</p>`
        );
      }
    }
    if (rows.length === 0) return;
    detail.feature = {
      ...feature,
      tooltipContent: `<h5>Position</h5><p>${position}</p>${rows.join('')}`,
    };
    const pointer = detail.parentEvent as MouseEvent | undefined;
    if (detail.coords == null && pointer && 'pageX' in pointer) {
      detail.coords = [pointer.pageX, pointer.pageY];
    }
  }

  connectedCallback() {
    super.connectedCallback();
    markOnce('protvista:script-start');
    this.registerStructuralComponents();
    warnLostProperties(this, {
      adapters: 'adapters',
      viewerconfig: 'viewerConfig',
      data: 'data',
    });

    if (!this.suspend) this._init();

    // Click-triggered tooltip display. The controller listens for the
    // same `change` event on this host, filters to
    // `eventType === 'click'`, and positions a `role="tooltip"` popover
    // via `@floating-ui/dom`. `notooltip` is checked per-click so
    // attribute changes take effect without a re-install.
    this._tooltipController = installClickTooltip(this, {
      enabled: () => !this.notooltip,
    });

    // `data-*` attributes feed URL template variables; re-load when one
    // changes. See `_onAttributesMutated`.
    this._variablesObserver = new MutationObserver(this._onAttributesMutated);
    this._variablesObserver.observe(this, { attributes: true });
  }

  disconnectedCallback() {
    clearTimeout(this._movedTimer);
    clearTimeout(this._announceTimer);
    this._variablesObserver?.disconnect();
    this._variablesObserver = undefined;
    if (this._variablesFrame !== undefined) {
      cancelAnimationFrame(this._variablesFrame);
      this._variablesFrame = undefined;
    }
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
    // accession has no entry, verify the identifier).
    //
    // Classify and return; do not log. `_reportSequenceFailure` is the failure
    // site here, and it routes one line through `_report` carrying `cause` —
    // two console lines for one failure was just this method reporting
    // something it had already delegated.
    let response: Response;
    try {
      response = await fetch(entryUrl(accession));
    } catch (e) {
      return { error: { kind: 'network', cause: e } };
    }
    if (!response.ok) {
      return { error: { kind: 'http', status: response.status } };
    }
    try {
      return { entry: await response.json() };
    } catch (e) {
      return { error: { kind: 'parse', cause: e } };
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
  renderStandaloneTrack(
    group: NormalizedConfig['rows'][number],
    index = 0,
    total = 1
  ) {
    const track = group.tracks[0];
    if (!track) return '';
    const key = `${group.id}-${track.id}`;
    const trackHasData = hasRenderableData(this.data[key]);
    const trackHasError = this._trackErrors.has(key);
    // Neither data nor a broken error: nothing to draw (the 4xx "missing"
    // path). With an error, the row still renders — label, `⚠` badge, and
    // Retry when the failure is recoverable — and only the content cell is
    // dropped. This mirrors `_renderExpandedTrack`, so a failed track looks
    // the same whether it sits in a group or on its own.
    if (!trackHasData && !trackHasError) {
      return '';
    }
    const attrs = renderingToAttrs(track.rendering);
    return html`
      <div
        class="${CSS_PREFIX}-group ${CSS_PREFIX}-group--standalone ${this._ghostClass(
          isRowHidden(group)
        )} ${this._movedClass(group.id)}"
        id="${CSS_PREFIX}-group_${group.id}"
      >
        <div
          class="${CSS_PREFIX}-track-label"
          title="${track.description ?? ''}"
        >
          <span class="${CSS_PREFIX}-label-text"
            >${
              (track.filterUI === 'nightingale-filter' &&
                this.getFilterComponent(key)) ||
              unsafeHTML(renderLabel(track.label, this.accession))
            }</span
          >${this._renderTrackBadge(key)}${this._renderRowControls(
            group,
            index,
            total
          )}
        </div>
        ${
          trackHasData
            ? html`<div
                class="${CSS_PREFIX}-track-content ${
                  track.component === 'nightingale-colored-sequence'
                    ? `${CSS_PREFIX}-track-content__coloured-sequence`
                    : ''
                }"
                data-id="${CSS_PREFIX}-track_${track.id}"
              >
                ${this.getTrack(
                  track.component,
                  'non-overlapping',
                  attrs.color,
                  attrs.shape,
                  key,
                  attrs.scale,
                  attrs.colorRange,
                  showsSeriesLabel([track])
                )}
              </div>`
            : ''
        }
      </div>
    `;
  }

  // ── Row rendering ───────────────────────────────────────────
  // The canvas renders `config.rows` directly: a layout edit rewrote them, so
  // there is no overlay to apply here. Data loading + aggregate computation
  // stay on the full row set, so a hidden track's data is still fetched and
  // revealing it is instant.

  /**
   * The rows to render, top to bottom.
   *
   * Normally that is the visible rows with their visible tracks. Customize
   * mode instead renders *every* row and track, hidden ones included, because
   * a row absent from the canvas would have no control to bring it back —
   * they render as stubs (see `_renderRowStub`).
   */
  private _rowsToRender(): DisplayRow[] {
    const rows = this.config?.rows ?? [];
    return this._customizeMode
      ? rows.map((row) => ({ row, tracks: row.tracks }))
      : displayRows(rows).filter((d) =>
          this._rowRendersContent(d.row, d.tracks)
        );
  }

  /**
   * Whether a row draws anything on the canvas: a standalone track with data
   * (or a visible fetch error), or a group with a renderable *visible* track
   * (or a visible fetch error).
   *
   * A group is judged by its *visible* `tracks` — the same slice
   * `_renderGroupBlock` renders from — NOT by the group aggregate
   * (`this.data[groupId]`). The aggregate leaves out hidden tracks too
   * (`_rebuildAggregates`), but it also leaves out `detailOnly` ones, so a
   * group whose only data is a visible `detailOnly` track still renders.
   * Judging by visible tracks means hiding the last track that actually draws
   * also hides the group.
   *
   * Dropping these rows from the *normal-mode* list — rather than leaving them
   * in the keyed `repeat` rendering to `''` — is what keeps a dataless group
   * from lingering. Customize mode renders every row (as a stub, with hidden
   * tracks ghosted), so the row's `repeat` key appears on entering the mode and
   * must disappear on leaving it; an entry that instead flips between a stub and
   * `''` on a *stable* key can leave its stub node behind. Hidden rows already
   * work this way — this gives empty rows the same clean add-then-remove
   * lifecycle.
   */
  private _rowRendersContent(
    row: NormalizedRow,
    tracks: NormalizedTrack[]
  ): boolean {
    if (row.standalone) {
      const track = row.tracks[0];
      if (!track) return false;
      const key = trackKey(row.id, track.id);
      // `|| _trackErrors.has(key)` is what keeps a *broken* standalone row on
      // the canvas, exactly as the grouped branch below does. Without it the
      // row vanished and `_renderAllHiddenNotice` claimed the user had hidden
      // everything — a false statement with a Reset-layout button that fixes
      // nothing. Standalone is the default shape for the starter kits, so this
      // was the most-reachable failure surface in the component.
      return hasRenderableData(this.data[key]) || this._trackErrors.has(key);
    }
    if (this._visibleGroupErrors.has(row.id)) return true;
    return tracks.some((t) => {
      const key = trackKey(row.id, t.id);
      return hasRenderableData(this.data[key]) || this._trackErrors.has(key);
    });
  }

  /** Render one row onto the canvas, with its customize-mode controls. */
  private _renderRow(display: DisplayRow, index: number, total: number) {
    const { row, tracks } = display;
    if (!this._customizeMode) {
      return row.standalone
        ? this.renderStandaloneTrack(row, index, total)
        : this._renderGroupBlock(row, tracks, index, total);
    }
    // A hidden row renders its real content, ghosted (see `-row--ghost`), so
    // the user can see what pressing Show would bring back. It falls through
    // to a stub only when there is genuinely nothing to draw.
    const body = row.standalone
      ? this.renderStandaloneTrack(row, index, total)
      : this._renderGroupBlock(row, tracks, index, total);
    return body || this._renderRowStub(row, index, total);
  }

  /**
   * A group row: a collapsible header + aggregate summary, then its tracks
   * when expanded.
   */
  private _renderGroupBlock(
    group: NormalizedRow,
    tracks: NormalizedTrack[],
    index: number,
    total: number
  ) {
    const groupHasData = hasRenderableData(this.data[group.id]);
    const groupHasError = this._visibleGroupErrors.has(group.id);
    const anyTrackRenderable = tracks.some((t) => {
      const key = trackKey(group.id, t.id);
      return hasRenderableData(this.data[key]) || this._trackErrors.has(key);
    });
    if (!anyTrackRenderable && !groupHasData && !groupHasError) {
      return '';
    }

    // Collapsed with an error but no aggregate: header + badge only
    // (mirrors the previous group-error row).
    if (!this.openGroups.includes(group.id) && !groupHasData && groupHasError) {
      return this.renderGroupErrorRow(group);
    }

    const groupAttrs = renderingToAttrs(group.rendering);
    const expanded = this.openGroups.includes(group.id);
    return html`
      <div
        class="${CSS_PREFIX}-group ${this._ghostClass(
          isRowHidden(group)
        )} ${this._movedClass(group.id)}"
        id="${CSS_PREFIX}-group_${group.id}"
      >
        ${
          this._customizeMode
            ? // While customizing, the label cell holds real buttons, so it
              // cannot itself be one — nesting interactive controls is an axe
              // violation and leaves the inner buttons unreachable to some
              // assistive tech. Collapse/expand moves into the control cluster
              // as its own button, which is a better affordance anyway.
              html`<div
                class="${CSS_PREFIX}-group-label"
                title="${group.description ?? ''}"
              >
                ${this._collapseButton(
                  group,
                  this._labelText(group.label),
                  expanded
                )}<span class="${CSS_PREFIX}-label-text"
                  >${unsafeHTML(renderLabel(group.label, this.accession))}</span
                >${this._renderGroupBadge(group.id)}${this._renderRowControls(
                  group,
                  index,
                  total
                )}
              </div>`
            : html`<div
                class="${CSS_PREFIX}-group-label${expanded ? ' open' : ''}"
                data-group-toggle="${group.id}"
                role="button"
                tabindex="0"
                aria-expanded="${expanded}"
                title="${group.description ?? ''}"
                @click="${this.handleGroupClick}"
                @keydown="${this.handleGroupKeydown}"
              >
                <span class="${CSS_PREFIX}-label-text"
                  >${unsafeHTML(renderLabel(group.label, this.accession))}</span
                >${this._renderGroupBadge(group.id)}
              </div>`
        }
        <div
          data-id="${CSS_PREFIX}-group_${group.id}"
          class="${CSS_PREFIX}-aggregate-track-content ${CSS_PREFIX}-track-content ${
            group.component === 'nightingale-colored-sequence'
              ? `${CSS_PREFIX}-track-content__coloured-sequence`
              : ''
          }"
          .style="${expanded ? 'opacity:0' : 'opacity:1'}"
        >
          ${
            groupHasData
              ? this.getTrack(
                  group.component,
                  'non-overlapping',
                  groupAttrs.color,
                  groupAttrs.shape,
                  group.id,
                  groupAttrs.scale,
                  groupAttrs.colorRange,
                  // Keyed off the track the aggregate actually draws: a graph
                  // group's payload is its first drawn track
                  // (`drawnAggregateTracks` — not `detailOnly`, not hidden, in
                  // the current order), not merely the first visible one.
                  showsSeriesLabel(
                    drawnAggregateTracks(group.tracks).slice(0, 1)
                  )
                )
              : ''
          }
        </div>
      </div>
      ${
        expanded
          ? html`${repeat(
              tracks,
              (t) => t.id,
              (t, i) => this._renderExpandedTrack(group, t, i, tracks.length)
            )}`
          : ''
      }
    `;
  }

  /** The empty-state message: nothing to draw, and nothing hidden. */
  private _renderNoResults() {
    // No accession is reachable here when a host supplies `sequence` itself,
    // so the "for …" clause is dropped rather than left dangling.
    const forWhat = this.accession ? ` for ${this.accession}` : '';
    return html`<div class="protvista-no-results">
      No feature data available${forWhat}
    </div>`;
  }

  /**
   * Shown when the user has hidden everything. Without it the viewer would
   * look broken — an empty frame with no hint that the tracks are one click
   * from coming back.
   *
   * Only a genuinely-hidden canvas reaches here: a row whose data *failed*
   * stays in `_rowsToRender` carrying its `⚠` badge (see
   * `_rowRendersContent`), and a canvas that is empty with nothing hidden gets
   * the no-results message instead (see `render()`), so this notice never
   * stands in for a load failure or an absence it cannot fix.
   */
  private _renderAllHiddenNotice() {
    return html`
      <div class="${CSS_PREFIX}-all-hidden" role="status">
        <p>All tracks are hidden.</p>
        <button
          type="button"
          class="${CSS_PREFIX}-customize-action"
          @click="${this._onResetLayout}"
        >
          Reset layout
        </button>
      </div>
    `;
  }

  /**
   * A single track row inside a group (`.group__track`, visible by default).
   * Outside customize mode this is byte-identical to the pre-customize
   * markup, so the default view is unchanged.
   */
  private _renderExpandedTrack(
    group: NormalizedRow,
    track: NormalizedTrack,
    index: number,
    total: number
  ) {
    const key = trackKey(group.id, track.id);
    const trackHasData = hasRenderableData(this.data[key]);
    const trackHasError = this._trackErrors.has(key);
    // A track with neither data nor a (broken) error renders nothing — this
    // is also the 4xx "missing" path. In customize mode it still needs a
    // control to move it, so it falls through to a stub instead of vanishing.
    // A *hidden* track does not: it keeps its canvas, ghosted, so the user
    // can see what they would be restoring.
    if (!trackHasData && !trackHasError) {
      return this._customizeMode
        ? this._renderTrackStub(group, track, index, total)
        : '';
    }
    const attrs = renderingToAttrs(track.rendering);
    return html`
      <div
        class="${CSS_PREFIX}-group__track ${CSS_PREFIX}-track--nested ${this._ghostClass(
          !!track.hidden || !!group.hidden
        )} ${this._movedClass(trackKey(group.id, track.id))}"
        id="${CSS_PREFIX}-track_${track.id}"
      >
        <div
          class="${CSS_PREFIX}-track-label"
          title="${track.description ?? ''}"
        >
          <span class="${CSS_PREFIX}-label-text"
            >${
              (track.filterUI === 'nightingale-filter' &&
                this.getFilterComponent(key)) ||
              unsafeHTML(renderLabel(track.label, this.accession))
            }</span
          >${this._renderTrackBadge(key)}${this._renderTrackControls(
            group,
            track,
            index,
            total
          )}
        </div>
        ${
          trackHasData
            ? html`<div
                class="${CSS_PREFIX}-track-content ${
                  group.component === 'nightingale-colored-sequence'
                    ? `${CSS_PREFIX}-track-content__coloured-sequence`
                    : ''
                }"
                data-id="${CSS_PREFIX}-track_${track.id}"
              >
                ${this.getTrack(
                  track.component,
                  'non-overlapping',
                  attrs.color,
                  attrs.shape,
                  key,
                  attrs.scale,
                  attrs.colorRange,
                  showsSeriesLabel([track])
                )}
              </div>`
            : ''
        }
      </div>
    `;
  }

  // ── Customize-mode stubs ────────────────────────────────────
  // Two kinds of row are invisible on the canvas: ones the user hid, and ones
  // whose data never arrived. Both must stay reachable in customize mode —
  // otherwise hiding a row would be a one-way door. A stub is the label cell
  // and its controls with an empty content cell: enough to show what it is
  // and to move or restore it, without pretending there is data to draw.

  /** A whole row reduced to its label and controls. */
  private _renderRowStub(row: NormalizedRow, index: number, total: number) {
    // Groups keep a collapse control even when they have no data — expanding
    // lists the tracks the group *could* hold, each as its own stub, so the
    // arrow does something and the user can see (and manage) what is missing.
    // Standalone rows have no inside, so they get no collapse control.
    const collapsible = !row.standalone;
    const expanded = this.openGroups.includes(row.id);
    return html`
      <div
        class="${CSS_PREFIX}-group__track ${CSS_PREFIX}-row--stub ${CSS_PREFIX}-row--hidden ${this._movedClass(
          row.id
        )}"
        id="${CSS_PREFIX}-group_${row.id}"
      >
        <div class="${CSS_PREFIX}-track-label" title="${row.description ?? ''}">
          ${
            collapsible
              ? this._collapseButton(row, this._labelText(row.label), expanded)
              : ''
          }<span class="${CSS_PREFIX}-label-text"
            >${unsafeHTML(renderLabel(row.label, this.accession))}</span
          >${this._renderRowControls(row, index, total)}
        </div>
        <div class="${CSS_PREFIX}-track-content"></div>
      </div>
      ${
        collapsible && expanded
          ? html`${repeat(
              row.tracks,
              (t) => t.id,
              (t, i) => this._renderTrackStub(row, t, i, row.tracks.length)
            )}`
          : ''
      }
    `;
  }

  /** One track inside a group reduced to its label and controls. */
  private _renderTrackStub(
    group: NormalizedRow,
    track: NormalizedTrack,
    index: number,
    total: number
  ) {
    return html`
      <div
        class="${CSS_PREFIX}-group__track ${CSS_PREFIX}-track--nested ${CSS_PREFIX}-row--stub ${CSS_PREFIX}-row--hidden ${this._movedClass(
          trackKey(group.id, track.id)
        )}"
        id="${CSS_PREFIX}-track_${track.id}"
      >
        <div
          class="${CSS_PREFIX}-track-label"
          title="${track.description ?? ''}"
        >
          <span class="${CSS_PREFIX}-label-text"
            >${unsafeHTML(renderLabel(track.label, this.accession))}</span
          >${this._renderTrackControls(group, track, index, total)}
        </div>
        <div class="${CSS_PREFIX}-track-content"></div>
      </div>
    `;
  }

  /** Plain-text label (Markdoc → text), for `aria-label`s and announcements. */
  private _labelText(source: string): string {
    const key = `${this.accession}\n${source}`;
    const cached = this._labelTextCache.get(key);
    if (cached !== undefined) return cached;
    const html = renderLabel(source, this.accession);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const text = (doc.body.textContent || '').trim() || source;
    this._labelTextCache.set(key, text);
    return text;
  }

  // ── "Customize layout" mode ─────────────────────────────────
  // Editing happens on the rows themselves: a toggle in the label column
  // turns every row's label cell into a control cluster (hide/show, move
  // up/down, drag grip). Nothing overlays or displaces the visualization, so
  // the user watches the actual tracks reflow as they arrange them.
  //
  // These controls only exist in customize mode. Always-on affordances would
  // compete with Nightingale's own hover / click-highlight / ctrl-scroll
  // interactions for the same pointer gestures; a mode keeps "operate the
  // data" and "arrange the layout" apart, and gives assistive tech a single
  // announceable state change instead of a scatter of permanent controls.

  private _toggleCustomizeMode = () => {
    this._customizeMode = !this._customizeMode;
    this._movedKey = null;
    this._announcement = this._customizeMode
      ? 'Customize layout on. Use the controls on each row to reorder, show, or hide it.'
      : 'Customize layout off.';
  };

  /**
   * The Customize button and hidden-count badge. Rendered into the empty
   * label-column cell beside the navigation rather than a toolbar above the
   * viewer, so opening customize mode never shifts the visualization — and so
   * the button sits in the same column as the per-row controls it turns on.
   */
  private _renderCustomizeToggle() {
    // Counted per track, and excluding tracks that have nothing to draw —
    // those are missing because no data arrived, not because anyone hid them.
    const hidden = hiddenCount(this.config?.rows ?? [], (rowId, trackId) =>
      this._trackIsEmpty(rowId, trackId)
    );
    return html`
      <button
        type="button"
        class="${CSS_PREFIX}-customize-toggle"
        aria-pressed="${this._customizeMode}"
        @click="${this._toggleCustomizeMode}"
      >
        <span class="${CSS_PREFIX}-customize-toggle__icon" aria-hidden="true"
          >${svg`${unsafeHTML(inlineSvg(slidersIcon))}`}</span
        >
        Customize
      </button>
      ${hidden > 0 ? this._renderHiddenCount(hidden) : ''}
    `;
  }

  /**
   * The "N hidden" badge. A button, not a label: it explains how to get the
   * tracks back, and a plain `<span title>` would put that explanation out of
   * reach of anyone not using a mouse. Pressing it opens customize mode,
   * which is where the Show controls are.
   */
  private _renderHiddenCount(hidden: number) {
    const noun = hidden === 1 ? 'track' : 'tracks';
    const label = `${hidden} ${noun} hidden`;
    const hint = `${label}. Open Customize and switch a row back on to restore it.`;
    return html`
      <button
        type="button"
        class="${CSS_PREFIX}-hidden-count"
        title="${hint}"
        aria-label="${hint}"
        @click="${this._onHiddenCountClick}"
      >
        ${label}
      </button>
    `;
  }

  /**
   * Pressing the "N hidden" badge: enter customize mode and open every group
   * holding a hidden track.
   *
   * Entering the mode alone is not enough. A hidden group collapses to one
   * stub and a collapsed visible group hides its tracks behind the caret, so
   * the tracks the badge just counted could still be nowhere on screen. This
   * opens exactly the groups those tracks are in, so the badge lands the user
   * on the controls that undo the hide.
   */
  private _onHiddenCountClick = () => {
    // Idempotent — the badge must never toggle the mode back off.
    if (!this._customizeMode) this._toggleCustomizeMode();

    const toOpen = this._rowsHoldingHiddenTracks();
    const added = toOpen.filter((id) => !this.openGroups.includes(id));
    if (added.length > 0) this.openGroups = [...this.openGroups, ...added];

    this._announce(
      added.length > 0
        ? `Opened ${added.length} group${added.length === 1 ? '' : 's'} containing hidden tracks.`
        : 'Hidden tracks are listed below.'
    );
  };

  /**
   * Ids of the groups holding at least one hidden track — the same tracks the
   * badge counts, so empty ones are excluded here too.
   */
  private _rowsHoldingHiddenTracks(): string[] {
    return (this.config?.rows ?? [])
      .filter(
        (row) =>
          !row.standalone &&
          row.tracks.some(
            (t) => (row.hidden || t.hidden) && !this._trackIsEmpty(row.id, t.id)
          )
      )
      .map((row) => row.id);
  }

  /** Reset / Done, shown beside the toggle only while customizing. */
  private _renderCustomizeActions() {
    const edited = !isDefaultLayout(this.getLayout());
    return html`
      <button
        type="button"
        class="${CSS_PREFIX}-customize-action"
        ?disabled="${!edited}"
        @click="${this._onResetLayout}"
      >
        Reset
      </button>
      <button
        type="button"
        class="${CSS_PREFIX}-customize-action"
        @click="${this._onCloseCustomize}"
      >
        Done
      </button>
    `;
  }

  /** Leave customize mode and return focus to the toggle that opened it. */
  private _onCloseCustomize = () => {
    this._toggleCustomizeMode();
    void this.updateComplete.then(() => {
      this.querySelector<HTMLElement>(
        `.${CSS_PREFIX}-customize-toggle`
      )?.focus();
    });
  };

  private _onResetLayout = () => {
    this.resetLayout();
    this._announce('Layout reset to the authored default.');
  };

  /**
   * Announce an outcome to screen readers via the polite live region. Every
   * move and toggle announces, because the visible result of a reorder is far
   * off in the canvas and a hide removes the very row that had focus (WCAG
   * 4.1.3 Status Messages).
   */
  private _announce(message: string): void {
    this._announcement = message;
  }

  // ── Per-row controls ────────────────────────────────────────
  // Every control is a real <button>, never a bare icon on a <div>. The
  // show/hide control is a `role="switch"` (see `_toggleButton`): its state is
  // carried by `aria-checked` and the thumb's position, not by colour alone
  // (WCAG 1.4.1). The move buttons carry a text/`aria-label` name.
  //
  // Reordering is move-up/move-down only — there is no drag. Buttons are the
  // path that works for keyboard, touch and pointer alike (and the one WCAG
  // 2.5.7 requires anyway), and the moved row is highlighted afterwards so
  // the result is easy to find.

  /**
   * Controls for a whole row: collapse/expand (groups only, see
   * `_renderGroupBlock`), hide/show, move up/down.
   */
  private _renderRowControls(row: NormalizedRow, index: number, total: number) {
    if (!this._customizeMode) return '';
    const name = this._labelText(row.label);
    // "Hidden" for the toggle means the row draws nothing in the real view —
    // not just that its own `hidden` flag is set. A group whose only
    // data-bearing track was hidden (the rest empty for this protein) shows
    // nothing, so its toggle reads off even though `row.hidden` is false;
    // clicking it then reveals the group (and un-hides that track). This
    // mirrors `_rowRendersContent`, which drives normal-mode visibility.
    const hidden =
      isRowHidden(row) || !this._rowRendersContent(row, visibleTracks(row));
    // Nothing to draw anywhere in the row *at all* (every track empty, none
    // merely hidden): showing it would change nothing, so the toggle is
    // disabled and says why instead of offering a no-op.
    const empty = row.tracks.every((t) => this._trackIsEmpty(row.id, t.id));
    return html`
      <span class="${CSS_PREFIX}-row-controls">
        ${this._toggleButton(hidden, name, empty, () =>
          this.setRowVisibility(row.id, hidden)
        )}
        ${this._moveButton(-1, name, index, total, (b) =>
          this._moveRowBy(row, index, -1, b)
        )}
        ${this._moveButton(1, name, index, total, (b) =>
          this._moveRowBy(row, index, 1, b)
        )}
      </span>
    `;
  }

  /** Controls for one track inside a group. Moves stay within the group. */
  private _renderTrackControls(
    group: NormalizedRow,
    track: NormalizedTrack,
    index: number,
    total: number
  ) {
    if (!this._customizeMode) return '';
    const name = this._labelText(track.label);
    // A track inside a hidden group is not drawn either, whatever its own
    // flag says, so its control has to offer Show rather than Hide.
    const hidden = !!track.hidden || !!group.hidden;
    const empty = this._trackIsEmpty(group.id, track.id);
    return html`
      <span class="${CSS_PREFIX}-row-controls">
        ${this._toggleButton(hidden, name, empty, () =>
          this.setTrackVisibility(group.id, track.id, hidden)
        )}
        ${this._moveButton(-1, name, index, total, (b) =>
          this._moveTrackBy(group, track, index, -1, b)
        )}
        ${this._moveButton(1, name, index, total, (b) =>
          this._moveTrackBy(group, track, index, 1, b)
        )}
      </span>
    `;
  }

  /**
   * Whether a track has nothing to draw — no data arrived and no error to
   * report. Such a track is absent from the canvas no matter what the user
   * does, so customize mode shows it but offers no working Show.
   */
  private _trackIsEmpty(rowId: string, trackId: string): boolean {
    const key = trackKey(rowId, trackId);
    return !hasRenderableData(this.data[key]) && !this._trackErrors.has(key);
  }

  /**
   * The group collapse/expand control, as a real button. Outside customize
   * mode this affordance lives on the group label itself; here it has to be
   * separate, because the label cell holds the other controls and cannot be
   * a button around buttons.
   *
   * Collapse stays distinct from hide: collapsing swaps a group's tracks for
   * its aggregate summary, hiding removes the row. One control must never do
   * both.
   */
  private _collapseButton(row: NormalizedRow, name: string, expanded: boolean) {
    return html`
      <button
        type="button"
        class="${CSS_PREFIX}-row-collapse"
        data-group-toggle="${row.id}"
        aria-expanded="${expanded}"
        aria-label="${expanded ? 'Collapse' : 'Expand'} ${name}"
        @click="${this.handleGroupClick}"
      ></button>
    `;
  }

  /**
   * The visibility switch.
   *
   * A switch rather than a Hide/Show button because this *is* a state, not an
   * action: "Hide" on a visible row asked the reader to invert it mentally to
   * work out the current state. `role="switch"` + `aria-checked` says it
   * directly, and the thumb's position says it visually — a non-colour
   * channel, so WCAG 1.4.1 holds without a word beside it. Dropping that word
   * also returns ~45px of a fixed-width column to the label.
   *
   * The accessible name is the *purpose* ("Show Domains"), never the current
   * state; `aria-checked` carries the state, which is the correct split for a
   * switch and keeps the name stable as it flips.
   *
   * `empty` disables it, off: a track with no data is absent whatever the
   * switch says, so it must not offer a flip that would do nothing, nor claim
   * to be on when nothing is drawn. The reason joins the accessible name
   * rather than sitting only in `title` — dropping the visible word means a
   * screen-reader user would otherwise have no way to learn it, and a
   * disabled control is not reachable by Tab to hear a description.
   */
  private _toggleButton(
    hidden: boolean,
    name: string,
    empty: boolean,
    onClick: () => void
  ) {
    // Off follows what the reader sees, not the config flag: a dataless track
    // is not `hidden`, but it is not drawn either.
    const on = !hidden && !empty;
    return html`
      <button
        type="button"
        role="switch"
        class="${CSS_PREFIX}-switch"
        aria-checked="${on}"
        aria-label="${empty ? `Show ${name} — no data` : `Show ${name}`}"
        title="${empty ? 'This protein has no data for this track' : ''}"
        ?disabled="${empty}"
        @click="${(e: Event) => {
          e.stopPropagation();
          onClick();
          this._announce(`${name} ${hidden ? 'shown' : 'hidden'}.`);
        }}"
      >
        <span class="${CSS_PREFIX}-switch__thumb" aria-hidden="true"></span>
      </button>
    `;
  }

  /** A move-up (`dir: -1`) or move-down (`dir: 1`) button, disabled at the ends. */
  private _moveButton(
    dir: -1 | 1,
    name: string,
    index: number,
    total: number,
    onClick: (button: HTMLButtonElement) => void
  ) {
    const atEnd = dir === -1 ? index === 0 : index === total - 1;
    return html`
      <button
        type="button"
        class="${CSS_PREFIX}-row-control ${CSS_PREFIX}-row-control--move${
          dir === 1 ? ` ${CSS_PREFIX}-row-control--down` : ''
        }"
        aria-label="Move ${name} ${dir === -1 ? 'up' : 'down'}"
        ?disabled="${atEnd}"
        @click="${(e: Event) => {
          e.stopPropagation();
          onClick(e.currentTarget as HTMLButtonElement);
        }}"
      >
        <span aria-hidden="true"
          >${svg`${unsafeHTML(inlineSvg(chevronUpIcon))}`}</span
        >
      </button>
    `;
  }

  /** Move a row by one position, highlight it, and announce where it landed. */
  private _moveRowBy(
    row: NormalizedRow,
    index: number,
    delta: -1 | 1,
    button: HTMLButtonElement
  ): void {
    if (!this.config) return;
    const total = this.config.rows.length;
    const to = index + delta;
    if (to < 0 || to >= total) return;
    this._commitRows(moveRow(this.config.rows, row.id, to));
    this._markMoved(row.id);
    this._keepFocusAfterMove(button);
    this._announceMove(this._labelText(row.label), to, total);
  }

  /** Move a track within its group by one position, highlight, and announce. */
  private _moveTrackBy(
    group: NormalizedRow,
    track: NormalizedTrack,
    index: number,
    delta: -1 | 1,
    button: HTMLButtonElement
  ): void {
    if (!this.config) return;
    const total = group.tracks.length;
    const to = index + delta;
    if (to < 0 || to >= total) return;
    this._commitRows(moveTrack(this.config.rows, group.id, track.id, to));
    this._markMoved(trackKey(group.id, track.id));
    this._keepFocusAfterMove(button);
    this._announceMove(this._labelText(track.label), to, total);
  }

  private _announceMove(name: string, to: number, total: number): void {
    this._announce(`${name} moved to position ${to + 1} of ${total}.`);
  }

  /**
   * Mark a row/track as just-moved so it can be highlighted, and arm the
   * timer that clears the mark.
   *
   * Reordering is button-only, and a row can travel a long way in one press —
   * far enough to leave the viewport, and always far enough to lose track of
   * visually. The announcement covers screen-reader users; this covers
   * everyone else.
   */
  private _markMoved(key: string): void {
    this._movedKey = key;
    clearTimeout(this._movedTimer);
    this._movedTimer = setTimeout(() => {
      this._movedKey = null;
    }, MOVED_HIGHLIGHT_MS);
  }

  /**
   * The ghost class for a row that is hidden while customizing. Its content
   * is still drawn — desaturated and faded — so the user sees what Show
   * would bring back, and so a hidden row never looks like a dataless one.
   * Outside customize mode a hidden row is not rendered at all.
   */
  private _ghostClass(hidden: boolean): string {
    return this._customizeMode && hidden ? `${CSS_PREFIX}-row--ghost` : '';
  }

  /** The just-moved highlight class for a row/track, if it is the one. */
  private _movedClass(key: string): string {
    return this._movedKey === key ? `${CSS_PREFIX}-row--moved` : '';
  }

  /**
   * Keep focus usable after a move. The move buttons live inside a keyed
   * row, so the element itself survives the reorder and keeps focus — except
   * when the row lands at an end and the button the user just pressed becomes
   * disabled. Hand focus to its opposite number so the keyboard path doesn't
   * dead-end.
   */
  private _keepFocusAfterMove(button: HTMLButtonElement): void {
    void this.updateComplete.then(() => {
      if (!button.disabled) return;
      const sibling = button.parentElement?.querySelector<HTMLButtonElement>(
        `.${CSS_PREFIX}-row-control--move:not([disabled])`
      );
      sibling?.focus({ preventScroll: true });
    });
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
    // The spinner goes BEFORE the readiness gate, not after it. Gated behind
    // it, the spinner could only appear in the narrow window between the
    // sequence landing and the track fetches finishing — so the element
    // rendered nothing at all during its longest wait, and a slow connection
    // showed a blank region that reads as "broken". `loading` starts `true`,
    // and `_settleLoading` clears it only once the sequence *and* the first
    // track fetches have both landed, so moving the check up covers the whole
    // initial load: config, sequence, and tracks, in whichever order they
    // finish. `_mountError` is still checked above, so an error panel replaces
    // the spinner rather than sitting under it.
    if (this.loading) {
      return html`<div
          class="${CSS_PREFIX}-live-region"
          role="status"
          aria-live="polite"
        >
          ${this._announcement}
        </div>
        <div class="protvista-loader">
          ${svg`${unsafeHTML(inlineSvg(loaderIcon))}`}
        </div>`;
    }
    // Component isn't ready
    if (!this.sequence || !this.config) {
      return html``;
    }
    // Derive error visibility once for this render — every group/track
    // badge decision below reads the precomputed sets.
    this._recomputeErrorVisibility();
    if (!this.hasData) {
      // Fall through to the viewer only when there's a *visible* track
      // error to show a badge for; otherwise the blanket no-results
      // message (the silent-hide path) stands.
      if (!this._anyVisibleError) return this._renderNoResults();
    }
    const rows = this._rowsToRender();
    // No row draws anything. That is "all tracks are hidden" only when the
    // user hid something that would draw — `hasData` is a coarse heuristic
    // (a raw `features` response with none matching a track's `filter:` still
    // sets it), so it cannot tell an empty canvas from a hidden one. A canvas
    // with nothing hidden has no data, and a Reset-layout button there would
    // fix nothing.
    if (
      rows.length === 0 &&
      this.config.rows.length > 0 &&
      hiddenCount(this.config.rows, (rowId, trackId) =>
        this._trackIsEmpty(rowId, trackId)
      ) === 0
    ) {
      return this._renderNoResults();
    }
    return html`
      <div class="${CSS_PREFIX}-live-region" role="status" aria-live="polite">
        ${this._announcement}
      </div>
      <nightingale-manager
        class="${this._customizeMode ? `${CSS_PREFIX}--customizing` : ''}"
        reflected-attributes="length display-start display-end highlight activefilters filters"
      >
        <div class="${CSS_PREFIX}-nav-container">
          <div class="${CSS_PREFIX}-nav-track-label">
            <div class="${CSS_PREFIX}-toolbar-row">
              ${this._renderCustomizeToggle()}
            </div>
            <div
              class="${CSS_PREFIX}-toolbar-row ${
                this._customizeMode ? '' : `${CSS_PREFIX}-toolbar-row--reserved`
              }"
            >
              ${this._renderCustomizeActions()}
            </div>
          </div>
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
        ${
          rows.length === 0 && this.config.rows.length > 0
            ? this._renderAllHiddenNotice()
            : ''
        }
        ${repeat(
          // Keyed on the row id so a reorder *moves* the Nightingale DOM
          // nodes instead of re-binding canvases positionally, keeping
          // nightingale-manager alignment intact.
          rows,
          (display) => display.row.id,
          (display, i) => this._renderRow(display, i, rows.length)
        )}
        <div
          class="${CSS_PREFIX}-nav-container ${CSS_PREFIX}-nav-container--footer"
        >
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
        ${
          !this.nostructure
            ? html`
                <protvista-uniprot-structure
                  accession="${this.accession || ''}"
                ></protvista-uniprot-structure>
              `
            : ''
        }
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
          ${
            dismissible || retryable
              ? html`<div class="${CSS_PREFIX}-error-panel__actions">
                  ${
                    retryable
                      ? html`<button
                          type="button"
                          class="${CSS_PREFIX}-error-retry"
                          @click="${() => this._retryMount()}"
                        >
                          Retry
                        </button>`
                      : ''
                  }
                  ${
                    dismissible
                      ? html`<button
                          type="button"
                          aria-label="Dismiss error"
                          @click="${() => this._dismissError()}"
                        >
                          Dismiss
                        </button>`
                      : ''
                  }
                </div>`
              : ''
          }
        </div>
        ${
          err.groups && err.groups.length
            ? html`<details class="${CSS_PREFIX}-error-issues" open>
                <summary>${count} issue${count === 1 ? '' : 's'}</summary>
                ${err.groups.map(
                  (g) => html`
                    <div class="${CSS_PREFIX}-error-issue">
                      <div class="${CSS_PREFIX}-error-issue__path">
                        ${g.path}
                      </div>
                      ${g.items.map(
                        (it) =>
                          html`<div>
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
            : ''
        }
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
      ><span id="${descId}" class="${CSS_PREFIX}-visually-hidden"
        >${detail}</span
      >${
        retryKeys.length
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
          : ''
      }`;
  }

  /**
   * Whether a failure is worth retrying.
   *
   * Transport problems (`network` — connectivity may return) and server errors
   * (`http` 5xx — may be transient) are, as is **any** HTTP failure on an
   * authored source. That one looks odd next to the others: a static file
   * that 404s will 404 again. But the author is the one who can fix it, and
   * they fix it by correcting the path or dropping the file into place —
   * after which Retry reloads that one track instead of the whole page. The
   * affordance is for the person who can act, not for the server.
   *
   * So is a *provider adapter's* own throw (`retryable`, set by the loader,
   * which alone knows which step threw). A provider adapter is not a pure
   * decoder: it can make requests of its own (the AlphaFold confidence
   * adapter fetches a second file), so its throw may be the same transient
   * outage a 5xx is, and the reader has no file to fix.
   *
   * Everything else is deterministic and gets no Retry: a provider 4xx (which
   * is not recorded as a failure at all), a `parse` failure that would
   * re-parse the same body, a decoder rejecting the author's own file or a
   * `setTrackData()` payload, an unregistered adapter name — the same code
   * over the same input — and a `render` failure that would hand the
   * component the same payload.
   */
  private _isRecoverable(err: TrackFetchError): boolean {
    return (
      err.kind === 'network' ||
      (err.kind === 'http' && ((err.status ?? 0) >= 500 || !!err.authored)) ||
      (err.kind === 'adapter' && !!err.retryable)
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
    // An aggregate-scoped failure (the collapsed view rejected its payload)
    // has a message of its own worth more than the generic count — it names
    // what the element could not read.
    const aggregate = this._trackErrors.get(groupId);
    const detail =
      aggregate?.trackId === null && aggregate.message
        ? aggregate.message
        : this._groupErrors.has(groupId)
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
    this._toggleGroupFromEvent(e);
  }

  /**
   * Keyboard operability for the group-collapse toggle. The label carries
   * `role="button"` + `tabindex="0"`, so it must activate on Enter and
   * Space like a native button. Space is `preventDefault`ed to stop the
   * page scrolling; Enter for consistency.
   *
   * A label may nest an inline `<a>` (Markdoc). Tabbing to that link and
   * pressing Enter activates the link — its keydown `target` is the `<a>`,
   * so `_toggleGroupFromEvent` bails and the group does not toggle.
   */
  handleGroupKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    e.preventDefault();
    this._toggleGroupFromEvent(e);
  }

  /** Shared toggle path for pointer (`click`) and keyboard (`keydown`). */
  private _toggleGroupFromEvent(e: Event) {
    const target = e.target as Element;
    // A Markdoc-rendered label can contain an inline link. Activating that
    // link should navigate only — not also collapse/expand the group — so
    // bail before the toggle logic when the event landed on (or inside) an
    // <a>.
    if (target.closest('a')) return;
    // Climb to the group-label host regardless of what inner inline
    // element (a `{% help %}` span, emphasis) the event landed on — a
    // Markdoc-rendered label can nest arbitrary inline markup, so a
    // single-level `parentElement` hop is no longer sufficient.
    const host = target.closest('[data-group-toggle]');
    if (!host) return;

    const toggle = host.getAttribute('data-group-toggle');
    if (!toggle) return;

    // Direction comes from `openGroups` — the reactive source of truth the
    // template renders from — not the element's `open` class. Two paths open a
    // group without touching that class (the "N hidden" badge, and the
    // customize-mode collapse button, which is a different element than the
    // normal-mode label that carried it), so a class-based check would misread
    // their state and take two clicks to collapse. The `open` class is now
    // applied declaratively from `openGroups` in the template.
    const isOpen = this.openGroups.includes(toggle);
    this.openGroups = isOpen
      ? this.openGroups.filter((d) => d !== toggle)
      : [...this.openGroups, toggle];
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
      { sequence: string; variants: TransformedVariant[] } | undefined;
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
    colorRange = '',
    showSeriesLabel = true
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
            ?show-label-name="${showSeriesLabel}"
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
        // Reached when a component is registered and validated but has no
        // `case` here — the current gap for consumer components (see
        // "Register + load + render" in docs/architecture.md). Draw nothing,
        // and say nothing from here: `registerConfigComponents` has already
        // reported it once for the whole config, through the router. A report
        // from inside `render()` could only reach the console anyway, and
        // would repeat on every pass.
        break;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protvista-uniprot': ProtvistaUniprot;
  }
}

export default ProtvistaUniprot;
