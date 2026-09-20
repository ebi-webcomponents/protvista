/**
 * Error types raised by the ProtVista config validator and loader.
 *
 * A single `ConfigValidationError` type carries every validation
 * failure — both the structural ones produced by Ajv against
 * `schema.json` and the semantic ones produced by `validateConfig`
 * (unknown adapter, unknown kind, unresolved source key, …). Callers
 * that want to render a summary to the user iterate over `issues`;
 * callers that just want to bail out read `error.message` (a
 * pre-formatted multi-line summary of every issue).
 *
 * The error is *always* constructed with at least one issue — an
 * empty array is a programming mistake, not a representable state.
 */

/**
 * One validation problem. `path` uses JSON-Pointer style notation
 * (`/rows/3/tracks/1/data`) when produced by Ajv, and a
 * human-readable "group.track" form (`MOLECULE_PROCESSING/signal`)
 * when produced by the semantic checks — whichever makes the message
 * most actionable.
 *
 * `code` is a stable machine-readable discriminator so downstream
 * tooling (editor extensions, CI scripts) can filter by error class
 * without parsing the human-facing `message` string.
 */
export interface ValidationIssue {
  /** JSON Pointer or `groupId/trackId` path into the offending config location. */
  path: string;
  /** Human-readable message; wording is stable so consumers can match on it. */
  message: string;
  /** Stable machine-readable identifier (kebab-case). */
  code: ValidationIssueCode;
  /**
   * How much this issue matters. Absent means `'error'`, so every issue
   * written before this field existed keeps its meaning and no consumer
   * checking `result.valid` changes behaviour.
   *
   * A `'warning'` names something legal but worth saying out loud — an
   * explicit `format:` overriding a file's own extension, say. It does not
   * make the config invalid. Warnings are issues rather than `console.warn`
   * calls on purpose: console-only diagnostics never reach the
   * `protvista-error` event, the ⚠ badge, or CI.
   */
  severity?: 'error' | 'warning';
}

/** An issue that makes the config invalid (the default). */
export const isError = (issue: ValidationIssue): boolean =>
  (issue.severity ?? 'error') === 'error';

/**
 * Closed set of validation issue codes. Every semantic check in
 * `validateConfig` emits one of these; structural Ajv errors are
 * bucketed under `schema` so consumers can distinguish structural
 * from semantic failures without string-matching the message.
 */
export type ValidationIssueCode =
  | 'schema'
  | 'unknown-source-key'
  | 'unknown-adapter'
  | 'unknown-semantic-kind'
  | 'unknown-component'
  | 'unknown-theme'
  | 'missing-inline-data'
  | 'missing-track-renderer'
  | 'invalid-color-scale'
  | 'unsupported-version'
  | 'missing-accession'
  /**
   * A top-level `rows:` entry is neither a group nor a standalone track:
   * it carries neither `tracks:` nor `data:`, or it carries both. The
   * `oneOf` in the schema can only report this as a contradictory
   * "needs `tracks`" / "needs `data`" pair, so the validator detects it
   * directly and replaces those with one targeted message.
   */
  | 'invalid-entry-shape'
  /**
   * A track's `kind` cannot read the file format its `data:` points at —
   * `kind: variants` at a `./x.csv`, say. The kind owns adapter selection,
   * and its family has no member for that extension, so the file would be
   * fetched and handed to an adapter expecting a different body type.
   * Reported at config time rather than surfacing as an opaque parse
   * failure per track at load time.
   */
  | 'kind-format-mismatch'
  /**
   * An explicit `format:` disagrees with the file extension on the same
   * source (`./x.csv` with `format: tsv`). Legal — a misnamed file is exactly
   * why `format:` exists — and reported at `severity: 'warning'` so the
   * author sees the override they may not have intended.
   */
  | 'format-overrides-extension'
  /**
   * Inline data that is encoded text (a YAML block scalar) with no `format:`
   * to say how to read it. There is no content-sniffing, so this cannot be
   * resolved by guessing.
   */
  | 'missing-format'
  // ── Extends resolution ─────────────────────────────────
  /** The `extends` chain forms a cycle (a → b → a). */
  | 'circular-extends'
  /** A name in `extends` could not be resolved via the resolver or fetched as a URL/path. */
  | 'cannot-resolve-extends'
  /** A fetched `extends` target failed to parse as JSON/YAML. The
   *  issue message names the target (by preset name or URL) so the
   *  author can find the malformed file in a multi-level chain. */
  | 'extends-parse-error';

/**
 * Result returned by `validateConfig`. When `valid` is `true`, the
 * `issues` array is empty. Keeping the shape uniform (rather than a
 * discriminated union) matches Ajv's own API and lets callers write
 * a single branch.
 */
export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Thrown by `loadConfig` when validation fails. Preserves the full
 * `issues` array so callers can render a structured summary; the
 * built-in `message` is a readable multi-line rendering suitable
 * for `console.error` or developer-facing error pages.
 */
export class ConfigValidationError extends Error {
  public readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    if (issues.length === 0) {
      throw new TypeError(
        'ConfigValidationError requires at least one issue — an empty issues array is a programming error.'
      );
    }
    super(formatIssues(issues));
    this.name = 'ConfigValidationError';
    this.issues = issues;
    // Maintain prototype chain across transpilation targets so that
    // `error instanceof ConfigValidationError` works for consumers
    // that down-level this package to ES5.
    Object.setPrototypeOf(this, ConfigValidationError.prototype);
  }
}

/**
 * The one-line header summarising a batch of validation issues, e.g.
 * `Config validation failed (3 issues):`. The single source of truth for
 * this wording — shared by the `ConfigValidationError.message` body
 * (console channel) and the user-facing error panel (via
 * `src/errors/format.ts`) so the two never drift.
 */
export function formatValidationSummary(issues: ValidationIssue[]): string {
  return issues.length === 1
    ? 'Config validation failed (1 issue):'
    : `Config validation failed (${issues.length} issues):`;
}

/**
 * Format a list of issues as a readable multi-line summary:
 *
 *     Config validation failed (3 issues):
 *       - /rows/0/id: must be string (schema)
 *       - MOLECULE_PROCESSING/signal: Unknown adapter: foo... (unknown-adapter)
 *       - ...
 */
function formatIssues(issues: ValidationIssue[]): string {
  const body = issues
    .map((i) => `  - ${i.path}: ${i.message} (${i.code})`)
    .join('\n');
  return `${formatValidationSummary(issues)}\n${body}`;
}
