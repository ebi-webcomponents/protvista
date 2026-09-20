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
 *   2. Fetch each unique URL (substituting `{accession}`) via the caller-
 *      supplied fetch function.
 *   3. For each group: for each track: pluck the raw response, resolve
 *      the named adapter (the `adapter:` field carries the schema-level
 *      name — e.g. `uniprot-features-json` — which the injected resolver
 *      looks up in the registry) and run it, apply the single-type filter
 *      if the track has one, and assign the result to
 *      `data[`${group}-${track}`]`.
 *   4. Assign a group-level aggregate at `data[group]` — which is
 *      `.flat()` for most components, or `groupData[0]` for
 *      linegraph / colored-sequence groups.
 *
 * Intentionally kept side-effect-free: no `this`, no DOM. Tracks that
 * opt into a filter UI (`filterUI: 'nightingale-filter'`) get their
 * adapted payload mirrored under a second key,
 * `${groupId}-${trackId}${UNFILTERED_SUFFIX}`, so the component's filter
 * handler has a pristine baseline to re-filter against without a
 * separate class field. Consumers reading `data` directly must treat
 * `__unfiltered` keys as inert baselines, not live renderer payload.
 */

import {
  isAuthoredSource,
  type NormalizedConfig,
  type NormalizedTrack,
} from './schema/normalize.js';
import { DATA_FORMATS } from './schema/file-formats.js';
import { runPipeline } from './schema/adapters/pipeline.js';
import { SHAPES } from './schema/shapes.js';
import { resolveTooltip } from './tooltips/resolve.js';
import { tooltipDefaults } from './tooltips/defaults.js';
import type { TooltipContext, TooltipSpec } from './tooltips/types.js';

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
 * body: `'json'` for API responses (the default for every UniProt/AlphaFold
 * source) and for the JSON-body bring-your-own-data file adapter
 * (`features-json`), `'text'` for delimited bring-your-own-data files
 * (`features-csv` / `features-tsv` / `bed`) whose adapters parse raw text.
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
 * provider-only kinds have no record adapter and pass through untouched —
 * running `features-json` here would strip every field outside its five
 * documented ones, including any a `dataTooltip` path references.
 *
 * A payload already in the renderer's representation is passed through, so the
 * previously-documented `setTrackData()` contract keeps working.
 */
async function adaptAuthoredRecords(
  payload: unknown,
  track: NormalizedTrack
): Promise<unknown> {
  const shape = track.data[0]?.shape;
  // No shape means no record contract to hold the payload to; a shape that
  // does not wrap means the records *are* the representation, and running
  // them through a validator would only strip fields a `dataTooltip` may
  // reference.
  if (shape === undefined || !SHAPES[shape].wraps) return payload;
  if (isRenderedRepresentation(payload)) return payload;
  return runPipeline(shape, 'json', payload);
}

/**
 * Resolve per-item `tooltipContent` strings and return an annotated
 * copy. Pure — the input `transformedData` is never mutated; callers
 * must use the return value to see the attached tooltips.
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
  ctx: TooltipContext
): unknown {
  const annotate = (item: unknown): unknown => {
    if (!item || typeof item !== 'object') return item;
    const existingTooltip = (item as { tooltipContent?: unknown })
      .tooltipContent;
    if (existingTooltip != null && existingTooltip !== '') return item;
    const html = resolveTooltip(item, spec, ctx);
    return html ? { ...item, tooltipContent: html } : item;
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

/**
 * Constrains the characters `accession` can carry before we interpolate
 * it into URL templates. Upstream UniProt accessions match
 * `[OPQ][0-9][A-Z0-9]{3}[0-9]` (six-char) or `[A-NR-Z][0-9][A-Z][A-Z0-9]{2}[0-9]`
 * (ten-char) — both comfortably ASCII. We accept the superset
 * `[A-Za-z0-9_-]{1,32}` so integration tests can use shapes like
 * `TEST-01` without loosening the gate for real-world input.
 *
 * Anything outside this character class (path separators, `?`, `#`,
 * `&`, `%`, whitespace, newline, control chars) is treated as
 * attacker-controlled and collapsed to an empty substitution: a
 * crafted value can't tack an extra path segment, query string, or
 * header-smuggling payload onto the fetch URL.
 */
const ACCESSION_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Interpolate a single `{accession}` placeholder in a URL template,
 * gating the substituted value through {@link ACCESSION_PATTERN}. The
 * loader is the single source of truth for this substitution; it exposes
 * the resulting per-track URLs via `LoadResult.trackUrls` so callers
 * never re-derive them.
 */
function substituteAccession(template: string, accession: string): string {
  const safe = ACCESSION_PATTERN.test(accession) ? accession : '';
  return template.replace('{accession}', safe);
}

export async function loadProtvistaData(
  accession: string,
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
  const templates = new Set<string>();
  const trackUrls: Record<string, string[]> = {};
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
      for (const t of list) {
        templates.add(t);
        if (wantsText) bodyType.set(t, 'text');
        else if (!bodyType.has(t)) bodyType.set(t, 'json');
      }
      if (list.length > 0) {
        trackUrls[key] = list.map((u) => substituteAccession(u, accession));
      }
    }
  }
  const urls = [...templates];

  const rawData: Record<string, unknown> = Object.fromEntries(
    await Promise.all(
      urls.map(async (url) => [
        url,
        await fetchOne(
          substituteAccession(url as string, accession),
          bodyType.get(url) ?? 'json'
        ),
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

  const data: Record<string, unknown> = {};

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
    const isInline = source?.from === 'inline';
    if ((isAuthoredSource(source) || isInline) && hasRenderableRows(payload)) {
      hasData = true;
    }
  };

  // Shared tail for `from: custom` and `from: inline` tracks: apply
  // the track's `filter:` shortcut, resolve tooltips, and assign the
  // result. The only difference between the two sources is where
  // `transformedData` comes from — consumer-injected via
  // `setTrackData()` vs. the descriptor's own `inlineData` — both
  // skip the fetch + adapter step entirely.
  const filterResolveAndAssign = (
    transformedData: unknown,
    trackKey: string,
    track: NormalizedTrack
  ): unknown => {
    const { filter, kind, dataTooltip, id: trackId } = track;
    const filteredData =
      Array.isArray(transformedData) && filter
        ? (transformedData as Array<{ type?: string }>).filter(
            ({ type }) => type === filter
          )
        : transformedData;
    if (filteredData == null) return undefined;
    const spec: TooltipSpec | undefined =
      dataTooltip ?? (kind ? tooltipDefaults[kind] : undefined);
    const annotated = applyTooltipResolver(filteredData, spec, {
      accession,
      trackId,
      kind: kind ?? '',
    });
    assignTrackData(trackKey, annotated, track);
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
        const {
          data: dataConfig,
          id: trackId,
          filter,
          kind,
          dataTooltip,
        } = track;
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
              console.info(
                `Track ${groupId}/${trackId} is 'from: custom' but no data was provided via setTrackData().`
              );
              return;
            }
            return filterResolveAndAssign(
              await adaptAuthoredRecords(customTrackData[trackKey], track),
              trackKey,
              track
            );
          }

          // `from: inline` — the payload lives on the descriptor itself
          // (`inlineData`, populated by the normalizer); no fetch. Filter +
          // tooltip resolution still apply, mirroring `from: custom` above.
          if (first.from === 'inline') {
            return filterResolveAndAssign(
              await adaptAuthoredRecords(first.inlineData, track),
              trackKey,
              track
            );
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
          if (first.format !== undefined) {
            transformedData = await runPipeline(
              first.shape ?? 'feature',
              first.format,
              trackData[0],
              // The author's own path, so a parse error names their file.
              { source: substituteAccession(String(url ?? ''), accession) }
            );
          } else if (adapter) {
            transformedData = await resolveAdapterFn(adapter)(...trackData);
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

          // 3. Resolve per-item tooltips. Existing `tooltipContent`
          //    wins, then track-level `dataTooltip`, then the per-kind
          //    built-in default, then the compact auto-fallback. Graph
          //    tracks (linegraph, colored-sequence, heatmap) have no
          //    per-item hover, so the resolver returns `''` and no field
          //    is written.
          const spec: TooltipSpec | undefined =
            dataTooltip ?? (kind ? tooltipDefaults[kind] : undefined);
          const annotated = applyTooltipResolver(filteredData, spec, {
            accession,
            trackId,
            kind: kind ?? '',
          });
          // 4. Assign track data (+ a pristine baseline for filter tracks)
          assignTrackData(trackKey, annotated, track);
          return annotated;
        } catch (err) {
          console.warn(
            `[protvista-uniprot] track ${groupId}/${trackId} failed to process; rendering it empty.`,
            err
          );
          return undefined;
        }
      })
    );

    data[groupId] =
      group.component === 'nightingale-linegraph-track' ||
      group.component === 'nightingale-colored-sequence'
        ? // Graph groups render only their first track, so a failed
          // first track legitimately leaves the aggregate `undefined`
          // (the component reads that as "no data" and shows the error
          // row). Keep it as-is.
          groupData[0]
        : // Flattened multi-track aggregate: drop the `undefined` slots a
          // failed (or empty) track leaves behind. Without this the array
          // is truthy-but-holey — the holes reach Nightingale's `.data`
          // setter, and an all-failed group reads as "has data" instead of
          // routing to the error row.
          groupData.flat().filter((entry) => entry != null);
  }

  return { rawData, data, hasData, trackUrls };
}
