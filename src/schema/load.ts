/**
 * ProtVista config loader.
 *
 * Orchestrates the parse → validate → normalize pipeline that takes
 * author input (a JSON string, a YAML string, or an already-parsed
 * object) and returns the `NormalizedConfig` shape that
 * `<protvista-uniprot>` can mount directly.
 *
 *   author input  →  parse  →  validate  →  normalize  →  render
 *                    ^         ^            ^
 *                    this     this         this file
 *
 * The split between `loadConfig` (this file) and `validateConfig`
 * (`validate.ts`) exists so that editor tooling, linters, and CI
 * scripts can run the validator without paying for the YAML parser
 * and without committing to the normalize step's shape mutation.
 *
 *
 * ## YAML handling
 *
 * `js-yaml` is lazy-loaded via `import()` — JSON-only adopters never
 * download it. Detection is content-based rather than filename-based
 * so consumers can read a `.yaml` file and pass its contents through
 * the same entry point they use for JSON strings. A string that
 * starts with `{` or `[` (after trimming whitespace) is treated as
 * JSON; anything else is treated as YAML.
 *
 *
 * ## Error contract
 *
 * Two failure modes:
 *
 *   - `SyntaxError` (standard): the input is not a legal JSON or
 *     YAML document. We let the underlying parser's error propagate
 *     so the caller sees the line/column information that parser
 *     surfaces.
 *
 *   - `ConfigValidationError`: the parsed object violates the schema
 *     or the semantic rules. Carries a `.issues[]` array with every
 *     problem (not just the first), so a web UI can render a full
 *     checklist rather than forcing a whack-a-mole edit cycle.
 *
 * `loadConfig` is `async` because of the YAML lazy-load; for
 * JSON-only inputs, the resolved promise is available on the
 * microtask queue and the cost is negligible.
 */

import type { ProtvistaViewerConfig } from './types.js';
import { type Registry, createRegistry } from './registry.js';
import { validateConfig } from './validate.js';
import { normalizeConfig, type NormalizedConfig } from './normalize.js';
import { ConfigValidationError } from './errors.js';
import { parseConfigText, type ParseFormat } from './parse.js';
import {
  mergeExtends,
  type ExtendsResolver,
  type ExtendsFetcher,
} from './extends.js';

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export interface LoadConfigOptions {
  /**
   * Registry used for semantic validation and normalize-time kind
   * resolution. Defaults to a fresh registry with only built-ins
   * seeded (`createRegistry()`); pass your own when you have custom
   * adapters / kinds / themes registered.
   */
  registry?: Registry;

  /**
   * Force a particular parser. Useful for tests or when the input
   * string's content-based detection would misfire (e.g. a YAML
   * document whose first line happens to be `{}`). Defaults to
   * `'auto'` which detects from the leading character.
   */
  format?: ParseFormat;

  /**
   * Resolver invoked for each `extends` name before falling back to
   * URL / file fetching. Accept a function for dynamic lookups or a
   * plain object keyed by preset name for fixed tables.
   *
   * Used to wire the (deferred-in-spec) preset registry without
   * baking the namespace into the loader itself.
   */
  extendsResolver?:
    | ExtendsResolver
    | Record<string, ProtvistaViewerConfig | string>;

  /**
   * Fetch implementation for URL / file-path `extends` entries.
   * Defaults to `globalThis.fetch`. Provide a stub in tests or a
   * filesystem-backed fetcher in Node environments without fetch.
   */
  extendsFetcher?: ExtendsFetcher;

  /**
   * UniProt accession supplied by the mounting code (for
   * `<protvista-uniprot>`, this is the `accession` HTML attribute).
   *
   * The default config is a template: its URLs and label URLs carry
   * `{accession}` placeholders that the element resolves at fetch
   * time. The `missing-accession` validator rule refuses to accept
   * such a template without a declared accession — this option lets
   * the caller answer "an accession *will* be supplied at runtime,
   * here it is" without mutating the template itself.
   *
   * When set, and the parsed config does not already declare its own
   * `accession`, `loadConfig` injects this value into the config
   * before validation runs. A config that already carries an
   * accession is left untouched (authors opt in to per-config
   * accessions, and the HTML attribute must not silently override
   * them).
   */
  accession?: string;
}

/**
 * Parse, validate, and normalize a ProtVista viewer config.
 *
 * Accepts three input forms:
 *
 *   - An **object** — skips the parse step and runs straight into
 *     validation. Use this form when you already have a JSON module
 *     in hand (e.g. `import config from './config.json'`).
 *   - A **JSON string** — parsed via `JSON.parse`.
 *   - A **YAML string** — parsed via `js-yaml` (lazy-loaded).
 *
 * @throws `SyntaxError` if the string cannot be parsed.
 * @throws `ConfigValidationError` if the parsed object does not
 *   validate. The error carries a full `issues[]` array.
 */
export async function loadConfig(
  input: unknown,
  opts: LoadConfigOptions = {}
): Promise<NormalizedConfig> {
  return (await loadConfigWithSource(input, opts)).config;
}

/**
 * The result of `loadConfigWithSource`: the normalized config the renderer
 * consumes, paired with the authored object it came from.
 */
export interface LoadedConfig {
  config: NormalizedConfig;
  /**
   * The validated authored config, after `extends` resolution and accession
   * injection but *before* normalization — so it still reads the way an
   * author would write it, without the resolved rendering cascade, the
   * synthetic standalone wrappers, or the filled-in labels.
   *
   * The viewer keeps this as the baseline for `getConfig()`, so a config
   * exported after the user rearranges the layout stays close to the input
   * rather than ballooning into a fully-explicit dump.
   */
  authored: ProtvistaViewerConfig;
}

/**
 * `loadConfig`, but also returning the authored config the normalized one was
 * derived from. Separate entry point so the common case keeps the simpler
 * return type and only the viewer (which needs to export edited configs)
 * pays attention to the source object.
 */
export async function loadConfigWithSource(
  input: unknown,
  opts: LoadConfigOptions = {}
): Promise<LoadedConfig> {
  const registry = opts.registry ?? createRegistry();

  const parsed = await parseInput(input, opts.format ?? 'auto');

  // `extends` resolution runs BETWEEN parse and validate so partial
  // child configs (e.g. `extends: "./base-config.yaml"` plus one
  // tiny override) merge against their bases before the required-
  // fields check fires. `mergeExtends` is a no-op (sans the
  // unconditional strip of `extends`) for configs that don't use the
  // feature, so JSON-only adopters pay nothing extra for its
  // presence in the pipeline.
  const merged = await resolveExtends(parsed, opts);

  // Inject the caller-supplied accession *before* validation so the
  // `missing-accession` rule sees it. We only inject when the config
  // doesn't already declare one — otherwise an HTML-attribute
  // accession would silently override an accession the author
  // deliberately hard-coded, which would be more surprising than
  // helpful.
  const withAccession = injectAccession(merged, opts.accession);

  const result = validateConfig(withAccession, registry);
  if (!result.valid) {
    throw new ConfigValidationError(result.issues);
  }
  // `validateConfig` has proven `withAccession` conforms to the
  // schema, so the cast below is sound. TypeScript's inability to
  // narrow from `ValidationResult` to the config type is expected.
  const authored = withAccession as ProtvistaViewerConfig;
  return { config: normalizeConfig(authored, { registry }), authored };
}

/**
 * Return a shallow clone of `parsed` with `accession` set, when the
 * caller supplied one and the config didn't already declare its own.
 * Non-object inputs pass through unchanged; the validator will
 * surface a readable schema error for them.
 */
function injectAccession(parsed: unknown, accession: string | undefined) {
  if (accession === undefined) return parsed;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return parsed;
  }
  const cfg = parsed as ProtvistaViewerConfig;
  if (cfg.accession !== undefined) return parsed;
  return { ...cfg, accession };
}

async function resolveExtends(
  parsed: unknown,
  opts: LoadConfigOptions
): Promise<unknown> {
  // Non-object inputs (null, array, primitive) skip the merger; the
  // validator will reject them with a readable schema error.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return parsed;
  }
  const cfg = parsed as ProtvistaViewerConfig;
  if (cfg.extends === undefined) return cfg;
  return mergeExtends(cfg, {
    resolver: opts.extendsResolver,
    fetcher: opts.extendsFetcher,
  });
}

// ─────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────

async function parseInput(
  input: unknown,
  format: ParseFormat
): Promise<unknown> {
  // Object input — nothing to parse.
  if (input !== null && typeof input === 'object') {
    return input;
  }

  if (typeof input !== 'string') {
    throw new TypeError(
      `loadConfig expects an object, JSON string, or YAML string; received ${typeof input}.`
    );
  }

  return parseConfigText(input, format);
}
