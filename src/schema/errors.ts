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
 * (`/groups/3/tracks/1/data`) when produced by Ajv, and a
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
  /** Human-readable message, matching the strings documented in specs/config-approach.md's Edge Cases table. */
  message: string;
  /** Stable machine-readable identifier (kebab-case). */
  code: ValidationIssueCode;
}

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
  | 'cannot-infer-adapter'
  | 'missing-inline-data'
  | 'missing-track-renderer'
  | 'invalid-color-scale'
  | 'unsupported-version'
  | 'missing-accession'
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
      throw new Error(
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
 * Format a list of issues as a readable multi-line summary:
 *
 *     Config validation failed (3 issues):
 *       - /groups/0/id: must be string (schema)
 *       - MOLECULE_PROCESSING/signal: Unknown adapter: foo... (unknown-adapter)
 *       - ...
 */
function formatIssues(issues: ValidationIssue[]): string {
  const header =
    issues.length === 1
      ? 'Config validation failed (1 issue):'
      : `Config validation failed (${issues.length} issues):`;
  const body = issues
    .map((i) => `  - ${i.path}: ${i.message} (${i.code})`)
    .join('\n');
  return `${header}\n${body}`;
}
