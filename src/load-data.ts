/**
 * Pure data-loading pipeline for <protvista-uniprot>.
 *
 * Consumes a fully-resolved `NormalizedConfig` (produced by the schema
 * loader — `src/schema/load.ts`) and walks it to fetch, adapt, filter,
 * and route per-track data into the flat `data` / `rawData` maps the
 * renderer reads. Pulled out of `<protvista-uniprot>` so it can be
 * characterised in isolation; see
 * `src/__spec__/load-data-baseline.spec.ts`.
 *
 * Responsibilities (exactly what the legacy in-class `_loadData` did):
 *   1. Collect every `data[0].url` from every track, de-duplicate.
 *   2. Substitute every `{token}` in each unique URL template from the
 *      merged variables dictionary (`src/schema/variables.ts`), then fetch
 *      it via the caller-supplied fetch function. A template with a token
 *      no variable supplies is skipped with a warning, not fetched.
 *   3. For each group: for each track: pluck the raw response, resolve
 *      the named adapter (the `adapter:` field carries the schema-level
 *      name — e.g. `uniprot-features-json` — which the injected resolver
 *      looks up in the registry) and run it, apply the single-type filter
 *      if the track has one, and assign the result to
 *      `data[`${group}-${track}`]`.
 *   3b. Record a track whose decode / adapter step threw in
 *      `trackFailures` (keyed `${groupId}-${trackId}`) and leave its slot
 *      empty, so one bad file degrades one track rather than the batch —
 *      and so the caller can route it instead of losing it to the console.
 *      This module reports nothing itself: it has no surfaces, and a
 *      `console` call here would be a channel outside the routing table
 *      (`src/errors/router.ts`).
 *   4. Assign a group-level aggregate at `data[group]`, built from the
 *      tracks that are neither `detailOnly` nor hidden
 *      (`aggregatePayload`) — which is their `.flat()` for most
 *      components, or the first one's data for linegraph /
 *      colored-sequence groups. The element rebuilds it from the
 *      per-track keys whenever the layout changes which tracks it draws.
 *   5. Return each authored track's decoded coordinates and row numbers,
 *      taken before `filter:`, as `trackCoordinates` — kept out of `data`
 *      for the component's sequence-bounds warning.
 *   6. Return each track's decoder warnings (feature columns dropped,
 *      colours a browser will not paint) as `trackWarnings`, for the
 *      component to route as `track-data` warnings.
 *   7. Return, as `tooltipFieldMisses`, each track whose authored
 *      `dataTooltip` names a field none of its rendered records carries,
 *      for the component to route as `tooltip-field-miss` warnings.
 *
 * Intentionally kept side-effect-free: no `this`, no DOM, no `console`. Tracks that
 * opt into a filter UI (`filterUI: 'nightingale-filter'`) get their
 * adapted payload mirrored under a second key,
 * `${groupId}-${trackId}${UNFILTERED_SUFFIX}`, so the component's filter
 * handler has a pristine baseline to re-filter against without a
 * separate class field. Consumers reading `data` directly must treat
 * `__unfiltered` keys as inert baselines, not live renderer payload.
 */

import {
  aggregatePayload,
  isAuthoredSource,
  type NormalizedConfig,
  type NormalizedTrack,
} from './schema/normalize.js';
import { DATA_FORMATS } from './schema/file-formats.js';
import { runPipeline, sourceLabel } from './schema/adapters/pipeline.js';
import type {
  CoordinateRow,
  TrackCoordinates,
} from './schema/adapters/coordinates.js';
import type { DecodeWarning } from './schema/adapters/feature-fields.js';
import { SHAPES } from './schema/shapes.js';
import {
  createTooltipFallback,
  createTooltipFieldTracker,
  resolveTooltip,
  type TooltipFallback,
  type TooltipFieldTracker,
} from './tooltips/resolve.js';
import { tooltipDefaults } from './tooltips/defaults.js';
import type { TooltipContext, TooltipSpec } from './tooltips/types.js';
import { withFeatureSource, type FeatureSource } from './feature-source.js';
import { substituteTemplate, type Variables } from './schema/variables.js';

/**
 * Minimal shape the loader needs from an adapter: a function of the raw
 * fetched payload(s) for a track, returning whatever the renderer consumes.
 * Kept `any` because adapter output shapes are deliberately heterogeneous
 * (feature arrays, linegraph points, variation graphs, heatmap matrices…).
 */
type AdapterFn = (...rawArgs: any[]) => unknown | Promise<unknown>;

export type AdapterMap = Record<string, AdapterFn>;

/**
 * How the loader obtains an adapter function for a track's `adapter:`
 * name. This is the loader's single point of contact with adapter
 * resolution — it holds no adapter map and knows no adapter names. The
 * component wires this to the schema `Registry` (`registry.getAdapter`),
 * so validation and runtime resolve through the same source of truth and
 * a consumer-registered adapter runs as soon as it validates.
 */
export type AdapterResolver = (name: string) => AdapterFn | undefined;

/**
 * Fetch a single URL. `responseType` tells the fetcher how to read the
 * body, and comes straight off the source's format: `'text'` for the
 * delimited formats (CSV / TSV / BED), which the decoder parses itself, and
 * `'json'` for everything else — JSON files and every provider response.
 */
type FetchOne = (
  url: string,
  responseType: 'text' | 'json'
) => Promise<unknown>;

/**
 * Map of `${groupId}-${trackId}` → pre-shaped data for `from: custom`
 * tracks. The runtime escape hatch on `<protvista-uniprot>` (the
 * `setTrackData()` method) writes into this map; the loader reads it when
 * a track's first descriptor is `from: custom`.
 *
 * Injected data is treated as already in the renderer's expected
 * representation — the adapter step is skipped, but the track-level
 * `filter:` sugar and the tooltip resolver still run so injected data
 * behaves symmetrically with URL- and inline-sourced tracks.
 */
export type CustomTrackData = Record<string, unknown>;

/**
 * Sentinel suffix for the pristine, unfiltered baseline copy of a
 * filterable track's payload. For a track keyed `${groupId}-${trackId}`
 * whose config sets `filterUI: 'nightingale-filter'`, the loader mirrors
 * the adapted payload at `${groupId}-${trackId}${UNFILTERED_SUFFIX}`. The
 * component's filter handler reads the baseline from this key and writes
 * the filtered result back to the primary key, so successive filter
 * interactions never compound. Keys carrying this suffix are inert
 * baselines — not live renderer payload.
 */
export const UNFILTERED_SUFFIX = '__unfiltered';

type LoadResult = {
  /** Keyed by the *template* URL (pre-substitution), matching the legacy
   *  `this.rawData` shape the renderer reads. */
  rawData: Record<string, unknown>;
  /**
   * Keyed by `${groupId}-${trackId}` and `${groupId}`. Tracks with
   * `filterUI: 'nightingale-filter'` additionally get a pristine baseline
   * copy at `${groupId}-${trackId}${UNFILTERED_SUFFIX}` for the filter
   * handler to read from.
   */
  data: Record<string, unknown>;
  /** True iff any raw response has `features.length > 0`. Mirrors the
   *  legacy `this.hasData` gate for rendering empty-state markup. */
  hasData: boolean;
  /**
   * The *substituted* URL(s) each track fetched, keyed by
   * `${groupId}-${trackId}`. Tracks with no URL source (inline / custom /
   * file) are omitted. This is the authoritative record of what the
   * loader fetched — the component correlates its per-URL HTTP failures
   * against it instead of re-deriving the substitution.
   */
  trackUrls: Record<string, string[]>;
  /**
   * What the sequence-bounds warning needs about each authored track, keyed
   * by `${groupId}-${trackId}`: every decoded row's coordinates and row
   * number, taken before `filter:`, plus the source label, shape, format,
   * and fetched URL. Only file/URL sources with a `format` and `from:
   * inline` data in the author record contract have an entry;
   * `setTrackData()`, provider-adapter, and rendered-form inline payloads
   * have none. Never part of `data`, so row numbers cannot leak into
   * tooltips.
   */
  trackCoordinates: Record<string, TrackCoordinates>;
  /**
   * Per-track outcomes that are not fetch failures, keyed by
   * `${groupId}-${trackId}`: a decode/validate failure (`./hits.csv (parsed
   * as CSV): row 3, column "start": expected a number, got "abc"`), an
   * adapter that rejected the body it was handed, an unregistered `adapter:`
   * name, or a `from: custom` track nobody injected data into.
   *
   * Returned rather than reported here, because this module renders nothing
   * and logs nothing: every failure in the viewer is routed in one place
   * (`src/errors/router.ts`), and a loader that wrote to the console would be
   * a second, unrouted channel. The caller correlates these to rows and
   * routes them (see `_collectTrackErrors`).
   */
  trackFailures: Record<string, TrackProcessingFailure>;
  /**
   * What a feature decoder noticed about a track's data without rejecting
   * it, keyed by `${groupId}-${trackId}`: columns it dropped because decoded
   * data may not set them, or `shape` values naming an `Object.prototype`
   * property (`data-field-ignored`), and `color` / `fill`
   * values it kept but a browser will not paint (`unpaintable-color`). Only
   * tracks with at least one warning have a key, and a track whose decode
   * threw has none (its failure is in `trackFailures`).
   *
   * Returned rather than logged, for the same reason as `trackFailures`; the
   * caller routes each as a `track-data` warning.
   */
  trackWarnings: Record<string, DecodeWarning[]>;
  /**
   * One message per URL template that was not fetched because a `{token}`
   * had no value or a refused one (see `substituteTemplate`). Returned rather
   * than logged for the same reason as `trackFailures`; the caller routes
   * each as a warning.
   *
   * `tracks` is the key of every (re)loading track that references the
   * template, in config order — the first track the message names and every
   * later one. With `trackUrls` the caller can tell a track that fetched
   * nothing (absent there) from one that lost only some of its URLs.
   *
   * `template` is the skipped template itself. The message names the track
   * that met it first, which a targeted retry can make a later one, so the
   * template is what says two reports are the same skip.
   */
  skipWarnings: { message: string; template: string; tracks: string[] }[];
  /**
   * Each track whose authored `dataTooltip` references a field that none of
   * the records it rendered against carries — `{% $score %}` on a track with
   * no `score` anywhere — in config order. Always present (`[]` when clean);
   * a targeted reload lists only the tracks it reran.
   *
   * Returned rather than logged, for the same reason as `trackFailures`; the
   * caller routes each as a `tooltip-field-miss` warning.
   */
  tooltipFieldMisses: TooltipFieldMiss[];
};

/** One track's unknown tooltip fields. See `LoadResult.tooltipFieldMisses`. */
export type TooltipFieldMiss = {
  groupId: string;
  trackId: string;
  /** The referenced paths no record carried, in template order. */
  fields: string[];
};

/**
 * Components that draw no per-item tooltip, so `dataTooltip` does not apply
 * to them. What `applyTooltipResolver` sees for these is the renderer's own
 * wrapper (a line graph's `[{ name, values }]` series), not the author's
 * records, so checking the template's fields against it would warn about
 * fields the author's data does carry. A deny-list rather than an allow-list,
 * so a consumer-registered component is still checked.
 */
const NO_ITEM_TOOLTIP_COMPONENTS: ReadonlySet<string> = new Set([
  'nightingale-linegraph-track',
  'nightingale-colored-sequence',
  'nightingale-sequence-heatmap',
]);

/** One track's non-fetch outcome. See `LoadResult.trackFailures`. */
export type TrackProcessingFailure = {
  /**
   * How bad it is, in the routing table's terms (`src/errors/router.ts`).
   * `error` is a track that cannot render what it was asked to — a malformed
   * file, an adapter that threw. `info` is an expected absence: a
   * `from: custom` track nobody injected data into.
   */
  severity: 'error' | 'info';
  /** The message, verbatim — a thrown error's text names the file and the row. */
  message: string;
  /** The thrown value itself, for the developer channel. Absent for `info`. */
  cause?: unknown;
  /**
   * Whether running the track again could change the outcome. Only a
   * *provider* adapter's own throw qualifies: a provider adapter is not a
   * pure transform — it can make requests of its own (the AlphaFold
   * confidence adapter fetches a second file), so its failure may be as
   * transient as a 5xx. A decoder rejecting the author's file, a malformed
   * `setTrackData()` payload, and an unregistered adapter name are the same
   * code over the same input every time. Set here because only the loader
   * knows which step threw.
   */
  retryable?: boolean;
};

/**
 * Whether an adapted payload actually carries something to draw.
 *
 * Gates the `hasData` empty-state flag for bring-your-own-data tracks, so it
 * has to recognise every wrapper an adapter may emit — not just the bare
 * array most produce. A variation payload is `{ variants: [...] }`, and a
 * viewer built solely from a BYO variants file would otherwise parse
 * correctly and still show "no data for this entry".
 *
 * Exported so `examples.spec.ts` asserts example payloads with the same
 * predicate the gate uses: a test recognising fewer shapes than the gate
 * would pass an example the viewer blanks out.
 */
export function hasRenderableRows(payload: unknown): boolean {
  if (Array.isArray(payload)) return payload.length > 0;
  if (payload && typeof payload === 'object') {
    const variants = (payload as { variants?: unknown }).variants;
    return Array.isArray(variants) && variants.length > 0;
  }
  return false;
}

/**
 * Whether a payload is already in the representation the component renders,
 * rather than the author-facing records it is built from.
 *
 * The two shapes are structurally disjoint for every wrapping family, so this
 * distinguishes them without guessing: a rendered line graph is an array of
 * series objects carrying `values`, a rendered variation payload is an object
 * carrying `variants`. An author's records are neither — they are flat
 * `{ position, … }` objects.
 *
 * Exists so `from: custom` keeps honouring its documented contract (inject
 * what the renderer wants) while also accepting the record contract every
 * other part of the docs publishes. A consumer who reads `your-data.md` and
 * calls `setTrackData(key, [{ position: 1, value: 412 }])` should get a line
 * graph, not `TypeError: undefined is not iterable`.
 */
function isRenderedRepresentation(payload: unknown): boolean {
  if (Array.isArray(payload)) {
    return payload.some(
      (item) =>
        !!item &&
        typeof item === 'object' &&
        Array.isArray((item as { values?: unknown }).values)
    );
  }
  return (
    !!payload &&
    typeof payload === 'object' &&
    Array.isArray((payload as { variants?: unknown }).variants)
  );
}

/**
 * Run a track's record adapter over an author-supplied payload — the shared
 * tail of `from: inline` and `from: custom`.
 *
 * Both carry data the *author* wrote, against the record contract published
 * for the track's `kind` (`{ position, value }` for a line graph,
 * `{ position, variant }` for variants). That contract is the same whether the
 * records arrive over the network, inline in the config, or through
 * `setTrackData()`, so the adapter that validates and wraps them runs for all
 * three. Kinds whose records need no wrapping (the feature family) and
 * provider-only kinds have no record adapter and pass through untouched:
 * structured feature records are already the renderer's representation, and
 * inline config is trusted to set the viewer fields (`tooltipContent`,
 * `locations`) the feature decoder drops from decoded data.
 *
 * A payload already in the renderer's representation is passed through, so the
 * previously-documented `setTrackData()` contract keeps working.
 *
 * The descriptor's `format:` is honoured here exactly as it is for a fetched
 * body. Inline text is the case `format:` was introduced for — there is no
 * extension to read it off and no content sniffing — so ignoring it here would
 * make the one remedy the validator recommends a no-op.
 *
 * With `collectCoordinates`, the author's coordinates are returned alongside
 * the payload for the sequence-bounds warning; `setTrackData()` payloads are
 * not checked, so that path skips collecting them.
 *
 * Text decoded here (inline text, or a `setTrackData()` string, with a
 * `format:`) reports the decoder's warnings exactly as a file does: they are
 * returned as `warnings` when there are any.
 */
async function adaptAuthoredRecords(
  payload: unknown,
  track: NormalizedTrack,
  collectCoordinates: boolean
): Promise<{
  payload: unknown;
  coordinates?: TrackCoordinates;
  warnings?: DecodeWarning[];
}> {
  const source = track.data[0];
  const shape = source?.shape;
  // No shape means no record contract to hold the payload to.
  if (shape === undefined) return { payload };

  // A delimited format needs a string to decode. A payload that is already
  // structured (a `setTrackData()` record array on a descriptor that also
  // carries a `format:`) is read as what it is rather than warned away to an
  // empty track.
  const declared = source?.format ?? 'json';
  const format =
    DATA_FORMATS[declared].body === 'text' && typeof payload !== 'string'
      ? 'json'
      : declared;

  // A shape that does not wrap means JSON records *are* the representation,
  // and trusted config may set fields the decoder keeps out of decoded data,
  // so they are not run through it. Encoded text still has to be decoded —
  // the raw string is no one's representation.
  if (format === 'json' && !SHAPES[shape].wraps) {
    if (!collectCoordinates || !Array.isArray(payload)) return { payload };
    return {
      payload,
      coordinates: {
        label: sourceLabel(undefined, 'json'),
        shape,
        format: 'json',
        rows: payload.map(authoredFeatureRow),
      },
    };
  }
  if (isRenderedRepresentation(payload)) return { payload };
  // No `source`, so a parse error reads "inline data (parsed as CSV): …".
  const warnings: DecodeWarning[] = [];
  const found = () => (warnings.length > 0 ? { warnings } : {});
  if (!collectCoordinates) {
    const result = await runPipeline(shape, format, payload, { warnings });
    return { payload: result, ...found() };
  }
  const rows: CoordinateRow[] = [];
  const result = await runPipeline(shape, format, payload, {
    coordinates: rows,
    warnings,
  });
  return {
    payload: result,
    coordinates: { label: sourceLabel(undefined, format), shape, format, rows },
    ...found(),
  };
}

/**
 * A feature record's coordinates as the author wrote them — `start`, with
 * `begin` as the fallback, the way `featuresJson` reads it. Inline feature
 * arrays skip that validator, so a value that is not a finite number is left
 * out rather than counted: the bounds check is not a type check.
 */
function authoredFeatureRow(record: unknown, row: number): CoordinateRow {
  if (!record || typeof record !== 'object') return { row, fields: [] };
  const r = record as { start?: unknown; begin?: unknown; end?: unknown };
  const fields: Array<readonly ['start' | 'end', number]> = [];
  const start = r.start != null ? r.start : r.begin;
  if (typeof start === 'number' && Number.isFinite(start)) {
    fields.push(['start', start]);
  }
  if (typeof r.end === 'number' && Number.isFinite(r.end)) {
    fields.push(['end', r.end]);
  }
  return { row, fields };
}

/**
 * Resolve per-item `tooltipContent` strings and return an annotated
 * copy. Pure — the input `transformedData` is never mutated; callers
 * must use the return value to see the attached tooltips.
 *
 * Every object item comes back as a copy tagged with its `source` track
 * (`withFeatureSource`), whether or not it gained a tooltip, so an item in a
 * collapsed group's flattened aggregate still says which track it came from.
 *
 * Consulted after the adapter has produced its output. Existing
 * `item.tooltipContent` wins first; otherwise picks a spec in this
 * precedence order:
 *
 *   1. `track.dataTooltip`            — YAML / config author override
 *   2. `tooltipDefaults[track.kind]`  — built-in per-kind default
 *   3. Auto-fallback: `renderAutoFallback` synthesizes compact Markdoc
 *                     content from common feature-shaped fields plus
 *                     richer adapter payload fields such as variants,
 *                     scores, xrefs, evidences, and extra scalars.
 *
 * Consumers who need rich / interactive / stateful tooltips bypass
 * this pipeline entirely: listen for the Nightingale `change` event
 * on the element, mount their own UI with the event's `detail.feature`
 * as input, and set the `notooltip` attribute on the element to
 * suppress the library's built-in popover.
 *
 * The resolver's output is the canonical source of `tooltipContent`
 * unless the adapter has already supplied a non-empty tooltip.
 *
 * `fieldTracker` observes every item the resolver renders — not one whose
 * adapter-supplied tooltip wins — for the caller's unknown-field check.
 * `fallback` swaps in the track's default for an item the authored spec
 * has nothing to say about (see `createTooltipFallback`).
 *
 * Handles the two shapes adapters emit:
 *   - an array of feature-like objects (most adapters) — returns a new
 *     array of items with `tooltipContent` spread in;
 *   - a `{ sequence, variants }` object (variation / rna-editing) —
 *     returns a new wrapper with the annotated `variants` array, other
 *     fields preserved by reference.
 * Anything else (colored-sequence point arrays, linegraph data, …) is
 * passed through unchanged — those tracks have no per-item hover to
 * populate.
 */
function applyTooltipResolver(
  transformedData: unknown,
  spec: TooltipSpec | undefined,
  ctx: TooltipContext,
  source: FeatureSource,
  fieldTracker?: TooltipFieldTracker,
  fallback?: TooltipFallback
): unknown {
  const annotate = (item: unknown): unknown => {
    if (!item || typeof item !== 'object') return item;
    const existingTooltip = (item as { tooltipContent?: unknown })
      .tooltipContent;
    if (existingTooltip != null && existingTooltip !== '') {
      return withFeatureSource(item, source);
    }
    const html = resolveTooltip(item, spec, ctx, fieldTracker, fallback);
    return withFeatureSource(
      html ? { ...item, tooltipContent: html } : item,
      source
    );
  };
  if (Array.isArray(transformedData)) {
    return transformedData.map(annotate);
  }
  if (transformedData && typeof transformedData === 'object') {
    const variants = (transformedData as { variants?: unknown }).variants;
    if (Array.isArray(variants)) {
      return {
        ...(transformedData as Record<string, unknown>),
        variants: variants.map(annotate),
      };
    }
  }
  return transformedData;
}

/**
 * Extract the URL (`string | string[]`) from a `NormalizedDataSource`.
 * `from: url` and `from: file` sources both carry a usable `url` (a file
 * shorthand like `./x.csv` is normalised onto `url`); `inline` and
 * `custom` sources have none and yield an empty string so the dedupe
 * pass skips them cleanly.
 */
function trackUrl(
  data: NormalizedConfig['rows'][number]['tracks'][number]['data']
): string | string[] {
  const first = data[0];
  if (!first) return '';
  return (first.url ?? '') as string | string[];
}

export async function loadProtvistaData(
  /**
   * The merged variables dictionary every `{token}` resolves against —
   * see `mergeVariables()`. A bare string is shorthand for
   * `{ accession: <string> }`.
   */
  variables: string | Variables,
  config: NormalizedConfig,
  fetchOne: FetchOne,
  getAdapter: AdapterResolver,
  customTrackData: CustomTrackData = {},
  /**
   * Targeted-retry scope. When present, only `only`'s
   * `${groupId}-${trackId}` keys are (re)fetched and only their (and
   * their groups') `data` is recomputed; sibling tracks in a touched
   * group reuse `previousData` so the group aggregate stays complete. The
   * two fields are bundled so a caller can't pass one without the other.
   * Omit for the normal full load.
   */
  reload?: { only: Set<string>; previousData: Record<string, unknown> }
): Promise<LoadResult> {
  const vars: Variables =
    typeof variables === 'string' ? { accession: variables } : variables;
  const accession = vars.accession ?? '';
  const only = reload?.only;
  const previousData = reload?.previousData ?? {};
  const isReloading = (key: string): boolean => !only || only.has(key);

  // Single pass over the (re)loading tracks builds both the deduped set of
  // URL *templates* to fetch (identical URLs referenced by multiple tracks
  // must be fetched exactly once — a spec performance requirement) and the
  // authoritative per-track map of the *substituted* URL(s) each track
  // fetched (callers correlate per-URL HTTP failures against it instead of
  // re-deriving the substitution). `trackUrl()` yields an empty string for
  // `from: inline | custom`, so those are excluded; `from: file` sources
  // carry their path on `url`, so they are fetched here like any URL.
  //
  // A template with a token no variable supplies — or whose value is
  // refused (`.` / `..` / malformed Unicode; see `substituteTemplate`) — is
  // neither fetched nor recorded in `trackUrls`: requesting a half-built
  // URL would at best 404 (silently hiding the track) and at worst hit an
  // unintended endpoint. Its track renders empty, and the developer gets
  // one warning per template naming the offending tokens.
  const templates = new Set<string>();
  const trackUrls: Record<string, string[]> = {};
  const trackCoordinates: Record<string, TrackCoordinates> = {};
  const substituted = new Map<string, string>();
  // Template → its skip warning, which also collects every track that
  // referenced it. Membership is the "was skipped" test.
  const skipped = new Map<
    string,
    { message: string; template: string; tracks: string[] }
  >();
  const skipWarnings: {
    message: string;
    template: string;
    tracks: string[];
  }[] = [];
  const substitute = (
    template: string,
    key: string,
    trackPath: string
  ): string | null => {
    const known = substituted.get(template);
    if (known !== undefined) return known;
    const already = skipped.get(template);
    if (already) {
      if (!already.tracks.includes(key)) already.tracks.push(key);
      return null;
    }
    const result = substituteTemplate(template, vars);
    if ('url' in result) {
      substituted.set(template, result.url);
      return result.url;
    }
    const braced = (tokens: string[]) => tokens.map((t) => `{${t}}`).join(', ');
    const warning = {
      message:
        `[protvista-uniprot] Not fetching '${template}' for track ${trackPath}: ` +
        ('unresolved' in result
          ? `undefined variable(s) ${braced(result.unresolved)}. ` +
            `Define them in top-level 'variables:' or as data-* attributes.`
          : `invalid value for ${braced(result.invalid)} ` +
            `('.', '..' and malformed Unicode are refused).`),
      template,
      tracks: [key],
    };
    skipped.set(template, warning);
    skipWarnings.push(warning);
    return null;
  };
  // Per-template body type: `text` for the delimited generic-format
  // adapters, `json` (default) for everything else. Keyed by template so a
  // URL shared by two tracks resolves once; if any referencing track needs
  // text, text wins (a delimited body would fail a JSON parse anyway).
  const bodyType: Map<string, 'text' | 'json'> = new Map();
  for (const group of config.rows) {
    for (const track of group.tracks) {
      const key = `${group.id}-${track.id}`;
      if (!isReloading(key)) continue;
      const raw = trackUrl(track.data);
      const list = (Array.isArray(raw) ? raw : [raw]).filter((u) => u !== '');
      // Only a declared format reads as text; every provider transform takes
      // a JSON response.
      const source = track.data[0];
      const wantsText =
        source?.format !== undefined &&
        DATA_FORMATS[source.format].body === 'text';
      const fetched: string[] = [];
      for (const t of list) {
        const url = substitute(t, key, `${group.id}/${track.id}`);
        if (url === null) continue;
        fetched.push(url);
        templates.add(t);
        if (wantsText) bodyType.set(t, 'text');
        else if (!bodyType.has(t)) bodyType.set(t, 'json');
      }
      if (fetched.length > 0) trackUrls[key] = fetched;
    }
  }
  const urls = [...templates];

  const rawData: Record<string, unknown> = Object.fromEntries(
    await Promise.all(
      urls.map(async (url) => [
        url,
        await fetchOne(substituted.get(url)!, bodyType.get(url) ?? 'json'),
      ])
    )
  );

  // `hasData` gates the viewer's empty-state panel. The legacy heuristic
  // only recognises the UniProt JSON shape (`raw.features.length`), which
  // is invisible to a bring-your-own file track: its adapted output is a
  // bare feature array with no `.features` wrapper. So a viewer built
  // solely from `./x.csv` / `./x.json` tracks would parse correctly yet
  // blank out. The same is true of a kind-selected bring-your-own-data
  // adapter (`kind: linegraph`), whose output is a bare series array. So we
  // additionally set the flag when any bring-your-own-data track yields a
  // non-empty array (see `assignTrackData`) — additive, so the existing
  // raw-shape semantics (and the tests that pin them) are unchanged.
  let hasData = Object.values(rawData).some(
    (d) => !!(d as { features?: unknown[] } | null)?.features?.length
  );

  const data: Record<string, unknown> = Object.create(null);
  const trackFailures: Record<string, TrackProcessingFailure> = {};
  const trackWarnings: Record<string, DecodeWarning[]> = {};
  // Keyed by `${groupId}-${trackId}`; ordered by config into
  // `tooltipFieldMisses` once every group has loaded.
  const fieldMisses = new Map<string, string[]>();

  // Resolve an adapter by name through the injected registry resolver — the
  // loader itself holds no adapter map and knows no adapter names. A
  // configured adapter that resolves to nothing is a registration gap:
  // surface it as a per-track failure (caught by the per-track try/catch)
  // rather than a silent no-op.
  const resolveAdapterFn = (name: string): AdapterFn => {
    const fn = getAdapter(name);
    if (!fn) {
      throw new Error(
        `No adapter registered for '${name}'. ` +
          `Register it with registerAdapter().`
      );
    }
    return fn;
  };

  // Write a track's adapted payload to its primary key, plus a pristine
  // `__unfiltered` baseline when the track opts into a filter UI. Both
  // assignment sites (`from: custom` and url/inline) route through here
  // so the baseline opt-in rule lives in exactly one place.
  const assignTrackData = (
    key: string,
    payload: unknown,
    track: NormalizedTrack
  ) => {
    data[key] = payload;
    if (track.filterUI === 'nightingale-filter') {
      data[`${key}${UNFILTERED_SUFFIX}`] = payload;
    }
    const source = track.data[0];
    // Inline and `setTrackData()` payloads are bring-your-own data too, with
    // no raw response for the legacy heuristic to see. Without `custom` here,
    // a viewer drawn wholly from injected data reads as "no data".
    const isSupplied = source?.from === 'inline' || source?.from === 'custom';
    if (
      (isAuthoredSource(source) || isSupplied) &&
      hasRenderableRows(payload)
    ) {
      hasData = true;
    }
  };

  // Resolve per-item tooltips for one track's filtered payload. Existing
  // `tooltipContent` wins, then track-level `dataTooltip`, then the
  // per-kind built-in default, then the compact auto-fallback. Shared by
  // every source, so spec selection lives in one place.
  //
  // An authored `dataTooltip` is also checked for fields none of the
  // rendered records carries: the tracker sees each item as it renders, and
  // what it found is recorded for the caller to route, never logged. A
  // per-kind default is library-owned and not checked — a default's field
  // missing from your own file is not something you can fix — and neither is
  // a component that draws no per-item tooltip.
  //
  // The same authored templates get a per-record fallback: a record that
  // has none of the template's fields, and for which it renders no text,
  // shows the track's default instead (its kind's, or the automatic one).
  const resolveTrackTooltips = (
    filteredData: unknown,
    groupId: string,
    track: NormalizedTrack
  ): unknown => {
    const { kind, dataTooltip, id: trackId } = track;
    const spec: TooltipSpec | undefined =
      dataTooltip ?? (kind ? tooltipDefaults[kind] : undefined);
    const ctx: TooltipContext = { accession, trackId, kind: kind ?? '' };
    const authored =
      dataTooltip && !NO_ITEM_TOOLTIP_COMPONENTS.has(track.component)
        ? dataTooltip
        : undefined;
    const tracker = authored && createTooltipFieldTracker(authored, ctx);
    const fallback =
      authored &&
      createTooltipFallback(
        authored,
        ctx,
        kind ? tooltipDefaults[kind] : undefined
      );
    const annotated = applyTooltipResolver(
      filteredData,
      spec,
      ctx,
      { trackId, kind: kind ?? null },
      tracker,
      fallback
    );
    const missing = tracker?.flush() ?? [];
    if (missing.length > 0) fieldMisses.set(`${groupId}-${trackId}`, missing);
    return annotated;
  };

  // Shared tail for `from: custom` and `from: inline` tracks: apply
  // the track's `filter:` shortcut, resolve tooltips, and assign the
  // result. The only difference between the two sources is where
  // `transformedData` comes from — consumer-injected via
  // `setTrackData()` vs. the descriptor's own `inlineData` — both
  // skip the fetch + adapter step entirely.
  const filterResolveAndAssign = (
    transformedData: unknown,
    groupId: string,
    track: NormalizedTrack
  ): unknown => {
    const { filter } = track;
    const filteredData =
      Array.isArray(transformedData) && filter
        ? (transformedData as Array<{ type?: string }>).filter(
            ({ type }) => type === filter
          )
        : transformedData;
    if (filteredData == null) return undefined;
    const annotated = resolveTrackTooltips(filteredData, groupId, track);
    assignTrackData(`${groupId}-${track.id}`, annotated, track);
    return annotated;
  };

  for (const group of config.rows) {
    const groupId = group.id;
    // A targeted retry only recomputes groups that own a reloaded track;
    // every other group keeps its existing `data` untouched.
    if (only && !group.tracks.some((t) => only.has(`${groupId}-${t.id}`))) {
      continue;
    }
    const groupData = await Promise.all(
      group.tracks.map(async (track) => {
        const { data: dataConfig, id: trackId, filter } = track;
        const trackKey = `${groupId}-${trackId}`;
        // Sibling in a touched group that isn't itself being retried:
        // reuse its previous per-track data so the group aggregate below
        // stays complete, without rewriting `data[trackKey]`.
        if (!isReloading(trackKey)) {
          return previousData[trackKey];
        }
        const first = dataConfig[0];
        if (!first) return;
        const url = first.url;
        const adapter = first.adapter;
        // Set when the throw came from a provider adapter's own body — the
        // one failure here a Retry could change (`retryable` below).
        let providerAdapterThrew = false;

        // Isolate the per-track pipeline: an adapter (or filter/tooltip
        // step) that throws on an unexpected payload — e.g. the empty
        // body left by a blocked/failed fetch — must degrade *this* track
        // to no-data, not reject the whole `Promise.all` batch. A reject
        // here would abort the entire load, skipping the caller's
        // error-correlation pass so no failure gets surfaced at all.
        try {
          // `from: custom` — consumer-supplied data bypasses the fetch. If the
          // descriptor declares `custom` but no data was injected via
          // `setTrackData()`, emit a `console.info` and leave the slot empty.
          // Injected data still flows through the downstream `filter:` sugar
          // and tooltip resolver so behaviour is symmetric with URL-sourced
          // tracks.
          if (first.from === 'custom') {
            if (!(trackKey in customTrackData)) {
              trackFailures[trackKey] = {
                severity: 'info',
                message: `Track ${groupId}/${trackId} is 'from: custom' but no data was provided via setTrackData().`,
              };
              return;
            }
            // `setTrackData()` payloads are not bounds-checked: they are
            // documented as already in renderer form, so no coordinates
            // are collected.
            const { payload, warnings } = await adaptAuthoredRecords(
              customTrackData[trackKey],
              track,
              false
            );
            if (warnings) trackWarnings[trackKey] = warnings;
            return filterResolveAndAssign(payload, groupId, track);
          }

          // `from: inline` — the payload lives on the descriptor itself
          // (`inlineData`, populated by the normalizer); no fetch. Filter +
          // tooltip resolution still apply, mirroring `from: custom` above.
          if (first.from === 'inline') {
            const { payload, coordinates, warnings } =
              await adaptAuthoredRecords(first.inlineData, track, true);
            // Recorded before `filter:`, like the formatted branch below.
            if (coordinates) trackCoordinates[trackKey] = coordinates;
            if (warnings) trackWarnings[trackKey] = warnings;
            return filterResolveAndAssign(payload, groupId, track);
          }

          // Every URL was skipped (an undefined or refused variable,
          // already warned about): there is no body, so don't run the
          // format pipeline or adapter just to have it warn a second time
          // about an empty one. The track renders empty.
          const templateList = (Array.isArray(url) ? url : [url ?? '']).filter(
            (u) => u !== ''
          );
          if (
            templateList.length > 0 &&
            templateList.every((u) => skipped.has(u))
          ) {
            return;
          }

          const trackData = (Array.isArray(url) ? url : [url ?? '']).map(
            (u) => rawData[u as string] || []
          );

          // 1. Convert data. Two ways a body becomes a payload, and a
          //    descriptor carries exactly one of them: a `format` (decode it,
          //    validate against the track's shape) or a named `adapter` (a
          //    provider transform, or one the author pinned). Empty-body
          //    guards and post-processing live inside each.
          let transformedData: any = trackData;
          // A body that never arrived (the fetch closure's `null`) has nothing
          // to decode. The caller reports the fetch failure itself, and a
          // decoder handed the `[]` placeholder would add its own "expected a
          // text body" line beside it, pointing at the body instead of the
          // path. Provider adapters still run: some fetch a second source and
          // degrade on a partial payload, and their throw is subordinate to
          // the fetch failure there anyway.
          if (
            first.format !== undefined &&
            rawData[(Array.isArray(url) ? url[0] : url) ?? ''] == null
          ) {
            return undefined;
          }
          if (first.format !== undefined) {
            // The author's own path, so a parse error names their file.
            const source =
              substituted.get(String(url ?? '')) ?? String(url ?? '');
            const shape = first.shape ?? 'feature';
            const rows: CoordinateRow[] = [];
            const warnings: DecodeWarning[] = [];
            transformedData = await runPipeline(
              shape,
              first.format,
              trackData[0],
              { source, coordinates: rows, warnings }
            );
            if (warnings.length > 0) trackWarnings[trackKey] = warnings;
            // Every decoded row, before `filter:` below.
            trackCoordinates[trackKey] = {
              label: sourceLabel(source, first.format),
              shape,
              format: first.format,
              rows,
              url: source,
            };
          } else if (adapter) {
            // Resolved outside the guard: an unregistered name is a config
            // mistake, not something a Retry could fix.
            const adapterFn = resolveAdapterFn(adapter);
            try {
              transformedData = await adapterFn(...trackData);
            } catch (err) {
              providerAdapterThrew = true;
              throw err;
            }
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

          // 3. Resolve per-item tooltips (see `resolveTrackTooltips`).
          const annotated = resolveTrackTooltips(filteredData, groupId, track);
          // 4. Assign track data (+ a pristine baseline for filter tracks)
          assignTrackData(trackKey, annotated, track);
          return annotated;
        } catch (err) {
          // Record rather than log: a malformed file is an authoring error the
          // author has to be able to *see*, and the console is the one place
          // they are not looking. The caller routes this to a badge, an event,
          // and the console line that used to be all of it.
          trackFailures[trackKey] = {
            severity: 'error',
            message: err instanceof Error ? err.message : String(err),
            cause: err,
            ...(providerAdapterThrew ? { retryable: true } : {}),
          };
          return undefined;
        }
      })
    );

    // `groupData` follows `group.tracks` order, so look each drawn track's
    // payload up by track rather than by position — a `detailOnly` or hidden
    // track may sit anywhere in the group (and a user can reorder it).
    const dataByTrack = new Map(
      group.tracks.map((track, i) => [track, groupData[i]])
    );
    data[groupId] = aggregatePayload(group, (track) => dataByTrack.get(track));
  }

  // Config order, whatever order the tracks' loads settled in.
  const tooltipFieldMisses: TooltipFieldMiss[] = [];
  for (const group of config.rows) {
    for (const track of group.tracks) {
      const fields = fieldMisses.get(`${group.id}-${track.id}`);
      if (fields) {
        tooltipFieldMisses.push({
          groupId: group.id,
          trackId: track.id,
          fields,
        });
      }
    }
  }

  return {
    rawData,
    data,
    hasData,
    trackUrls,
    trackCoordinates,
    trackFailures,
    trackWarnings,
    skipWarnings,
    tooltipFieldMisses,
  };
}
