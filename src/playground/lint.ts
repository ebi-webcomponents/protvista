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
import { parseConfigText } from '../schema/parse.js';
import { validateConfig } from '../schema/validate.js';
import { createRegistry } from '../schema/registry.js';

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
 * Extract a character offset from a thrown parser error. Kept tolerant
 * across parser versions (the repo has moved js-yaml major versions):
 * a js-yaml `YAMLException` exposes a `mark` with either a `position`
 * (char offset) or 0-based `line`/`column`; `JSON.parse` embeds
 * `position N` in its message on V8. Falls back to 0 when nothing is
 * available — a marker at the document start, never a throw.
 */
function lineColToOffset(text: string, line: number, column: number): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i += 1) {
    offset += lines[i].length + 1; // +1 for the consumed newline
  }
  return offset + Math.max(0, column);
}

function offsetFromParseError(error: unknown, text: string): number {
  const mark = (
    error as { mark?: { position?: number; line?: number; column?: number } }
  )?.mark;
  if (mark) {
    if (typeof mark.position === 'number') return mark.position;
    // js-yaml marks are 0-based. Robust to a parser dropping/renaming
    // `position` as long as line/column survive.
    if (typeof mark.line === 'number') {
      return lineColToOffset(text, mark.line, mark.column ?? 0);
    }
  }
  const message = (error as { message?: string })?.message ?? '';
  const jsonPos = /position (\d+)/i.exec(message); // JSON.parse on V8
  if (jsonPos) return Number(jsonPos[1]);
  const yamlLineCol = /\((\d+):(\d+)\)/.exec(message); // js-yaml "(line:column)", 1-based
  if (yamlLineCol) {
    return lineColToOffset(
      text,
      Number(yamlLineCol[1]) - 1,
      Number(yamlLineCol[2]) - 1
    );
  }
  return 0;
}

/**
 * Compute diagnostics for the current editor text. Empty/whitespace
 * input yields no diagnostics (a blank editor is not an error). A
 * syntax error yields a single diagnostic; otherwise every validation
 * issue is surfaced.
 *
 * `accession` is the accession the preview will render with. It is
 * injected before validation (mirroring `<protvista-uniprot>`'s loader)
 * so a config that uses `{accession}` placeholders but declares no
 * `accession:` of its own — e.g. the canonical default config — does
 * not spuriously fail the `missing-accession` rule.
 */
export async function computeDiagnostics(
  text: string,
  accession?: string
): Promise<PlaygroundDiagnostic[]> {
  if (text.trim() === '') return [];

  let parsed: unknown;
  try {
    parsed = await parseConfigText(text);
  } catch (error) {
    const at = Math.min(offsetFromParseError(error, text), text.length);
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

  // Only when the config declares no accession itself — an authored
  // `accession:` takes precedence, exactly as the element treats it.
  if (
    accession &&
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    (parsed as { accession?: unknown }).accession == null
  ) {
    parsed = { ...(parsed as object), accession };
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
