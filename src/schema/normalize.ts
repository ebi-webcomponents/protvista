/**
 * ProtVista config normalize / expand pipeline.
 *
 * Canonicalises a parsed-and-merged `ProtvistaViewerConfig` into a
 * uniform shape the loader can hand straight to the
 * rendering layer. Runs between `mergeExtends` and the
 * Ajv-based validator.
 *
 * What normalize does:
 *
 *   1. Expands the four `data` shorthand forms into a
 *      `NormalizedDataSource[]`. Runtime code never has to branch on
 *      "is this a string / object / array?" again.
 *   2. Resolves string-shorthand data rules (sources key, file path,
 *      http(s) URL, extension-based adapter inference) per the table
 *      in `TrackConfig.data`.
 *   3. Fills in defaults for `from` (`"url"` when omitted, `"inline"`
 *      when `inlineData` is present).
 *   4. Resolves semantic kinds via the registry into (component,
 *      adapter, rendering preset) and folds the preset into the
 *      track's rendering chain.
 *   5. Cascades rendering / labelUrl / helpPage inheritance so the
 *      loader sees fully-resolved per-track blocks (no walking of
 *      defaults → group → track at render time):
 *
 *         track.rendering > group.rendering > defaults.rendering
 *         track.labelUrl  > defaults.labelUrl
 *         track.helpPage  > group.helpPage  > defaults.helpPage
 *
 *   6. Infers group `component` from child-track `component`s when
 *      omitted (all-same → that component; mixed →
 *      `nightingale-track-canvas`), per specs/config-approach.md §Behavior.
 *   7. Applies the title-cased `id` → `label` fallback for both
 *      groups and tracks.
 *   8. Detects duplicate group / track ids and throws.
 *   9. Resolves `source:` references to concrete `url:` strings via
 *      the root `sources` map, leaving the `source:` field in place
 *      for downstream introspection (validator error messages).
 *
 * What normalize does NOT do (delegated to the validator):
 *
 *   - Shape-check the input (assumes Ajv-valid on the normal load
 *     path; defensive enough for tests that pass object literals).
 *   - Resolve `{accession}` placeholders. That's fetch-time work in
 *     the loader, because the HTML attribute can override the config
 *     value after normalize has already run.
 *   - Surface "Unknown source key" / "Unknown semantic kind" /
 *     "Cannot infer adapter for './x.gff'" errors. Those live in the
 *     validator so that the same error messages are raised for
 *     both raw and programmatically-constructed configs. Normalize is
 *     deliberately non-throwing for unknowns and returns a best-
 *     effort output — callers that skip the validator are responsible
 *     for their own unknown-name handling.
 */

import type {
  ProtvistaViewerConfig,
  GroupConfig,
  TrackConfig,
  DataSourceDescriptor,
  RenderingOptions,
  ComponentName,
  AdapterName,
  AuthoredTooltipSpec,
} from './types';
import type { Registry } from './registry';

// ─────────────────────────────────────────────────────────────
// Output types — the canonical shape the loader consumes
// ─────────────────────────────────────────────────────────────

/**
 * Fully-resolved config. The only fields kept optional are those that
 * are semantically optional at runtime (e.g. `accession` — absent in
 * configs not yet bound to a specific protein; `helpPage` — absent
 * when no help link is wanted).
 */
export interface NormalizedConfig {
  version: '1.0';
  accession?: string;
  sources: Record<string, string>;
  defaults: NormalizedDefaults;
  groups: NormalizedGroup[];
}

export interface NormalizedDefaults {
  /** Always present (at minimum: `{}`). Renderers can spread it safely. */
  rendering: RenderingOptions;
  labelUrl?: string;
  helpPage?: string;
}

export interface NormalizedGroup {
  id: string;
  /** Always present after normalize — `titleCaseId(id)` if omitted. */
  label: string;
  /** Short plain-text description; rendered as `title=` on the group label. */
  description?: string;
  /** Always resolved — inferred from children if omitted, else canvas. */
  component: ComponentName;
  /** Resolved cascade: defaults → group. */
  rendering: RenderingOptions;
  helpPage?: string;
  tracks: NormalizedTrack[];
}

export interface NormalizedTrack {
  id: string;
  label: string;
  labelUrl?: string;
  /** Preserved verbatim so the validator + loader can use it. */
  kind?: string;
  /** Resolved: track.component > kind.component > parent.component > canvas. */
  component: ComponentName;
  /** Always an array after normalize — even when the author wrote a single object. */
  data: NormalizedDataSource[];
  description?: string;
  /**
   * Always the expanded `AuthoredTooltipSpec` form after normalize — a
   * bare-string author value becomes `{ kind: 'markdown', template: <str> }`.
   * Downstream runtime code can dispatch on `kind` without branching on
   * `typeof dataTooltip === 'string'`.
   */
  dataTooltip?: AuthoredTooltipSpec;
  filter?: string;
  filterUI?: 'nightingale-filter';
  /** Resolved cascade: defaults → group → kind preset → track. */
  rendering: RenderingOptions;
  helpPage?: string;
}

/**
 * Normalised data descriptor. Identical in field names to
 * `DataSourceDescriptor` so existing fetch helpers that accept the
 * input type keep working — but with stronger guarantees:
 *
 *   - `from` is always present.
 *   - `source` references have already been looked up and the
 *     corresponding `url` populated.
 *   - `adapter` has had extension-based and kind-based inference
 *     applied (still `undefined` if neither yielded a match — the
 *     validator surfaces that to the author).
 */
export interface NormalizedDataSource {
  from: 'url' | 'inline' | 'file' | 'custom';
  source?: string | string[];
  url?: string | string[];
  inlineData?: unknown;
  adapter?: AdapterName;
}

// ─────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────

export interface NormalizeOptions {
  /**
   * Optional registry. When supplied, semantic `kind` values are
   * resolved into (component, adapter, rendering preset) tuples and
   * folded into each track's resolved shape. Without a registry,
   * tracks keep their `kind` verbatim and `component` / `adapter` are
   * inferred from whatever explicit fields the author supplied plus
   * the group `component` / extension-based adapter rules. This
   * keeps `normalize()` callable from unit tests that exercise
   * shorthand expansion or inheritance without setting up a full
   * registry.
   */
  registry?: Registry;
}

export function normalizeConfig(
  config: ProtvistaViewerConfig,
  opts: NormalizeOptions = {}
): NormalizedConfig {
  const { registry } = opts;
  const sources = config.sources ?? {};

  const defaults: NormalizedDefaults = {
    rendering: { ...(config.defaults?.rendering ?? {}) },
    ...(config.defaults?.labelUrl !== undefined
      ? { labelUrl: config.defaults.labelUrl }
      : {}),
    ...(config.defaults?.helpPage !== undefined
      ? { helpPage: config.defaults.helpPage }
      : {}),
  };

  // Duplicate group-id detection BEFORE we recurse so errors refer
  // to the offending id and not a downstream symptom.
  assertUniqueIds(
    config.groups.map((c) => c.id),
    (id) => `Duplicate group id '${id}'.`
  );

  const groups = config.groups.map((c) =>
    normalizeGroup(c, defaults, sources, registry)
  );

  return {
    version: config.version ?? '1.0',
    ...(config.accession !== undefined ? { accession: config.accession } : {}),
    sources,
    defaults,
    groups,
  };
}

// ─────────────────────────────────────────────────────────────
// Group
// ─────────────────────────────────────────────────────────────

function normalizeGroup(
  c: GroupConfig,
  defaults: NormalizedDefaults,
  sources: Record<string, string>,
  registry: Registry | undefined
): NormalizedGroup {
  assertUniqueIds(
    c.tracks.map((t) => t.id),
    (id) => `Duplicate track id '${id}' in group '${c.id}'.`
  );

  // Group rendering = defaults → group. Tracks then layer on
  // top of this in normalizeTrack.
  const groupRendering: RenderingOptions = {
    ...defaults.rendering,
    ...(c.rendering ?? {}),
  };

  const tracks = c.tracks.map((t) =>
    normalizeTrack(t, c, groupRendering, defaults, sources, registry)
  );

  // Group component inference. Explicit wins; otherwise look at
  // the child tracks' resolved components — if they all agree, use
  // that; if they diverge, fall back to the generic canvas track
  // (which can render mixed content).
  let component: ComponentName;
  if (c.component) {
    component = c.component;
  } else if (tracks.length > 0) {
    const childComponents = new Set(tracks.map((t) => t.component));
    if (childComponents.size === 1) {
      // Iterator#next is the only way to pull the single value out
      // without casting through an array.
      component = childComponents.values().next().value as ComponentName;
    } else {
      component = 'nightingale-track-canvas';
    }
  } else {
    // Zero-track group — validator emits a warning and hides
    // the group. Pick a sensible default so nothing downstream
    // blows up if it is rendered anyway.
    component = 'nightingale-track-canvas';
  }

  const helpPage = c.helpPage ?? defaults.helpPage;

  return {
    id: c.id,
    label: c.label ?? titleCaseId(c.id),
    ...(c.description !== undefined ? { description: c.description } : {}),
    component,
    rendering: groupRendering,
    ...(helpPage !== undefined ? { helpPage } : {}),
    tracks,
  };
}

// ─────────────────────────────────────────────────────────────
// Track
// ─────────────────────────────────────────────────────────────

function normalizeTrack(
  t: TrackConfig,
  parent: GroupConfig,
  parentRendering: RenderingOptions,
  defaults: NormalizedDefaults,
  sources: Record<string, string>,
  registry: Registry | undefined
): NormalizedTrack {
  // Resolve the semantic kind (if any, and if the registry knows it)
  // into its canonical (component, adapter, rendering) tuple. Tracks
  // with an unrecognised kind keep going through the pipeline — the
  // validator surfaces the error later with a full list of valid
  // kinds.
  const kindDef = t.kind ? registry?.getSemanticKind(t.kind) : undefined;

  // Rendering cascade: defaults → group → kind preset → track.
  // Kind sits BETWEEN group and track so that (a) a canvas-track
  // group inheriting `color: red` still lets the kind override
  // that for a `confidence-score` track (kind-canonical ramp wins
  // over group red), while (b) the track author can still put an
  // explicit override on top of a kind preset. Matches specs/config-approach.md
  // "Defaults are canonical".
  const rendering: RenderingOptions = {
    ...parentRendering,
    ...(kindDef?.rendering ?? {}),
    ...(t.rendering ?? {}),
  };

  // Component resolution precedence:
  //   1. Explicit on the track (escape hatch)
  //   2. Kind's canonical component (author used `kind:`)
  //   3. Parent group's explicit `component` (legacy authoring
  //      style — one canvas row per group with sub-tracks)
  //   4. `nightingale-track-canvas` — works for the vast majority of
  //      feature-style tracks.
  const component: ComponentName =
    t.component ??
    kindDef?.component ??
    parent.component ??
    'nightingale-track-canvas';

  const data = expandData(t, kindDef?.adapter, sources);

  const labelUrl = t.labelUrl ?? defaults.labelUrl;
  const helpPage = t.helpPage ?? parent.helpPage ?? defaults.helpPage;

  return {
    id: t.id,
    label: t.label ?? titleCaseId(t.id),
    ...(labelUrl !== undefined ? { labelUrl } : {}),
    ...(t.kind !== undefined ? { kind: t.kind } : {}),
    component,
    data,
    ...(t.description !== undefined ? { description: t.description } : {}),
    ...(t.dataTooltip !== undefined
      ? { dataTooltip: expandDataTooltip(t.dataTooltip) }
      : {}),
    ...(t.filter !== undefined ? { filter: t.filter } : {}),
    ...(t.filterUI !== undefined ? { filterUI: t.filterUI } : {}),
    rendering,
    ...(helpPage !== undefined ? { helpPage } : {}),
  };
}

// ─────────────────────────────────────────────────────────────
// Data-tooltip shorthand expansion
// ─────────────────────────────────────────────────────────────

/**
 * Canonicalise the three authoring forms of `dataTooltip` into a single
 * `AuthoredTooltipSpec`. The bare-string shorthand is promoted to a
 * Markdoc template spec; the two object forms pass through unchanged.
 *
 * Downstream code (the tooltip resolver) can dispatch purely on
 * `spec.kind` without re-checking `typeof`.
 */
function expandDataTooltip(
  raw: string | AuthoredTooltipSpec
): AuthoredTooltipSpec {
  if (typeof raw === 'string') {
    return { kind: 'markdown', template: raw };
  }
  return raw;
}

// ─────────────────────────────────────────────────────────────
// Data descriptor expansion
// ─────────────────────────────────────────────────────────────

function expandData(
  t: TrackConfig,
  kindAdapter: AdapterName | undefined,
  sources: Record<string, string>
): NormalizedDataSource[] {
  const raw = t.data;

  // Step 1: unify the four input shapes into a DataSourceDescriptor[].
  // We still tag string entries with a marker so the shorthand rules
  // can run on them below — resolving them here mixes two concerns
  // (array-wrapping and string-shorthand) and makes the inner
  // function harder to read.
  let descriptors: DataSourceDescriptor[];
  if (typeof raw === 'string') {
    descriptors = [resolveStringShorthand(raw, sources)];
  } else if (Array.isArray(raw)) {
    descriptors = raw.map((d) =>
      typeof d === 'string' ? resolveStringShorthand(d, sources) : d
    );
  } else {
    descriptors = [raw];
  }

  // Step 2: expand each descriptor (adapter inference, `from`
  // default, source → url resolution).
  return descriptors.map((d) => expandDescriptor(d, kindAdapter, sources));
}

/**
 * Resolve a string-shorthand `data:` entry into a
 * `DataSourceDescriptor`, following the order documented on
 * `TrackConfig.data`.
 *
 * Note: this function is deliberately non-throwing. An unknown value
 * (neither a sources key, URL, path, nor a known extension) still
 * yields a descriptor — the validator is responsible for
 * surfacing "Unknown source key: '<value>' ..." with the known-keys
 * list so that the author sees one clean error message rather than a
 * stack of internal-looking ones.
 */
function resolveStringShorthand(
  value: string,
  sources: Record<string, string>
): DataSourceDescriptor {
  // 1. Matches a key in the `sources` map → from: url, source: <value>.
  if (Object.prototype.hasOwnProperty.call(sources, value)) {
    return { from: 'url', source: value };
  }
  // 2. http(s) URL → from: url, url: <value>.
  if (/^https?:\/\//i.test(value)) {
    return { from: 'url', url: value };
  }
  // 3. Starts with / or ./ → from: file, url: <value>, adapter via
  //    extension inference (best effort).
  if (value.startsWith('/') || value.startsWith('./')) {
    const adapter = inferAdapterFromExtension(value);
    return adapter
      ? { from: 'file', url: value, adapter }
      : { from: 'file', url: value };
  }
  // 4. Bare filename with a known extension (no prefix) — treat as a
  //    relative file path. This mirrors steps 4–7 of the spec table,
  //    which all resolve to `from: file` with an extension-inferred
  //    adapter.
  const ext = inferAdapterFromExtension(value);
  if (ext) {
    return { from: 'file', url: value, adapter: ext };
  }
  // 5. Fell off the end. Best-effort: assume the author intended a
  //    sources-key reference. The validator surfaces
  //    "Unknown source key: '<value>' in track <groupId>/<trackId>.
  //    Known sources: ..." with the registered keys listed — a far
  //    better error than any the engine could produce here.
  return { from: 'url', source: value };
}

function inferAdapterFromExtension(path: string): AdapterName | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith('.csv')) return 'features-csv';
  if (lower.endsWith('.tsv')) return 'features-tsv';
  if (lower.endsWith('.json')) return 'features-json';
  if (lower.endsWith('.bed')) return 'bed';
  return undefined;
}

function expandDescriptor(
  d: DataSourceDescriptor,
  kindAdapter: AdapterName | undefined,
  sources: Record<string, string>
): NormalizedDataSource {
  // Default `from` per the spec: `"inline"` if `inlineData` is set,
  // otherwise `"url"` (the most common case).
  const from: NormalizedDataSource['from'] =
    d.from ?? (d.inlineData !== undefined ? 'inline' : 'url');

  // Adapter inference order:
  //   1. Explicit `adapter:` wins.
  //   2. Extension-based (only when `url:` is present).
  //   3. Kind's canonical adapter (applies regardless of file path —
  //      a `kind: confidence-score` track pointed at a raw API URL
  //      still wants `alphafold-prediction-json`).
  let adapter = d.adapter;
  if (!adapter && typeof d.url === 'string') {
    adapter = inferAdapterFromExtension(d.url);
  } else if (!adapter && Array.isArray(d.url) && d.url.length > 0) {
    // Multi-URL: infer only if every URL agrees on the same adapter.
    // Mixed extensions in one descriptor is a real footgun for
    // adapter inference, so we decline and let the kind adapter or
    // the validator take over.
    const inferred = d.url.map((u) => inferAdapterFromExtension(u));
    const first = inferred[0];
    if (first !== undefined && inferred.every((a) => a === first)) {
      adapter = first;
    }
  }
  if (!adapter && kindAdapter) {
    adapter = kindAdapter;
  }

  // Resolve `source:` to concrete URL(s) via the sources map. Both
  // fields stay on the descriptor so the validator can still produce
  // "Unknown source key: 'foo'. Known sources: ..." error messages
  // using the original author-facing name.
  let resolvedUrl = d.url;
  if (resolvedUrl === undefined && d.source !== undefined && from === 'url') {
    resolvedUrl = resolveSource(d.source, sources);
  }

  const out: NormalizedDataSource = { from };
  if (d.source !== undefined) out.source = d.source;
  if (resolvedUrl !== undefined) out.url = resolvedUrl;
  if (d.inlineData !== undefined) out.inlineData = d.inlineData;
  if (adapter !== undefined) out.adapter = adapter;
  return out;
}

/**
 * Resolve a `source` field (string or string[]) against the root
 * `sources` map. Unknown keys are dropped from the returned array; a
 * fully-unknown scalar returns `undefined` and is left for the
 * validator to surface. This is the same "best-effort, non-throwing"
 * contract as `resolveStringShorthand()`.
 */
function resolveSource(
  source: string | string[],
  sources: Record<string, string>
): string | string[] | undefined {
  if (typeof source === 'string') {
    return Object.prototype.hasOwnProperty.call(sources, source)
      ? sources[source]
      : undefined;
  }
  const resolved: string[] = [];
  for (const s of source) {
    if (Object.prototype.hasOwnProperty.call(sources, s)) {
      resolved.push(sources[s]);
    }
  }
  return resolved.length > 0 ? resolved : undefined;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Throw a formatted error on the first duplicate value in `ids`.
 * Shared between the group-level and track-level dedupe passes.
 */
function assertUniqueIds(
  ids: readonly string[],
  message: (id: string) => string
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(message(id));
    }
    seen.add(id);
  }
}

/**
 * Title-case an identifier for the `label` fallback.
 *
 * Matches the spec example:
 *   `"MOLECULE_PROCESSING"` → `"Molecule processing"`
 *
 * Lowercases the whole string, replaces runs of `_` / `-` with a
 * single space, then capitalises only the first character. Remaining
 * words stay lowercase ("Molecule processing", not "Molecule
 * Processing") because that matches UniProt's own group style.
 */
export function titleCaseId(id: string): string {
  const spaced = id.replace(/[_-]+/g, ' ').toLowerCase().trim();
  if (spaced.length === 0) return id;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
