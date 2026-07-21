/**
 * Display formatter for `ConfigValidationError.issues`.
 *
 * Turns the flat `ValidationIssue[]` carried by a `ConfigValidationError`
 * into a rendering-friendly shape: a one-line summary plus the issues
 * grouped by `path` (so multiple problems on the same track collapse
 * under one heading in the panel).
 *
 * Deliberately isolated in its own module with **no lit / DOM imports**
 * and a **type-only** import of `ValidationIssue`, so it compiles to a
 * standalone chunk. `<protvista-uniprot>` only ever pulls it in via a
 * dynamic `await import('./errors/format')` inside the config-error
 * catch — the happy path never downloads it, keeping the error-surface
 * feature off the eagerly-loaded bundle budget.
 */

import { formatValidationSummary, type ValidationIssue } from '../schema/errors';

/** One `path` heading and the issues filed under it. */
export interface FormattedIssueGroup {
  /** The shared `path` (JSON-Pointer or `groupId/trackId`). */
  path: string;
  items: { message: string; code: string }[];
}

/** The panel-ready shape produced from a `ConfigValidationError`. */
export interface FormattedError {
  /**
   * One-line summary, from `formatValidationSummary` in
   * `schema/errors.ts` — the single source of the header wording, shared
   * with the `console.error`/`error.message` text so they never drift.
   */
  summary: string;
  /** Issues grouped by `path`, in first-seen order. */
  groups: FormattedIssueGroup[];
  /** The original issues, untouched — for the Copy-to-clipboard action. */
  raw: ValidationIssue[];
}

/**
 * Build the panel-ready {@link FormattedError} from a list of validation
 * issues. Pure; never mutates its input. Grouping preserves first-seen
 * `path` order so the panel reads top-to-bottom in config order.
 */
export function formatValidationIssues(
  issues: ValidationIssue[]
): FormattedError {
  const summary = formatValidationSummary(issues);

  const byPath = new Map<string, FormattedIssueGroup>();
  for (const issue of issues) {
    let group = byPath.get(issue.path);
    if (!group) {
      group = { path: issue.path, items: [] };
      byPath.set(issue.path, group);
    }
    group.items.push({ message: issue.message, code: issue.code });
  }

  return { summary, groups: [...byPath.values()], raw: issues };
}
