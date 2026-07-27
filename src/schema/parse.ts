/**
 * Shared JSON / YAML parser used by `loadConfig` and the
 * `extends` merger.
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
 *   YAML, or if it holds no document at all (blank, whitespace, or
 *   comments only). A parser error is re-thrown unchanged so callers
 *   see line/column information.
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
function detectFormat(text: string): 'json' | 'yaml' {
  const trimmed = text.trimStart();
  const first = trimmed.charAt(0);
  if (first === '{' || first === '[') return 'json';
  return 'yaml';
}

/**
 * Lazy-load `js-yaml` and parse. Uses `load` (not `loadAll`) because
 * the config schema is defined for a single root document.
 *
 * Pins `CORE_SCHEMA` explicitly — the narrowest schema `js-yaml`
 * offers (the failsafe types plus `null` / bool / int / float). It
 * carries no `!!js/function` or `!!js/regexp` tags that would
 * construct arbitrary JS objects, and no merge keys or timestamps.
 * Configs are authored input, not trusted code, so we name the schema
 * rather than relying on the library's version-dependent default.
 *
 * `SAFE_SCHEMA` is kept in the lookup below only as a zero-cost guard:
 * neither the pinned 4.x nor 5.x exports that name, so the `??` has
 * always fallen through to `CORE_SCHEMA`.
 */
async function parseYaml(text: string): Promise<unknown> {
  // A document with no content — blank, whitespace, or comments only —
  // is version-dependent upstream: `js-yaml` 4.x returns `undefined` /
  // `null`, 5.x throws. Pin the contract here so it belongs to this
  // parser rather than to whichever major is installed. A bare `---`
  // counts as content and still parses to `null`, as it does in both.
  const hasContent = text.split('\n').some((line) => {
    const trimmed = line.trim();
    return trimmed !== '' && !trimmed.startsWith('#');
  });
  if (!hasContent) {
    throw new SyntaxError('expected a document, but the input is empty');
  }
  const mod = await import('js-yaml');
  // Two concrete shapes reach here, so tolerate either: native Node
  // ESM hands back the namespace directly (`mod.load`), while esbuild
  // pre-bundling — `js-yaml` is in `optimizeDeps.include` for both the
  // browser test project and the docs playground — can apply CJS
  // interop and nest it (`mod.default.load`).
  type YamlModule = {
    load: (text: string, opts?: { schema?: unknown }) => unknown;
    SAFE_SCHEMA?: unknown;
  };
  const yaml: YamlModule =
    typeof (mod as { load?: unknown }).load === 'function'
      ? (mod as unknown as YamlModule)
      : (mod as unknown as { default: YamlModule }).default;
  // Falling back to the library default (no opts) if neither name is
  // reachable keeps this forward-compatible across another rename.
  const schema =
    (yaml as { SAFE_SCHEMA?: unknown; CORE_SCHEMA?: unknown }).SAFE_SCHEMA ??
    (yaml as { CORE_SCHEMA?: unknown }).CORE_SCHEMA;
  return schema !== undefined
    ? yaml.load(text, { schema })
    : yaml.load(text);
}
