/**
 * `extends` chain resolver & merger.
 *
 * Merge semantics:
 *
 *   - `sources`    — merged by key (child wins)
 *   - `defaults`   — merged field-wise (child wins); `rendering`
 *                    nested sub-object also merged field-wise
 *   - `rows`       — top-level entries (groups AND standalone tracks,
 *                    one shared id namespace) matched by `id`; known
 *                    ids extended in place, new ids appended at the end
 *                    (base order preserved, child-only entries appended
 *                    in declaration order). Shape is read from a child's
 *                    own keys: a child that *positively asserts* the
 *                    other shape (a `tracks:` block over a base track, or
 *                    a `data:` track over a base group) replaces the base
 *                    entry wholesale — child wins, no field merge. A
 *                    child that asserts neither (a scalar-only override)
 *                    inherits the base's shape and field-merges, so the
 *                    base `tracks:` / `data:` it omits survive.
 *   - `tracks`     — within a merged group, matched by `id`;
 *                    same rules as rows
 *   - `rendering`  — field-wise (at every level); `colorScale`
 *                    nested sub-object also field-wise
 *   - Scalar fields (`accession`, `version`, `$schema`, `label`,
 *     `component`, `kind`, `data`, …) — child wins.
 *
 *
 * ## Resolver strategy — namespace-decision friendly
 *
 * The namespace for shipped presets is still an open decision. The
 * merger is designed to make that decision pluggable rather than
 * baked in:
 *
 *   - A caller-supplied `resolver` (a function or a
 *     `Record<string, …>`) is consulted FIRST for every name in
 *     `extends`. This is the hook for a future preset registry —
 *     whether it lands as `@ebi/…` npm packages, a baked-in name map,
 *     or something else, the merger does not care.
 *
 *   - Names that the resolver declines to produce fall back to a
 *     URL / file-path fetcher. Anything matching `http(s)://` or
 *     `/ ./ ../` is fetched as text and parsed (JSON or YAML) via
 *     the shared `parseConfigText` helper.
 *
 *   - Anything the resolver declines AND that does not look like a
 *     URL / file path is a hard failure: `cannot-resolve-extends`.
 *
 * This layering lets us ship `mergeExtends` today and wire the
 * preset registry in later without a breaking API change.
 *
 *
 * ## Cycle detection
 *
 * Chain membership is tracked by the literal string used in
 * `extends` (URL / path / preset name). Cycles fail fast with
 * `ConfigValidationError` code `circular-extends` and a stable
 * message of the form `"Circular extends: a → b → a"` so the
 * diagnostic names every link in the loop in the order the resolver
 * walked them.
 *
 *
 * ## Output
 *
 * Returns a plain `ProtvistaViewerConfig` with `extends` stripped
 * (it has no semantics post-merge; leaving it would confuse
 * downstream validation and normalize steps). The merged value is
 * the authoring shape, NOT `NormalizedConfig` — call `normalizeConfig`
 * afterwards to expand shorthand `data:` forms, cascade defaults,
 * etc.
 *
 *
 * ## Trust boundary
 *
 * `extends` values are fetched and evaluated as config. Downstream, a
 * config can drive every visible track, set tooltip markup, and
 * point URLs at arbitrary origins. Treat every `extends` target as
 * trusted on the same level as the root config.
 *
 *   - The default fetcher only runs for literals that look like URLs
 *     or file paths (`isUrlOrPath` — `http(s)://…`, `/…`, `./…`,
 *     `../…`). Bare preset names (any string that doesn't match that
 *     shape — e.g. `@my-org/base-config`) only resolve through an
 *     `opts.resolver` the embedder supplies, so there is no way for
 *     an author to inject a URL fetch via a surprise preset.
 *   - The default fetcher enforces a 2 MiB ceiling on response
 *     bodies (`MAX_EXTENDS_BYTES` below) to cap the worst case for
 *     an attacker-controlled server. Adopters who need larger
 *     configs pass their own `opts.fetcher` and own the size policy.
 *   - YAML is parsed with the `SAFE` schema (cf. `parse.ts`), so
 *     `!!js/function`-style tags that would construct arbitrary JS
 *     objects are rejected. Author-facing failure mode is a parse
 *     error, same as malformed JSON.
 *
 * Adopters who expose `mergeExtends` to user-supplied URLs
 * (dashboarding tools, admin UIs, …) should wrap it in their own
 * allow-list of target origins before handing URLs to it.
 */

import type {
  ProtvistaViewerConfig,
  GroupConfig,
  TrackConfig,
  TopLevelEntry,
  RenderingOptions,
  ColorScaleConfig,
  ConfigDefaults,
} from './types';
import { isGroupConfig } from './discriminate';
import { ConfigValidationError } from './errors';
import { parseConfigText } from './parse';

// ─────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────

/**
 * Caller-supplied preset resolver. Receives a raw `extends` name
 * (e.g. `"@my-org/base-config"`) and returns either:
 *
 *   - the parsed config object,
 *   - the raw config text (JSON or YAML; the merger re-parses it), or
 *   - `undefined` to decline — in which case the merger falls back
 *     to URL / file-path fetching.
 *
 * May be sync or async.
 */
export type ExtendsResolver = (
  name: string
) =>
  | ProtvistaViewerConfig
  | string
  | undefined
  | Promise<ProtvistaViewerConfig | string | undefined>;

/**
 * Caller-supplied URL / file fetcher. Defaults to `globalThis.fetch`.
 * Returns the raw response body as text.
 */
export type ExtendsFetcher = (url: string) => Promise<string>;

export interface MergeExtendsOptions {
  /**
   * Preset resolver. Accept either a function (for dynamic resolution)
   * or a plain object keyed by preset name (for the common "here's my
   * fixed table of bases" case — used heavily in tests).
   */
  resolver?:
    | ExtendsResolver
    | Record<string, ProtvistaViewerConfig | string>;

  /**
   * URL / file fetcher. Called for every `extends` entry that the
   * resolver does not handle and that looks like a URL or file path.
   * Defaults to `globalThis.fetch` if available.
   */
  fetcher?: ExtendsFetcher;
}

/**
 * Resolve every `extends` reference reachable from `config` and
 * return a single merged `ProtvistaViewerConfig`.
 *
 * A config with no `extends` is returned unchanged (modulo the
 * unconditional strip of the `extends` key, which never appears on
 * output).
 *
 * @throws `ConfigValidationError` with code `circular-extends` if a
 *   cycle is detected, or `cannot-resolve-extends` if a name cannot
 *   be resolved.
 */
export async function mergeExtends(
  config: ProtvistaViewerConfig,
  opts: MergeExtendsOptions = {}
): Promise<ProtvistaViewerConfig> {
  const ctx: InternalCtx = {
    resolver: normalizeResolver(opts.resolver),
    fetcher: opts.fetcher ?? defaultFetcher,
  };
  return resolveAndMerge(config, ctx, []);
}

// ─────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────

interface InternalCtx {
  resolver?: ExtendsResolver;
  fetcher: ExtendsFetcher;
}

function normalizeResolver(
  r: MergeExtendsOptions['resolver']
): ExtendsResolver | undefined {
  if (!r) return undefined;
  if (typeof r === 'function') return r;
  // Record form — wrap in a lookup function. Unknown keys return
  // undefined and the merger falls through to URL/file resolution.
  return (name: string) => r[name];
}

/**
 * Maximum size (in bytes, post-UTF-8 encoding) that the default
 * fetcher will accept from an `extends` target. Real-world shipped
 * configs sit well under 200 KiB; 2 MiB is a loose-but-bounded
 * ceiling that refuses obviously-hostile payloads (e.g. a server
 * streaming a multi-gigabyte response that the parser would
 * nevertheless try to hold in memory) while leaving room for
 * comment-heavy authoring styles.
 *
 * This only applies to the built-in fetcher; adopters who supply
 * their own `fetcher` are on the hook for their own size discipline.
 */
const MAX_EXTENDS_BYTES = 2 * 1024 * 1024;

async function defaultFetcher(url: string): Promise<string> {
  const fetchImpl = (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error(
      `mergeExtends: no fetch implementation available to retrieve '${url}'. Pass opts.fetcher or run in an environment with global fetch.`
    );
  }
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(
      `mergeExtends: fetch failed for '${url}': HTTP ${res.status} ${res.statusText}.`
    );
  }
  // Cheap upper-bound check before we spool the body into memory.
  // `Content-Length` is advisory (a malicious server can lie) but
  // rejecting the obviously-oversized case here avoids buffering a
  // multi-gigabyte response just to throw afterwards.
  const declared = Number(res.headers?.get?.('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_EXTENDS_BYTES) {
    throw new Error(
      `mergeExtends: '${url}' declared Content-Length ${declared} bytes exceeds the ${MAX_EXTENDS_BYTES}-byte ceiling.`
    );
  }
  const text = await res.text();
  // Post-decode guard. UTF-8 re-expansion can inflate byte counts, so
  // we measure the decoded string against the same ceiling.
  if (text.length > MAX_EXTENDS_BYTES) {
    throw new Error(
      `mergeExtends: '${url}' response body is ${text.length} bytes, exceeding the ${MAX_EXTENDS_BYTES}-byte ceiling. Supply an explicit opts.fetcher to opt in to larger configs.`
    );
  }
  return text;
}

/**
 * Resolve `cfg.extends` (if any) and merge parents into self.
 * The `chain` parameter carries every extends name currently being
 * resolved up the recursion stack so we can detect cycles.
 */
async function resolveAndMerge(
  rawCfg: ProtvistaViewerConfig,
  ctx: InternalCtx,
  chain: string[]
): Promise<ProtvistaViewerConfig> {
  const cfg = rawCfg;

  // The output never carries an `extends` field — it has already
  // been consumed by the time we return.
  const { extends: ext, ...selfBody } = cfg;
  const self = selfBody as ProtvistaViewerConfig;

  if (ext === undefined) return self;

  const parents = Array.isArray(ext) ? ext : [ext];

  // Left-to-right: build a merged base by applying parents in
  // declaration order, each one overriding the previous. Then apply
  // `self` on top.
  let accum: ProtvistaViewerConfig = emptyConfig();
  for (const name of parents) {
    const resolved = await resolveParent(name, ctx, chain);
    accum = merge(accum, resolved);
  }
  return merge(accum, self);
}

async function resolveParent(
  name: string,
  ctx: InternalCtx,
  chain: string[]
): Promise<ProtvistaViewerConfig> {
  // Cycle detection. `chain` is the stack of extends names currently
  // being resolved from root downward; if `name` is already in it we
  // have a loop. The message names every link in the cycle in walk
  // order so the author can see the full path.
  if (chain.includes(name)) {
    const loop = [...chain.slice(chain.indexOf(name)), name].join(' → ');
    throw new ConfigValidationError([
      {
        path: '/extends',
        message: `Circular extends: ${loop}`,
        code: 'circular-extends',
      },
    ]);
  }

  // Consult the caller's resolver first. A preset registry, if
  // wired, gets last-word authority on names it claims; URL/file
  // targets fall through to the fetcher below.
  let produced: ProtvistaViewerConfig | string | undefined;
  if (ctx.resolver) {
    produced = await ctx.resolver(name);
  }

  if (produced === undefined) {
    if (isUrlOrPath(name)) {
      produced = await ctx.fetcher(name);
    }
  }

  if (produced === undefined) {
    throw new ConfigValidationError([
      {
        path: '/extends',
        message: `Cannot resolve extends: '${name}'. No resolver produced a config and the name is not a URL or file path.`,
        code: 'cannot-resolve-extends',
      },
    ]);
  }

  // Parse fetched text. Re-wrap `parseConfigText`'s error so a failure
  // deep in an `extends:` chain names *which* target was malformed —
  // the underlying JSON/YAML SyntaxError only carries line/column, not
  // file identity, and debugging a three-deep inheritance chain with a
  // bare "Unexpected token" is genuinely painful.
  let resolved: ProtvistaViewerConfig;
  if (typeof produced === 'string') {
    try {
      resolved = (await parseConfigText(produced)) as ProtvistaViewerConfig;
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new ConfigValidationError([
        {
          path: '/extends',
          message: `Failed to parse extends target '${name}': ${cause}`,
          code: 'extends-parse-error',
        },
      ]);
    }
  } else {
    resolved = produced;
  }

  // Recurse into the resolved config's own `extends` (if any),
  // extending `chain` with the current name so a cycle through this
  // layer is detected on the next `resolveParent` call.
  return resolveAndMerge(resolved, ctx, [...chain, name]);
}

function isUrlOrPath(s: string): boolean {
  return (
    /^https?:\/\//i.test(s) ||
    s.startsWith('/') ||
    s.startsWith('./') ||
    s.startsWith('../')
  );
}

function emptyConfig(): ProtvistaViewerConfig {
  // `rows` is required on the authoring type, but pre-merge the
  // accumulator is genuinely empty. We satisfy the type with `[]` and
  // let subsequent merges fill it in.
  return { rows: [] };
}

// ─────────────────────────────────────────────────────────────
// Merge rules (pure — no I/O)
// ─────────────────────────────────────────────────────────────

/**
 * Merge two authoring configs. `child` overrides `base` per the
 * documented rules.
 */
function merge(
  base: ProtvistaViewerConfig,
  child: ProtvistaViewerConfig
): ProtvistaViewerConfig {
  const out: ProtvistaViewerConfig = { ...base, ...child };

  // `sources` is a dictionary; merge by key.
  if (base.sources !== undefined || child.sources !== undefined) {
    out.sources = { ...base.sources, ...child.sources };
  }

  // `defaults` is a nested object; merge its fields (and any
  // sub-objects like `rendering`) field-wise.
  if (base.defaults !== undefined || child.defaults !== undefined) {
    out.defaults = mergeDefaults(base.defaults, child.defaults);
  }

  // `theme` is a flat object of colour fields; merge field-wise (child
  // wins per key) so a child can tweak one colour without dropping the
  // base's others — matching the `defaults`/`sources` merge semantics.
  if (base.theme !== undefined || child.theme !== undefined) {
    out.theme = { ...base.theme, ...child.theme };
  }

  // `rows` is an ordered list keyed by `id` (one namespace across
  // groups and standalone tracks). `{ ...base, ...child }` above
  // clobbers base.rows with child.rows, so we always recompute here.
  // Both sides are alias-free by now (`resolveAndMerge`), so there is
  // no `groups` key left to reconcile.
  out.rows = mergeEntriesById(base.rows ?? [], child.rows ?? []);

  return out;
}

function mergeDefaults(
  b: ConfigDefaults | undefined,
  c: ConfigDefaults | undefined
): ConfigDefaults {
  const out: ConfigDefaults = { ...b, ...c };
  if (b?.rendering !== undefined || c?.rendering !== undefined) {
    out.rendering = mergeRendering(b?.rendering, c?.rendering);
  }
  return out;
}

function mergeRendering(
  b: RenderingOptions | undefined,
  c: RenderingOptions | undefined
): RenderingOptions {
  const out: RenderingOptions = { ...b, ...c };
  if (b?.colorScale !== undefined || c?.colorScale !== undefined) {
    out.colorScale = mergeColorScale(b?.colorScale, c?.colorScale);
  }
  return out;
}

function mergeColorScale(
  b: ColorScaleConfig | undefined,
  c: ColorScaleConfig | undefined
): ColorScaleConfig {
  return { ...b, ...c };
}

/**
 * Merge row lists by `id` (groups and standalone tracks share one
 * namespace). Base order is preserved; entries whose `id` also appears
 * in `child` are merged in place via `mergeEntry`; entries in `child`
 * with a new `id` are appended at the end in child's order.
 */
function mergeEntriesById(
  base: TopLevelEntry[],
  child: TopLevelEntry[]
): TopLevelEntry[] {
  const result = base.map((e) => e);
  for (const childEntry of child) {
    const idx = result.findIndex((baseEntry) => baseEntry.id === childEntry.id);
    if (idx === -1) {
      result.push(childEntry);
      continue;
    }
    result[idx] = mergeEntry(result[idx], childEntry);
  }
  return result;
}

/**
 * Merge one child entry onto the same-id base entry.
 *
 * Shape is read from POSITIVE evidence, never from absence:
 *
 *   - child has `tracks:`              → asserts a group
 *   - child has `data:` (no `tracks:`) → asserts a standalone track
 *   - child has neither                → shape-silent partial override:
 *       inherit the base's shape and field-merge. This is how a child
 *       overrides a group's scalar field (`label`, `component`, …)
 *       without restating its `tracks:` — the base tracks must survive.
 *
 * A child that positively asserts the OTHER shape than the base is a
 * deliberate flip: child wins wholesale, so no field merge smuggles a
 * stale `tracks:` array or group `component` onto the wrong shape.
 * Same-shape and shape-silent both field-merge via `mergeGroup` /
 * `mergeTrack`, which preserve the base `tracks` / `data` the child
 * omits.
 *
 * Discriminating shape from the mere *absence* of `tracks:` — the
 * earlier behaviour — wrongly classified a `tracks:`-less group override
 * as a standalone track and dropped the base group's tracks.
 */
function mergeEntry(base: TopLevelEntry, child: TopLevelEntry): TopLevelEntry {
  const childAssertsGroup = 'tracks' in child;
  const childAssertsTrack = 'data' in child && !('tracks' in child);

  // Deliberate shape flip: child positively declares the other shape.
  if (childAssertsGroup && !isGroupConfig(base)) return child;
  if (childAssertsTrack && isGroupConfig(base)) return child;

  // Same shape, or a shape-silent partial override → field-merge onto
  // the base's existing shape.
  return isGroupConfig(base)
    ? mergeGroup(base, child as GroupConfig)
    : mergeTrack(base, child as TrackConfig);
}

function mergeGroup(
  base: GroupConfig,
  child: GroupConfig
): GroupConfig {
  const out: GroupConfig = { ...base, ...child };
  if (base.rendering !== undefined || child.rendering !== undefined) {
    out.rendering = mergeRendering(base.rendering, child.rendering);
  }
  out.tracks = mergeTracksById(base.tracks ?? [], child.tracks ?? []);
  return out;
}

function mergeTracksById(
  base: TrackConfig[],
  child: TrackConfig[]
): TrackConfig[] {
  const result = base.map((t) => t);
  for (const ct of child) {
    const idx = result.findIndex((bt) => bt.id === ct.id);
    if (idx === -1) {
      result.push(ct);
    } else {
      result[idx] = mergeTrack(result[idx], ct);
    }
  }
  return result;
}

function mergeTrack(base: TrackConfig, child: TrackConfig): TrackConfig {
  const out: TrackConfig = { ...base, ...child };
  if (base.rendering !== undefined || child.rendering !== undefined) {
    out.rendering = mergeRendering(base.rendering, child.rendering);
  }
  return out;
}
