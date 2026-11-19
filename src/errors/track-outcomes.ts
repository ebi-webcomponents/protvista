/**
 * Correlation of one load batch's per-track outcomes back to the rows that
 * own them.
 *
 * `loadProtvistaData` returns three things a track's failure can be read
 * from: the URLs each track fetched (`trackUrls`), the transport outcome per
 * URL (`fetchErrors`) and the processing outcome per track
 * (`trackFailures`). Neither source logs or renders anything itself, so
 * `<protvista-uniprot>` (`_collectTrackErrors`) asks this module which of
 * them are *broken* — a badge, an event, perhaps the panel — and which are
 * *expected absences* that only reach the console, then routes each one.
 *
 * Pure: no Lit, no DOM, no reporting. Every decision here is a function of
 * the config and the batch, so each branch is testable without mounting the
 * element.
 */

import type { TrackProcessingFailure } from '../load-data.js';
import {
  isAuthoredSource,
  type NormalizedRow,
  type NormalizedTrack,
} from '../schema/normalize.js';

/**
 * How a track's data failed. See `_trackErrors`.
 *
 * The first three are transport outcomes, classified by `_loadData`'s
 * fetcher (`makeRecordingFetch`). `adapter` is the processing outcome: the
 * body arrived fine but the decoder, the shape validator or the named
 * adapter threw on it — a malformed file, which is an authoring error and
 * not a service one.
 * `render` is the last step: the payload was built, and the Nightingale
 * element rejected it when handed over (see `_assignComponentData`).
 */
export type FetchErrorKind =
  'network' | 'http' | 'parse' | 'adapter' | 'render';

/** A single track's data failure, correlated to its group/track. */
export type TrackFetchError = {
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

/** A track-less fetch failure, as `makeRecordingFetch` records it. */
export type UrlFetchError = Omit<TrackFetchError, 'groupId' | 'trackId'>;

/** Every fetch failure among one track's URLs, in URL order. */
export const trackFetchFailures = (
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
export const isExpectedAbsence = (
  err: UrlFetchError,
  authored: boolean
): boolean => err.kind === 'http' && (err.status ?? 0) < 500 && !authored;

/**
 * Whether the track's location is the author's own rather than a provider
 * endpoint — what makes a 4xx *broken* instead of *missing*.
 *
 * An *authored* source — the author's own data, a descriptor with a
 * `format` — counts however it was written: `./hits.csv`, an absolute URL,
 * or the `{ url: … }` object form. The author wrote that location
 * themselves, and nothing publishes data at it conditionally — a 404 can
 * only mean the path or URL is wrong, which is the single most common
 * authoring mistake (a relative path resolves against the *hosting page*,
 * not the config file). The descriptor already says which kind of source it
 * is, so the classification reads it rather than discarding it.
 *
 * `from: file` is the author's location too, even when it names an explicit
 * `adapter:` instead of a `format` — the very descriptor the validator
 * recommends for a file it cannot sniff — so it counts here alongside
 * `isAuthoredSource`.
 */
export const ownsLocation = (track: NormalizedTrack): boolean =>
  isAuthoredSource(track.data[0]) || track.data[0]?.from === 'file';

/**
 * One expected absence to log at `info`: a provider endpoint answering 4xx
 * (one per URL, so a track reading two endpoints says which of them had
 * nothing), or a `from: custom` track nobody injected data into.
 */
export interface TrackAbsence {
  /** The `${groupId}-${trackId}` key. */
  key: string;
  groupId: string;
  trackId: string;
  /** The provider URL that had nothing. Absent for a `from: custom` track. */
  source?: string;
  /** The console line, verbatim. */
  message: string;
}

/** What one batch's outcomes correlate to. */
export interface TrackOutcomes {
  /**
   * Every track the batch found *broken*, keyed by `${groupId}-${trackId}`,
   * in config order. Only this batch's: the caller merges them into the
   * errors it keeps (a targeted retry preserves the other tracks').
   */
  errors: Map<string, TrackFetchError>;
  /**
   * Every expected absence among the tracks this batch (re)loaded, in config
   * order. Never a track in `errors`.
   */
  absences: TrackAbsence[];
}

/** The batch a track's outcome is read from. */
interface TrackBatch {
  trackUrls: Record<string, string[]>;
  fetchErrors: ReadonlyMap<string, UrlFetchError>;
  trackFailures: Record<string, TrackProcessingFailure>;
}

/**
 * The error a track's fetch failure records, tagged with whether the
 * location was the author's own and whether it was the `from: file`
 * shorthand (which selects the path-specific wording).
 */
const fetchFailure = (
  groupId: string,
  track: NormalizedTrack,
  broken: UrlFetchError
): TrackFetchError => {
  const fromFile = track.data[0]?.from === 'file';
  return {
    ...broken,
    ...(ownsLocation(track) ? { authored: true } : {}),
    ...(fromFile ? { fromFile } : {}),
    groupId,
    trackId: track.id,
  };
};

/**
 * The error a track whose *processing* threw records: a malformed file, a
 * body the adapter rejected, or an unregistered adapter name.
 */
const processingFailure = (
  groupId: string,
  track: NormalizedTrack,
  urls: readonly string[] | undefined,
  failure: TrackProcessingFailure
): TrackFetchError => {
  const authored = isAuthoredSource(track.data[0]);
  return {
    url: urls?.[0] ?? '',
    kind: 'adapter',
    message: failure.message,
    ...(authored ? { authored } : {}),
    ...(failure.retryable ? { retryable: true } : {}),
    groupId,
    trackId: track.id,
  };
};

/**
 * The *broken* outcome of one track in the batch, or `undefined` when it has
 * none.
 *
 * An HTTP 4xx from a *provider endpoint* is NOT a track error: it means
 * "this accession has no data of this kind" (a 404 is the common case). We
 * want the viewer to flag things that are *broken*, not *missing* — so that
 * 4xx is treated exactly like an empty response: the track simply has no
 * data and is hidden, with no badge, event, or panel. An authored location
 * is the opposite case (`ownsLocation`).
 *
 * A track can fetch several URLs (an AlphaFold track reads the prediction
 * API *and* the Proteins API), so every one of its failures is weighed, not
 * just the first: a 503 on one URL must not hide behind a provider 404 on
 * another.
 */
const brokenOutcome = (
  groupId: string,
  track: NormalizedTrack,
  key: string,
  batch: TrackBatch
): TrackFetchError | undefined => {
  const owns = ownsLocation(track);
  const failed = trackFetchFailures(batch.trackUrls[key], batch.fetchErrors);
  const broken = failed.find((e) => !isExpectedAbsence(e, owns));
  if (broken) return fetchFailure(groupId, track, broken);
  // Only provider 4xxs — missing, not broken. See `expectedAbsences`.
  if (failed.length > 0) return undefined;
  // A track whose *processing* threw. Only reached when none of the track's
  // fetches failed — when one did, that outcome is the explanation, and an
  // adapter choking on the empty body left behind must not resurrect a
  // deliberately-silent 4xx.
  //
  // Severity gates this: an `info` outcome (a `from: custom` track nobody
  // injected data into) is an expected absence, so it must not land in
  // `_trackErrors` — that map is what draws badges and counts towards a
  // group being wholly broken.
  const failure = batch.trackFailures[key];
  if (failure?.severity !== 'error') return undefined;
  return processingFailure(groupId, track, batch.trackUrls[key], failure);
};

/**
 * The expected absences of one track the batch found nothing broken in.
 *
 * The only fetch failures `brokenOutcome` leaves unpromoted are 4xxs from
 * provider endpoints. Spelt out rather than inferred so the two halves of the
 * classification cannot drift apart. One per URL, so a track reading two
 * endpoints says which of them had nothing.
 */
const expectedAbsences = (
  groupId: string,
  track: NormalizedTrack,
  key: string,
  batch: TrackBatch
): TrackAbsence[] => {
  const owns = ownsLocation(track);
  const absent = trackFetchFailures(
    batch.trackUrls[key],
    batch.fetchErrors
  ).filter((e) => isExpectedAbsence(e, owns));
  if (absent.length > 0) {
    return absent.map((skipped) => ({
      key,
      groupId,
      trackId: track.id,
      source: skipped.url,
      message: `[protvista-uniprot] track ${groupId}/${track.id}: no data (HTTP ${skipped.status}) at ${skipped.url}.`,
    }));
  }
  // `from: custom` with nothing injected. Same expected absence; the
  // message is the documented one `load-data.ts` builds, passed through
  // unchanged.
  const failure = batch.trackFailures[key];
  if (failure?.severity !== 'info') return [];
  return [{ key, groupId, trackId: track.id, message: failure.message }];
};

/**
 * Correlate one batch's outcomes to the tracks of `config`.
 *
 * `trackUrls` is the authoritative per-track URL map returned by
 * `loadProtvistaData` (the loader is the single source of truth for which
 * URL each track fetched), so this never re-derives the substitution.
 * Untouched tracks aren't in `trackUrls` on a partial reload, so they
 * correlate to nothing. `only` is a targeted retry's set of reloaded track
 * keys: absences are reported for those alone.
 */
export const classifyTrackOutcomes = (
  config: { rows: readonly NormalizedRow[] },
  trackUrls: Record<string, string[]>,
  fetchErrors: ReadonlyMap<string, UrlFetchError>,
  trackFailures: Record<string, TrackProcessingFailure>,
  only?: ReadonlySet<string>
): TrackOutcomes => {
  const batch: TrackBatch = { trackUrls, fetchErrors, trackFailures };
  const errors = new Map<string, TrackFetchError>();
  const absences: TrackAbsence[] = [];
  for (const group of config.rows) {
    for (const track of group.tracks) {
      const key = `${group.id}-${track.id}`;
      const broken = brokenOutcome(group.id, track, key, batch);
      if (broken) errors.set(key, broken);
      else if (!only || only.has(key)) {
        absences.push(...expectedAbsences(group.id, track, key, batch));
      }
    }
  }
  return { errors, absences };
};

/**
 * The groups every one of whose tracks has an error in `trackErrors` — the
 * "every track failed" set. An empty group never counts.
 */
export const whollyFailedGroups = (
  rows: readonly NormalizedRow[],
  trackErrors: ReadonlyMap<string, unknown>
): Set<string> => {
  const failed = new Set<string>();
  for (const group of rows) {
    if (
      group.tracks.length > 0 &&
      group.tracks.every((t) => trackErrors.has(`${group.id}-${t.id}`))
    ) {
      failed.add(group.id);
    }
  }
  return failed;
};
