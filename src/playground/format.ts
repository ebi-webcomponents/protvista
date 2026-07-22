/**
 * Content-based JSON vs YAML detection for the playground editor.
 *
 * Mirrors the (private) heuristic in `src/schema/parse.ts`: any string
 * whose first non-whitespace character is `{` or `[` is treated as
 * JSON, everything else as YAML. Duplicated here (a one-liner) rather
 * than exported from the schema module so the playground's editor and
 * linter can pick a language without reaching into schema internals.
 */
export function detectFormat(text: string): 'json' | 'yaml' {
  const first = text.trimStart().charAt(0);
  return first === '{' || first === '[' ? 'json' : 'yaml';
}
