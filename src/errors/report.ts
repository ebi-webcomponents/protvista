/**
 * Shared vocabulary for the user-facing error surfaces.
 *
 * `<protvista-uniprot>` reports every failure through a single seam
 * (`_report` on the element), which asks the routing table in
 * `./router.ts` which channels it reaches: the developer-facing
 * `console.*` line, a mount-level alert panel, a per-track badge, and the
 * bubbling `protvista-error` CustomEvent for embedders. This module holds
 * the two types that vocabulary is built on — kept type-only so it adds
 * nothing to the runtime bundle.
 */

/**
 * The stable set of error phases carried on the `protvista-error`
 * event's `detail.phase`. Embedders listen once and `switch` on this.
 *
 * Five phases emit today:
 *   - `config`          — config validation / parse failure (mount panel),
 *                         or a config that loaded with warnings (event only;
 *                         `detail.severity` is `'warning'`, and each issue,
 *                         when there are any, carries `severity: 'warning'`)
 *   - `sequence`        — no usable sequence for the accession (mount panel)
 *   - `track-fetch`     — a track's data failed: its URL was unreachable
 *                         or answered 5xx, an authored path or URL 4xx'd, its
 *                         body was unparseable, or its decoder / adapter
 *                         threw on the records (badge + event)
 *   - `set-track-data`  — misuse of the `setTrackData()` escape hatch
 *   - `track-data`      — an authored track's coordinates fall outside the
 *                         loaded sequence (event only; the issue carries
 *                         `code: 'coordinate-out-of-range'` and
 *                         `severity: 'warning'`)
 *
 * Two are reserved for surfaces that don't exist in the codebase yet;
 * they are declared here so the vocabulary is stable and so that when
 * those features land they emit through the same `_report` seam
 * (one listener covers every flavour):
 *   - `transform-calculate` — a `calculate` expression threw for some
 *                             items (see specs/transform-engine.md)
 *   - `tooltip-field-miss`  — a `dataTooltip` template referenced a
 *                             field the adapter output does not carry
 */
export type ErrorPhase =
  | 'config'
  | 'sequence'
  | 'track-fetch'
  | 'set-track-data'
  | 'track-data'
  | 'transform-calculate'
  | 'tooltip-field-miss';

/**
 * The `detail.context` payload on the `protvista-error` event. Every
 * field is optional — the reporter fills in whatever is relevant to the
 * phase (e.g. `groupId`/`trackId`/`url`/`status` for `track-fetch`,
 * `accession` for `sequence`). `accession` is always populated when the
 * element has one.
 */
export interface ErrorContext {
  groupId?: string;
  trackId?: string;
  accession?: string;
  url?: string;
  status?: number;
  /**
   * For `track-fetch`, how the track failed, in pipeline order:
   *
   *   - `network` — unreachable (blocked, offline, DNS, CORS, timeout);
   *   - `http`    — a 4xx/5xx response (`status` is set);
   *   - `parse`   — a 2xx body that failed to parse;
   *   - `adapter` — the body arrived, but the decoder / shape validator /
   *                 named adapter threw on it (a malformed file, or a
   *                 provider adapter's own request failing);
   *   - `render`  — the payload was built, and the Nightingale element
   *                 rejected it when handed over. `trackId` is absent when
   *                 the rejected payload was a group's collapsed aggregate
   *                 rather than one track's.
   *
   * An `adapter` or `render` failure's message is the thrown error's own
   * text, which names the author's file and the offending row.
   */
  errorKind?: 'network' | 'http' | 'parse' | 'adapter' | 'render';
}
