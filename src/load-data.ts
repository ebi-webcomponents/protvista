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
 *   3. For each group: for each track: pluck the raw response, run
 *      the named adapter (the `adapter:` field carries the schema-level
 *      name — e.g. `uniprot-features-json` — which is used verbatim as
 *      the key into the caller-supplied `adapters` map), apply InterPro
 *      representative-domain flattening if relevant, apply the single-
 *      type filter if the track has one, and assign the result to
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

import type { NormalizedConfig, NormalizedTrack } from './schema/normalize';
import type { TransformedInterPro } from './adapters/types/interpro';
import { resolveTooltip } from './tooltips/resolve';
import { tooltipDefaults } from './tooltips/defaults';
import type { TooltipContext, TooltipSpec } from './tooltips/types';

/**
 * Minimal shape the loader needs from an adapter: a function of the raw
 * fetched payload(s) for a track, returning whatever the renderer consumes.
 * Kept `any` because adapter output shapes are deliberately heterogeneous
 * (feature arrays, linegraph points, variation graphs, heatmap matrices…).
 */
type AdapterFn = (...rawArgs: any[]) => unknown | Promise<unknown>;

export type AdapterMap = Record<string, AdapterFn>;

type FetchOne = (url: string) => Promise<unknown>;

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
};

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
 * Only `from: url` sources have a usable URL — other sources (inline,
 * file, custom) yield an empty string so the dedupe pass skips them
 * cleanly, matching legacy behaviour.
 */
function trackUrl(
  data: NormalizedConfig['groups'][number]['tracks'][number]['data']
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

function safeSubstituteAccession(template: string, accession: string): string {
  const safe = ACCESSION_PATTERN.test(accession) ? accession : '';
  return template.replace('{accession}', safe);
}

export async function loadProtvistaData(
  accession: string,
  config: NormalizedConfig,
  fetchOne: FetchOne,
  adapters: AdapterMap,
  customTrackData: CustomTrackData = {}
): Promise<LoadResult> {
  // Collect unique URL templates across all tracks. Dedup is a documented
  // performance requirement in the spec — identical URLs referenced by
  // multiple tracks must be fetched exactly once. `trackUrl()` yields an
  // empty string for `from: inline | file | custom`, so those descriptors
  // are naturally excluded from the fetch set.
  const urls = [
    ...new Set(
      config.groups.flatMap(({ tracks }) =>
        tracks.flatMap((t) => trackUrl(t.data))
      )
    ),
  ].filter((u) => u !== '');

  const rawData: Record<string, unknown> = Object.fromEntries(
    await Promise.all(
      urls.map(async (url) => [
        url,
        await fetchOne(safeSubstituteAccession(url as string, accession)),
      ])
    )
  );

  const hasData = Object.values(rawData).some(
    (d) => !!(d as { features?: unknown[] } | null)?.features?.length
  );

  const data: Record<string, unknown> = {};

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
  };

  for (const group of config.groups) {
    const groupId = group.id;
    const groupData = await Promise.all(
      group.tracks.map(async (track) => {
        const {
          data: dataConfig,
          id: trackId,
          filter,
          kind,
          dataTooltip,
        } = track;
        const first = dataConfig[0];
        if (!first) return;
        const trackKey = `${groupId}-${trackId}`;
        const url = first.url;
        const adapter = first.adapter;

        // `from: custom` — consumer-supplied data bypasses fetch + adapter
        // entirely. If the descriptor declares `custom` but no data
        // was injected via `setTrackData()`, emit a `console.info`
        // and leave the slot empty. Injected data still flows through
        // the downstream `filter:` sugar and tooltip resolver so behaviour
        // is symmetric with URL-sourced tracks.
        if (first.from === 'custom') {
          if (!(trackKey in customTrackData)) {
            console.info(
              `Track ${groupId}/${trackId} is 'from: custom' but no data was provided via setTrackData().`
            );
            return;
          }
          const transformedData: any = customTrackData[trackKey];
          const filteredData =
            Array.isArray(transformedData) && filter
              ? transformedData.filter(
                  ({ type }: { type?: string }) => type === filter
                )
              : transformedData;
          if (filteredData == null) return;
          const spec: TooltipSpec | undefined =
            dataTooltip ?? (kind ? tooltipDefaults[kind] : undefined);
          const annotated = applyTooltipResolver(filteredData, spec, {
            accession,
            trackId,
            kind: kind ?? '',
          });
          assignTrackData(trackKey, annotated, track);
          return annotated;
        }

        const trackData = (Array.isArray(url) ? url : [url ?? '']).map(
          (u) => rawData[u as string] || []
        );

        // variation-adapter refuses to run against an empty payload
        // (behaviour preserved from the legacy loader).
        if (
          adapter === 'uniprot-variation-json' &&
          (trackData[0] as unknown[]).length === 0
        ) {
          return;
        }

        // 1. Convert data
        let transformedData: any = adapter
          ? await adapters[adapter].apply(null, trackData)
          : trackData;

        if (adapter === 'interpro-entries-json') {
          const representativeDomains: any[] = [];
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
      })
    );

    data[groupId] =
      group.component === 'nightingale-linegraph-track' ||
      group.component === 'nightingale-colored-sequence'
        ? groupData[0]
        : groupData.flat();
  }

  return { rawData, data, hasData };
}
