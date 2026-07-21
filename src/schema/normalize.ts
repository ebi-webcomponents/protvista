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
 *   1. Expands the `data` shorthand forms (string, single descriptor,
 *      array) into a `NormalizedDataSource[]`. Runtime code never has
 *      to branch on "is this a string / object / array?" again.
 *   2. Resolves string-shorthand data rules (sources key, http(s) URL,
 *      or a known data-file path like `./x.csv` → `from: file` with the
 *      extension's built-in adapter) per the table in `TrackConfig.data`.
 *      CSV/TSV/JSON/BED file shorthands all resolve today.
 *   3. Fills in defaults for `from` (`"url"` when omitted, `"inline"`
 *      when `inlineData` is present).
 *   4. Resolves semantic kinds via the registry into (component,
 *      adapter, rendering preset) and folds the preset into the
 *      track's rendering chain.
 *   5. Cascades rendering inheritance so the loader sees
 *      fully-resolved per-track blocks (no walking of
 *      defaults → group → track at render time):
 *
 *         track.rendering > group.rendering > defaults.rendering
 *
 *   6. Infers group `component` from child-track `component`s when
 *      omitted (all-same → that component; mixed →
 *      `nightingale-track-canvas`).
 *   7. Applies the title-cased `id` → `label` fallback for both
 *      groups and tracks.
 *   8. Detects duplicate ids and throws — top-level ids share one
 *      namespace across groups and standalone tracks; track ids are
 *      unique within their group.
 *   9. Resolves `source:` references to concrete `url:` strings via
 *      the root `sources` map, leaving the `source:` field in place
 *      for downstream introspection (validator error messages).
 *  10. Wraps each standalone top-level track (a `rows:` entry with no
 *      `tracks:`) in a synthetic single-track `NormalizedRow` flagged
 *      `standalone`, so downstream code stays on one uniform
 *      `NormalizedRow[]` path. Standalone tracks skip the
 *      group-rendering cascade layer (`defaults → kind preset → track`).
 *
 * What normalize does NOT do (delegated to the validator):
 *
 *   - Shape-check the input (assumes Ajv-valid on the normal load
 *     path; defensive enough for tests that pass object literals).
 *   - Resolve `{accession}` placeholders. That's fetch-time work in
 *     the loader, because the HTML attribute can override the config
 *     value after normalize has already run.
 *   - Surface "Unknown source key" / "Unknown semantic kind" /
 *     "Unknown adapter" errors. Those live in the validator so that
 *     the same error messages are raised for both raw and
 *     programmatically-constructed configs. Normalize is deliberately
 *     non-throwing for unknowns and returns a best-effort output —
 *     callers that skip the validator are responsible for their own
 *     unknown-name handling.
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
import { isGroupConfig } from './discriminate';
import type { Registry } from './registry';
import { resolveRowsAlias } from './rows-alias';
import { dataFileFormatForPath } from './file-formats';

// ─────────────────────────────────────────────────────────────
// Output types — the canonical shape the loader consumes
// ─────────────────────────────────────────────────────────────

/**
 * Fully-resolved config. The only fields kept optional are those that
 * are semantically optional at runtime (e.g. `accession` — absent in
 * configs not yet bound to a specific protein).
 */
export interface NormalizedConfig {
  version: '1.0';
  accession?: string;
  sources: Record<string, string>;
  defaults: NormalizedDefaults;
  /** Author-set: promote warnings to a mount-level failure. See `ProtvistaViewerConfig.strict`. */
  strict?: boolean;
  rows: NormalizedRow[];
}

export interface NormalizedDefaults {
  /** Always present (at minimum: `{}`). Renderers can spread it safely. */
  rendering: RenderingOptions;
}

/**
 * One row of the viewer — the internal counterpart of an authored
 * `rows:` entry. A row always *contains* tracks: a real group holds
 * however many it declares, a standalone row holds exactly one (see
 * `standalone` below).
 */
export interface NormalizedRow {
  id: string;
  /** Always present after normalize — `titleCaseId(id)` if omitted. */
  label: string;
  /** Short plain-text description; rendered as `title=` on the group label. */
  description?: string;
  /** Always resolved — inferred from children if omitted, else canvas. */
  component: ComponentName;
  /** Resolved cascade: defaults → group. */
  rendering: RenderingOptions;
  tracks: NormalizedTrack[];
  /**
   * Set only on the synthetic single-track row that wraps an authored
   * standalone track (a top-level `rows:` entry with no `tracks:`).
   * The renderer reads this to render one row with no group-collapse
   * affordance; a genuine one-track group (authored with `tracks:`)
   * leaves it unset and keeps its collapse header. The wrapper's
   * `label` always equals the wrapped track's label, and the cascade
   * skips the group-rendering layer (`defaults → kind preset → track`).
   */
  standalone?: boolean;
}

export interface NormalizedTrack {
  id: string;
  label: string;
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
}

/**
 * Normalised data descriptor. Identical in field names to
 * `DataSourceDescriptor` so existing fetch helpers that accept the
 * input type keep working — but with stronger guarantees:
 *
 *   - `from` is always present.
 *   - `source` references have already been looked up and the
 *     corresponding `url` populated.
 *   - `adapter` has had kind-based inference applied (still
 *     `undefined` if the track has no `kind` and no explicit
 *     `adapter:` — the validator surfaces that to the author).
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
   * the group `component`. This keeps `normalize()` callable from
   * unit tests that exercise shorthand expansion or inheritance
   * without setting up a full registry.
   */
  registry?: Registry;
}

export function normalizeConfig(
  rawConfig: ProtvistaViewerConfig,
  opts: NormalizeOptions = {}
): NormalizedConfig {
  const { registry } = opts;
  // Defensive: `loadConfig` has already folded any `groups:` alias into
  // `rows:`, but `normalizeConfig` is exported and an embedder may call
  // it directly on an authored config. Re-resolving an alias-free
  // config is a no-op.
  const config = resolveRowsAlias(rawConfig);
  const sources = config.sources ?? {};

  const defaults: NormalizedDefaults = {
    rendering: { ...(config.defaults?.rendering ?? {}) },
  };

  // Duplicate top-level-id detection BEFORE we recurse so errors refer
  // to the offending id and not a downstream symptom. Groups and
  // standalone tracks share one top-level id namespace, so this check
  // spans both shapes (a group id colliding with a standalone-track id
  // is caught here).
  assertUniqueIds(
    config.rows.map((c) => c.id),
    (id) => `Duplicate top-level id '${id}'.`
  );

  // Each row is either a group of tracks or a standalone track. A
  // standalone track is wrapped in a synthetic single-track row so
  // the loader and renderer see one uniform `NormalizedRow[]`; the
  // `standalone` flag tells the renderer to drop the collapse header.
  const rows = config.rows.map((c) =>
    isGroupConfig(c)
      ? normalizeGroup(c, defaults, sources, registry)
      : normalizeStandalone(c, defaults, sources, registry)
  );

  return {
    version: config.version ?? '1.0',
    ...(config.accession !== undefined ? { accession: config.accession } : {}),
    sources,
    defaults,
    ...(config.strict !== undefined ? { strict: config.strict } : {}),
    rows,
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
): NormalizedRow {
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
    // Zero-track group — pick a sensible default so nothing
    // downstream blows up if the group ends up rendered anyway.
    component = 'nightingale-track-canvas';
  }

  return {
    id: c.id,
    label: c.label ?? titleCaseId(c.id),
    ...(c.description !== undefined ? { description: c.description } : {}),
    component,
    rendering: groupRendering,
    tracks,
  };
}

/**
 * Normalize a standalone top-level track (an authored `rows:` entry
 * with no `tracks:`) by wrapping it in a synthetic single-track
 * `NormalizedRow` flagged `standalone`.
 *
 * Wrapping keeps the loader and renderer on one uniform
 * `NormalizedRow[]` path — the alternative (a bare `NormalizedTrack`
 * union at the top level) would force every downstream consumer
 * (data loader, render loop, per-group side-effects) to branch on the
 * entry shape. The trade-off is documented in `docs/architecture.md`.
 *
 * The cascade for a standalone track skips the group-rendering layer:
 * `defaults → kind preset → track` (vs `defaults → group → kind →
 * track` for grouped tracks). We pass `undefined` for the parent group
 * and `defaults.rendering` as the parent rendering so `normalizeTrack`
 * layers the kind preset and track overrides directly on defaults.
 *
 * The wrapper mirrors the resolved track: same `id`, `label`
 * (`label === track.label`), and `component`. The renderer reads the
 * `standalone` flag to render a single row with no collapse header;
 * the track's own `label` / `description` drive that row's label
 * affordances.
 */
function normalizeStandalone(
  t: TrackConfig,
  defaults: NormalizedDefaults,
  sources: Record<string, string>,
  registry: Registry | undefined
): NormalizedRow {
  const track = normalizeTrack(
    t,
    undefined,
    defaults.rendering,
    defaults,
    sources,
    registry
  );

  return {
    id: track.id,
    label: track.label,
    component: track.component,
    rendering: { ...defaults.rendering },
    tracks: [track],
    standalone: true,
  };
}

// ─────────────────────────────────────────────────────────────
// Track
// ─────────────────────────────────────────────────────────────

function normalizeTrack(
  t: TrackConfig,
  parent: GroupConfig | undefined,
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
  // explicit override on top of a kind preset.
  const rendering: RenderingOptions = {
    ...parentRendering,
    ...(kindDef?.rendering ?? {}),
    ...(t.rendering ?? {}),
  };

  // Component resolution precedence:
  //   1. Explicit on the track (escape hatch)
  //   2. Kind's canonical component (author used `kind:`)
  //   3. Parent group's explicit `component` (legacy authoring
  //      style — one canvas row per group with sub-tracks). Absent for
  //      a standalone track, which has no parent group.
  //   4. `nightingale-track-canvas` — works for the vast majority of
  //      feature-style tracks.
  const component: ComponentName =
    t.component ??
    kindDef?.component ??
    parent?.component ??
    'nightingale-track-canvas';

  const data = expandData(t, kindDef?.adapter, sources);

  return {
    id: t.id,
    label: t.label ?? titleCaseId(t.id),
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

  // Step 1: unify the three input shapes (single string, array of
  // string-or-descriptor, single descriptor) into a
  // DataSourceDescriptor[]. We still tag string entries with a marker
  // so the shorthand rules can run on them below — resolving them
  // here mixes two concerns (array-wrapping and string-shorthand) and
  // makes the inner function harder to read.
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
  // 3. A path to a known data file (`./hits.csv`, `../x.tsv`, `/data.csv`)
  //    → from: file. The adapter is inferred from the extension in
  //    `expandDescriptor`. The value is kept on `url` so the loader
  //    fetches it through the same path as a URL source.
  if (dataFileFormatForPath(value)) {
    return { from: 'file', url: value };
  }
  // 4. Fell off the end. Best-effort: assume the author intended a
  //    sources-key reference. The validator surfaces
  //    "Unknown source key: '<value>' in track <groupId>/<trackId>.
  //    Known sources: ..." with the registered keys listed — a far
  //    better error than any the engine could produce here.
  return { from: 'url', source: value };
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

  // Adapter inference, most specific first: an explicit `adapter:` wins;
  // otherwise a known data-file extension on the URL (`./x.csv` →
  // `features-csv`); otherwise the kind's canonical adapter (e.g. a
  // `kind: confidence-score` track pointed at a raw API URL gets
  // `alphafold-prediction-json`).
  const inferredFromExt =
    typeof d.url === 'string'
      ? dataFileFormatForPath(d.url)?.adapter
      : undefined;
  const adapter = d.adapter ?? inferredFromExt ?? kindAdapter;

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
