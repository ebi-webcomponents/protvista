/**
 * Turns the playground editor's text into diagnostics, reusing the
 * shipped config validator as the single source of truth.
 *
 * The pipeline mirrors what `<protvista-uniprot>` does at mount:
 *   1. `parseConfigText` — YAML/JSON syntax (precise line/column).
 *   2. `validateConfig`  — structural + semantic issues (`path`,
 *      `message`, `code`), against a fresh built-in registry.
 * No schema is re-declared here; the editor only *renders* what the
 * validator already reports (satisfying "validate live via
 * src/schema/validate.ts" without duplication).
 *
 * The returned shape is a structural superset of CodeMirror's
 * `Diagnostic` (`from`, `to`, `severity`, `message`), so `editor.ts`
 * can hand the array straight to `@codemirror/lint` — while this module
 * itself imports nothing from CodeMirror and unit-tests under jsdom.
 * The extra `code`/`path` fields (ignored by CodeMirror) drive the
 * side error list and let tests assert on the stable machine code.
 */
import { parseConfigText } from '../schema/parse';
import { validateConfig } from '../schema/validate';
import { createRegistry } from '../schema/registry';

export interface PlaygroundDiagnostic {
  /** Start offset in the document (character index). */
  from: number;
  /** End offset (character index); may equal `from` for a point marker. */
  to: number;
  severity: 'error' | 'warning';
  /** Human-readable text shown in the gutter tooltip and side list. */
  message: string;
  /** Stable machine code (`syntax` for parse errors, else the issue code). */
  code?: string;
  /** JSON-Pointer / `group/track` path into the offending config location. */
  path?: string;
}

/**
 * Best-effort mapping of a validation issue `path` to a text range, so
 * the gutter marker lands near the offending line. Falls back to the
 * document start when the leaf token can't be located — the full path
 * is always in the message regardless.
 */
/** Escape regex metacharacters — issue `path` segments come from
 *  author-controlled ids (`track.id`, `group.id`), which may contain
 *  `(`, `[`, `\`, etc. Interpolating those raw would throw at `new RegExp`. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function locate(text: string, path: string | undefined): { from: number; to: number } {
  if (!path) return { from: 0, to: 0 };
  const segments = path.split('/').filter(Boolean);
  // The last non-numeric segment is the field/id worth highlighting
  // (`/rows/3/tracks/1/data` → `data`; `GROUP/track` → `track`).
  const leaf = [...segments].reverse().find((s) => !/^\d+$/.test(s));
  if (!leaf) return { from: 0, to: 0 };
  // Match the token as a YAML key (`leaf:`), a JSON key (`"leaf"`), or a
  // bare id value. Word-boundary anchored to avoid substring hits.
  const escaped = escapeRegExp(leaf);
  const re = new RegExp(`(?:"${escaped}"|\\b${escaped}\\b)`);
  const match = re.exec(text);
  if (!match) return { from: 0, to: 0 };
  return { from: match.index, to: match.index + match[0].length };
}

/**
 * Extract a character offset from a thrown parser error. `js-yaml`
 * attaches a `mark` with a `position`; `JSON.parse` embeds `position N`
 * in its message on V8. Returns 0 when neither is available.
 */
function offsetFromParseError(error: unknown): number {
  const mark = (error as { mark?: { position?: number } })?.mark;
  if (mark && typeof mark.position === 'number') return mark.position;
  const message = (error as { message?: string })?.message ?? '';
  const posMatch = /position (\d+)/i.exec(message);
  if (posMatch) return Number(posMatch[1]);
  return 0;
}

/**
 * Compute diagnostics for the current editor text. Empty/whitespace
 * input yields no diagnostics (a blank editor is not an error). A
 * syntax error yields a single diagnostic; otherwise every validation
 * issue is surfaced.
 */
export async function computeDiagnostics(
  text: string
): Promise<PlaygroundDiagnostic[]> {
  if (text.trim() === '') return [];

  let parsed: unknown;
  try {
    parsed = await parseConfigText(text);
  } catch (error) {
    const at = Math.min(offsetFromParseError(error), text.length);
    return [
      {
        from: at,
        to: Math.min(at + 1, text.length),
        severity: 'error',
        code: 'syntax',
        message: (error as Error).message || 'Could not parse config',
      },
    ];
  }

  const result = validateConfig(parsed, createRegistry());
  return result.issues.map((issue) => ({
    ...locate(text, issue.path),
    severity: 'error' as const,
    code: issue.code,
    path: issue.path,
    message: issue.path ? `${issue.message} (${issue.path})` : issue.message,
  }));
}
