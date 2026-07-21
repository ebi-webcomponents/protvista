/**
 * Shared vocabulary for the user-facing error surfaces.
 *
 * `<protvista-uniprot>` reports every error through a single seam
 * (`reportError` on the element). That seam keeps the existing
 * developer-facing `console.*` output *and* adds three user-facing
 * channels on top: a mount-level alert panel, per-track badges, and a
 * bubbling `protvista-error` CustomEvent for embedders. This module
 * holds the two types that vocabulary is built on — kept type-only so
 * it adds nothing to the runtime bundle.
 */

/**
 * The stable set of error phases carried on the `protvista-error`
 * event's `detail.phase`. Embedders listen once and `switch` on this.
 *
 * Four phases emit today:
 *   - `config`          — config validation / parse failure (mount panel)
 *   - `sequence`        — no usable sequence for the accession (mount panel)
 *   - `track-fetch`     — a track's URL returned HTTP 4xx/5xx (opt-in badge)
 *   - `set-track-data`  — misuse of the `setTrackData()` escape hatch
 *
 * Two are reserved for surfaces that don't exist in the codebase yet;
 * they are declared here so the vocabulary is stable and so that when
 * those features land they emit through the same `reportError` seam
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
   * For `track-fetch`, how the fetch failed: `network` (unreachable —
   * blocked, offline, DNS, CORS, timeout), `http` (a 4xx/5xx response;
   * `status` is set), or `parse` (a 2xx body that failed to parse).
   */
  errorKind?: 'network' | 'http' | 'parse';
}
