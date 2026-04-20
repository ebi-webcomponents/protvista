/**
 * Shared JSON / YAML parser used by `loadConfig` (#22) and the
 * `extends` merger (#20).
 *
 * Kept in its own module (rather than a private helper inside
 * `load.ts`) because the `extends` resolver also needs to parse
 * fetched base-config text, and factoring the parser avoids a
 * circular import between `load.ts` and `extends.ts`.
 *
 * `js-yaml` is lazy-loaded via dynamic `import()` so JSON-only
 * adopters never pay for the parser — the Vite chunker splits it
 * into its own asynchronous chunk.
 */

/** Parser formats accepted by `parseConfigText`. */
export type ParseFormat = 'auto' | 'json' | 'yaml';

/**
 * Parse a raw string into a plain JS value, auto-detecting JSON vs
 * YAML by the leading non-whitespace character.
 *
 * @throws `SyntaxError` if the string is neither valid JSON nor valid
 *   YAML. The underlying parser's error is re-thrown unchanged so
 *   callers see line/column information.
 */
export async function parseConfigText(
  text: string,
  format: ParseFormat = 'auto'
): Promise<unknown> {
  const resolved = format === 'auto' ? detectFormat(text) : format;
  if (resolved === 'json') return JSON.parse(text);
  return parseYaml(text);
}

/**
 * Content-based format detection. Any string whose first
 * non-whitespace character is `{` or `[` is JSON; everything else is
 * YAML. This tracks the de facto convention used by every polyglot
 * config loader (VS Code settings, GitHub Actions, etc.) and does
 * the right thing for common YAML documents (which almost never
 * start with a bracket).
 */
export function detectFormat(text: string): 'json' | 'yaml' {
  const trimmed = text.trimStart();
  const first = trimmed.charAt(0);
  if (first === '{' || first === '[') return 'json';
  return 'yaml';
}

/**
 * Lazy-load `js-yaml` and parse. Uses `load` (not `loadAll`) because
 * the config schema is defined for a single root document. Pins the
 * `SAFE_SCHEMA` explicitly — `js-yaml`'s default has historically
 * been `DEFAULT_FULL_SCHEMA` in some versions, which permits
 * `!!js/function` / `!!js/regexp` tags that construct arbitrary JS
 * objects. Configs are authored input, not trusted code, so we ask
 * for the explicit SAFE option and don't rely on the library's
 * version-dependent default.
 */
async function parseYaml(text: string): Promise<unknown> {
  const mod = await import('js-yaml');
  // Both CJS (`mod.default.load`) and ESM (`mod.load`) need to
  // resolve; tolerate either. Most bundlers settle on one or the
  // other depending on `esModuleInterop` / `allowSyntheticDefaultImports`.
  type YamlModule = {
    load: (text: string, opts?: { schema?: unknown }) => unknown;
    SAFE_SCHEMA?: unknown;
  };
  const yaml: YamlModule =
    typeof (mod as { load?: unknown }).load === 'function'
      ? (mod as unknown as YamlModule)
      : (mod as { default: YamlModule }).default;
  // Some versions export `CORE_SCHEMA` / `DEFAULT_SCHEMA` instead of
  // `SAFE_SCHEMA`; falling back to the library default (no opts) if
  // neither is reachable keeps this forward-compatible. The current
  // shipped `js-yaml` (4.x) exports `CORE_SCHEMA` — which is already
  // safe (no function/regexp tags) — via the same module namespace.
  const schema =
    (yaml as { SAFE_SCHEMA?: unknown; CORE_SCHEMA?: unknown }).SAFE_SCHEMA ??
    (yaml as { CORE_SCHEMA?: unknown }).CORE_SCHEMA;
  return schema !== undefined
    ? yaml.load(text, { schema })
    : yaml.load(text);
}
