/**
 * Content-based JSON vs YAML detection for the playground editor.
 *
 * Mirrors the (private) heuristic in `src/schema/parse.ts`: any string
 * whose first non-whitespace character is `{` or `[` is treated as
 * JSON, everything else as YAML. Duplicated here (a one-liner) rather
 * than exported from the schema module so the editor can pick a
 * highlighting language without reaching into schema internals.
 */
export function detectFormat(text: string): 'json' | 'yaml' {
  const first = text.trimStart().charAt(0);
  return first === '{' || first === '[' ? 'json' : 'yaml';
}

/**
 * File name for a download of *text* as the playground config.
 *
 * JSON when {@link detectFormat} says JSON, YAML otherwise — kept next to
 * the detector so the extension can never drift from the highlighting
 * language. Pure: no DOM, no side effects.
 */
export function configFileName(text: string): string {
  return detectFormat(text) === 'json' ? 'config.json' : 'config.yaml';
}
