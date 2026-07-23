/**
 * ProtVista config validator.
 *
 * Runs two passes over a parsed config:
 *
 *   1. **Structural.** Ajv against `schema.json` (draft 2020-12).
 *      Catches shape-level problems — unknown properties, wrong
 *      types, missing required fields, `const` / `enum` violations.
 *      A structural failure short-circuits the pipeline: the
 *      semantic pass assumes a Ajv-valid input, so running it on a
 *      malformed config would produce confusing secondary errors.
 *
 *   2. **Semantic.** Closed-set checks against the runtime
 *      `Registry` (adapters, kinds, components, themes) plus a
 *      handful of cross-field checks that the static schema cannot
 *      express (unknown `sources` key, `{accession}` placeholder
 *      without an accession, …).
 *
 * Error messages are stable: adopters who grep their logs for
 * `"Unknown adapter"` continue to find the same string release over
 * release. The full set of issue codes lives in `errors.ts`.
 *
 * The pair is deliberately synchronous — Ajv compiles once per
 * process (memoised on the module), and the semantic pass is pure
 * data-walk. This keeps `loadConfig` free to orchestrate async work
 * (YAML parsing, fetch-based `extends` resolution) separately.
 *
 * No throwing. `validateConfig` always returns a `ValidationResult`;
 * the loader (`load.ts`) is the component that translates a failed
 * result into a `ConfigValidationError`. This split keeps the
 * validator trivially unit-testable — tests assert on `issues`
 * directly without a try/catch dance — and lets tools (editor
 * extensions, CI) produce their own formatting of the same data.
 */

// ajv/dist/2020 is Ajv's draft 2020-12 build — the default `Ajv` class
// from `'ajv'` is draft-07 only and refuses to compile our schema
// with error "no schema with key or ref https://json-schema.org/draft/2020-12/schema".
import Ajv2020 from 'ajv/dist/2020';
import type { ErrorObject, ValidateFunction } from 'ajv';
import schema from './schema.json' with { type: 'json' };
import type {
  ProtvistaViewerConfig,
  GroupConfig,
  TrackConfig,
  DataSourceDescriptor,
  ColorScaleConfig,
} from './types';
import { isGroupConfig } from './discriminate';
import type { Registry } from './registry';
import { RENDERABLE_COMPONENT_NAMES } from './components';
import { dataFileFormatForPath } from './file-formats';
import type {
  ValidationIssue,
  ValidationResult,
  ValidationIssueCode,
} from './errors';

// ─────────────────────────────────────────────────────────────
// Ajv instance (memoised)
//
// A single compiled validator is reused for every call. Ajv's
// `compile()` is expensive (~5 ms for this schema); we want it to
// run once per page load, not once per `validateConfig()` call.
// The memoised instance is safe to share — Ajv's validator function
// is stateless with respect to its `errors` property (it's
// reassigned per call, not appended to).
// ─────────────────────────────────────────────────────────────

let cachedValidator: ValidateFunction | undefined;

function getStructuralValidator(): ValidateFunction {
  if (cachedValidator) return cachedValidator;
  const ajv = new Ajv2020({
    allErrors: true,
    // `strict: false` suppresses Ajv's stricter-than-spec keyword-usage
    // warnings (e.g. unknown formats) which would otherwise refuse to
    // compile. Draft 2020-12 support comes from the Ajv2020 class
    // itself, not a flag.
    strict: false,
  });
  cachedValidator = ajv.compile(schema);
  return cachedValidator;
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Validate a parsed config object. Returns an issue list rather than
 * throwing so callers can present aggregated errors. Pass a
 * `Registry` seeded with your custom adapters / kinds / themes so the
 * semantic pass recognises them; the registry returned by
 * `createRegistry()` is enough for built-ins-only configs.
 *
 * A `valid: true` result guarantees:
 *   - the input conforms to `schema.json`;
 *   - every `adapter`, `kind`, `component`, and `colorScale.theme`
 *     name resolves against the registry;
 *   - every `source:` / bare-`url:` reference resolves against the
 *     config's `sources` map;
 *   - every track has a rendering path (kind, explicit component, or
 *     inherited group component);
 *   - if `{accession}` is referenced anywhere, `accession` is set;
 *   - `version` is in the supported set.
 */
export function validateConfig(
  config: unknown,
  registry: Registry
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // ── Structural pass ───────────────────────────────────────
  const structural = getStructuralValidator();
  const ok = structural(config);
  if (!ok) {
    for (const err of structural.errors ?? []) {
      issues.push(ajvErrorToIssue(err));
    }
    // Semantic checks would walk into `undefined` fields, producing
    // spurious errors. Stop here and let the caller fix structural
    // problems first.
    return { valid: false, issues };
  }

  // ── Semantic pass ─────────────────────────────────────────
  const c = config as ProtvistaViewerConfig;
  checkVersion(c, issues);
  checkAccessionPlaceholders(c, issues);
  checkRows(c, registry, issues);

  return { valid: issues.length === 0, issues };
}

// ─────────────────────────────────────────────────────────────
// Structural → Issue
// ─────────────────────────────────────────────────────────────

/**
 * Convert an Ajv `ErrorObject` into our `ValidationIssue` shape.
 * Uses `instancePath` as the path (JSON Pointer form — Ajv's default)
 * and Ajv's own `message` for the human-facing text, since Ajv's
 * messages already follow JSON-Schema convention ("must be string",
 * "must have required property 'id'"). Consumers that want the raw
 * Ajv error with `params` still available can use Ajv directly.
 */
function ajvErrorToIssue(err: ErrorObject): ValidationIssue {
  const path = err.instancePath === '' ? '/' : err.instancePath;
  const message = formatAjvMessage(err);
  return { path, message, code: 'schema' };
}

function formatAjvMessage(err: ErrorObject): string {
  // Ajv's default message for `required` errors is "must have
  // required property 'X'"; we promote the property name into the
  // path so the issue is self-contained.
  if (err.keyword === 'required') {
    const missing = (err.params as { missingProperty?: string }).missingProperty;
    return missing
      ? `must have required property '${missing}'`
      : (err.message ?? 'missing required property');
  }
  return err.message ?? 'schema violation';
}

// ─────────────────────────────────────────────────────────────
// Semantic pass
// ─────────────────────────────────────────────────────────────

/** Supported protocol versions. Keep in sync with `schema.json`'s `version.const`. */
const SUPPORTED_VERSIONS = new Set(['1.0']);

function checkVersion(
  c: ProtvistaViewerConfig,
  issues: ValidationIssue[]
): void {
  // `version` is schema-gated to `const: "1.0"`, so a structurally
  // valid config already passed version. This check exists so that
  // if we relax the schema to `type: "string"` in the future, the
  // closed-set check still runs here in one place.
  if (c.version !== undefined && !SUPPORTED_VERSIONS.has(c.version)) {
    const supported = [...SUPPORTED_VERSIONS]
      .sort()
      .map((v) => `'${v}'`)
      .join(', ');
    issues.push({
      path: '/version',
      message: `Unsupported config version: '${c.version}'. Supported: ${supported}.`,
      code: 'unsupported-version',
    });
  }
}

/**
 * Walk every string-typed field in the config looking for
 * `{accession}` placeholders. If any appear and no `accession` is
 * set, fail with a stable message naming the missing accession.
 *
 * Fields that support the placeholder: `sources` values, group/track
 * `label` (interpolated before the label's Markdoc render), and any
 * `url:` inside a `DataSourceDescriptor` (both the scalar and array
 * forms). We do not search `dataTooltip` because it is rendered
 * per-item at display time with a different interpolation routine
 * (Markdoc's own variable expansion), and `description` is plain text
 * that does not accept placeholders.
 */
function checkAccessionPlaceholders(
  c: ProtvistaViewerConfig,
  issues: ValidationIssue[]
): void {
  if (c.accession !== undefined) return;
  if (!containsAccessionPlaceholder(c)) return;

  issues.push({
    path: '/',
    message:
      'Config contains {accession} placeholders but no accession was provided via attribute or config.',
    code: 'missing-accession',
  });
}

const ACCESSION_PLACEHOLDER = '{accession}';

function containsAccessionPlaceholder(c: ProtvistaViewerConfig): boolean {
  // Check `sources` values.
  if (c.sources) {
    for (const url of Object.values(c.sources)) {
      if (typeof url === 'string' && url.includes(ACCESSION_PLACEHOLDER)) {
        return true;
      }
    }
  }
  // Walk every row → its track(s) → data descriptors. A standalone-track
  // row is a single track; a group expands to its child tracks. Group and
  // track `label` accept `{accession}` (it is interpolated before the
  // label's Markdoc render), so both are searched.
  for (const entry of c.rows) {
    if (isGroupConfig(entry) && entry.label?.includes(ACCESSION_PLACEHOLDER)) {
      return true;
    }
    const tracks = isGroupConfig(entry) ? entry.tracks : [entry];
    for (const track of tracks) {
      if (track.label?.includes(ACCESSION_PLACEHOLDER)) return true;
      if (stringFieldIncludes(track.data, ACCESSION_PLACEHOLDER)) return true;
    }
  }
  return false;
}

function stringFieldIncludes(
  data: TrackConfig['data'],
  needle: string
): boolean {
  if (typeof data === 'string') return data.includes(needle);
  if (Array.isArray(data)) {
    // The typed shape forbids strings inside arrays, but normalize.ts
    // accepts them defensively — mirror that tolerance here rather
    // than assuming every element is a full descriptor.
    return data.some((d) => {
      const item = d as DataSourceDescriptor | string;
      return typeof item === 'string'
        ? item.includes(needle)
        : descriptorIncludes(item, needle);
    });
  }
  return descriptorIncludes(data, needle);
}

function descriptorIncludes(
  d: DataSourceDescriptor,
  needle: string
): boolean {
  if (typeof d.url === 'string' && d.url.includes(needle)) return true;
  if (Array.isArray(d.url) && d.url.some((u) => u.includes(needle))) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────
// Per-group / per-track semantic checks
// ─────────────────────────────────────────────────────────────

/**
 * Whether `name` is a component the viewer can resolve — either a
 * built-in renderable component (the fixed `RENDERABLE_COMPONENT_NAMES`
 * set) or one a consumer has registered at runtime via
 * `registerComponent()` (present in the registry's `components` bucket).
 *
 * The built-in half is checked against the pure-string set rather than
 * the registry so a bare `createRegistry()` — as used by editor tooling
 * and CI, which never seed the heavy constructors — still validates
 * configs that reference the shipped components. Consumer components are
 * only known through the registry, which the element seeds and extends.
 */
function componentKnown(name: string, registry: Registry): boolean {
  return (
    (RENDERABLE_COMPONENT_NAMES as ReadonlySet<string>).has(name) ||
    registry.hasComponent(name)
  );
}

/**
 * Valid component names, for error messages. Sorted so the text is
 * stable regardless of whether the registry has consumer components
 * seeded (the element's) or none (a bare `createRegistry()`) — adopters
 * grep these messages, and insertion order would otherwise leak the
 * registry's provenance into them.
 */
function knownComponentList(registry: Registry): string {
  return listQuoted(
    new Set<string>(
      [...RENDERABLE_COMPONENT_NAMES, ...registry.listComponents()].sort()
    )
  );
}

function checkRows(
  c: ProtvistaViewerConfig,
  registry: Registry,
  issues: ValidationIssue[]
): void {
  const sourceKeys = new Set(Object.keys(c.sources ?? {}));
  // Each row is either a group (its child tracks are checked under the
  // group's component) or a standalone track (checked with no parent
  // group — it must carry its own rendering path).
  for (const entry of c.rows) {
    if (!isGroupConfig(entry)) {
      checkTrack(undefined, entry, sourceKeys, registry, issues);
      continue;
    }
    const group = entry;
    if (group.component && !componentKnown(group.component, registry)) {
      issues.push({
        path: `${group.id}`,
        message: `Unknown component: '${group.component}' on group ${group.id}. Valid components: ${knownComponentList(registry)}. Register custom components with registerComponent().`,
        code: 'unknown-component',
      });
    }
    for (const track of group.tracks) {
      checkTrack(group, track, sourceKeys, registry, issues);
    }
  }
}

function checkTrack(
  group: GroupConfig | undefined,
  track: TrackConfig,
  sourceKeys: Set<string>,
  registry: Registry,
  issues: ValidationIssue[]
): void {
  // Standalone tracks have no parent group, so their path is just the
  // track id; grouped tracks keep the `group/track` form.
  const trackPath = group ? `${group.id}/${track.id}` : track.id;

  // Unknown component on track.
  if (track.component && !componentKnown(track.component, registry)) {
    issues.push({
      path: trackPath,
      message: `Unknown component: '${track.component}' in track ${trackPath}. Valid components: ${knownComponentList(registry)}. Register custom components with registerComponent().`,
      code: 'unknown-component',
    });
  }

  // Unknown semantic kind.
  if (track.kind !== undefined && !registry.hasSemanticKind(track.kind)) {
    issues.push({
      path: trackPath,
      message: `Unknown semantic kind: '${track.kind}' in track ${trackPath}. Valid values: ${listQuoted(registry.listSemanticKinds())}. Register custom kinds with registerSemanticKind().`,
      code: 'unknown-semantic-kind',
    });
  } else if (track.kind !== undefined && !track.component) {
    // Known kind, no explicit component override: the component the kind
    // resolves to must itself be registered. A consumer kind whose
    // component was never `registerComponent()`'d would otherwise fail
    // late, at `customElements.define()` time (or silently render
    // nothing) — catch it here, before mount. Built-in kinds always
    // resolve to a renderable component, so this only bites forgotten
    // consumer registrations.
    //
    // Skipped when `track.component` is set: an explicit component
    // overrides the kind's component in normalize
    // (`t.component ?? kindDef?.component ?? …`), so the kind's component
    // is never actually used, and the explicit one is already validated
    // by the `track.component` branch above.
    const resolved = registry.getSemanticKind(track.kind)?.component;
    if (resolved && !componentKnown(resolved, registry)) {
      issues.push({
        path: trackPath,
        message: `Semantic kind '${track.kind}' in track ${trackPath} resolves to component '${resolved}', which is not registered. Register it with registerComponent().`,
        code: 'unknown-component',
      });
    }
  }

  // Unknown implicit adapter. A known kind also resolves to an adapter
  // name (e.g. `features` → `uniprot-features-json`) that the loader looks
  // up in the registry at fetch time. Built-in kinds always resolve to a
  // registered adapter; a consumer kind whose adapter was never
  // registered would otherwise fail late — the loader throws and degrades
  // the track to empty. Catch it here, mirroring the explicit `adapter:`
  // check below. Skipped when a data descriptor sets an explicit
  // `adapter:` (that overrides the kind's adapter and is validated per
  // descriptor), so the kind's adapter is never actually used.
  if (track.kind !== undefined && registry.hasSemanticKind(track.kind)) {
    const kindAdapter = registry.getSemanticKind(track.kind)?.adapter;
    const hasExplicitAdapter = collectDescriptors(track).some(
      (d) => !isShorthand(d) && d.adapter !== undefined
    );
    if (kindAdapter && !hasExplicitAdapter && !registry.hasAdapter(kindAdapter)) {
      issues.push({
        path: trackPath,
        message: `Semantic kind '${track.kind}' in track ${trackPath} resolves to adapter '${kindAdapter}', which is not registered. Register it with registerAdapter().`,
        code: 'unknown-adapter',
      });
    }
  }

  // Track has no rendering path: no `kind`, no track-level
  // `component`, and no parent-group `component` to inherit. A
  // standalone track (no parent group) has no group component to fall
  // back on, so this check fires for it the same way it does for a
  // grouped track whose group also lacks a component.
  if (!track.kind && !track.component && !group?.component) {
    issues.push({
      path: trackPath,
      message: `Track ${trackPath} has no 'kind' or 'component'. Set a semantic 'kind' (e.g. 'features') or provide 'component' explicitly.`,
      code: 'missing-track-renderer',
    });
  }

  // Rendering-level colorScale check. `effectiveRendering` already
  // covers the inheritance case (group's colorScale flows through
  // when the track doesn't override), so a separate group-only branch
  // would be redundant.
  const effectiveRendering = track.rendering ?? group?.rendering;
  if (effectiveRendering?.colorScale) {
    checkColorScale(trackPath, effectiveRendering.colorScale, registry, issues);
  }

  // Data descriptors.
  for (const descriptor of collectDescriptors(track)) {
    checkDescriptor(trackPath, descriptor, sourceKeys, registry, issues);
  }
}

function collectDescriptors(
  track: TrackConfig
): Array<DataSourceDescriptor | { __shorthand: string }> {
  const raw = track.data;
  if (typeof raw === 'string') return [{ __shorthand: raw }];
  if (Array.isArray(raw))
    return raw.map((d) =>
      typeof d === 'string' ? { __shorthand: d } : d
    );
  return [raw];
}

function isShorthand(
  d: DataSourceDescriptor | { __shorthand: string }
): d is { __shorthand: string } {
  return typeof (d as { __shorthand?: unknown }).__shorthand === 'string';
}

function checkDescriptor(
  trackPath: string,
  d: DataSourceDescriptor | { __shorthand: string },
  sourceKeys: Set<string>,
  registry: Registry,
  issues: ValidationIssue[]
): void {
  if (isShorthand(d)) {
    checkStringShorthand(trackPath, d.__shorthand, sourceKeys, issues);
    return;
  }

  // from: inline requires inlineData (also enforced by schema.json's
  // conditional, but duplicated here for a cleaner error message —
  // Ajv's own message is "must have required property 'inlineData'"
  // which hides the `from: inline` trigger).
  if (d.from === 'inline' && d.inlineData === undefined) {
    issues.push({
      path: trackPath,
      message: `inlineData is required when 'from' is 'inline' in track ${trackPath}.`,
      code: 'missing-inline-data',
    });
  }

  // Unknown adapter.
  if (d.adapter !== undefined && !registry.hasAdapter(d.adapter)) {
    issues.push({
      path: trackPath,
      message: `Unknown adapter: ${d.adapter} in track ${trackPath}. Did you forget to call registerAdapter()?`,
      code: 'unknown-adapter',
    });
  }

  // Source key must resolve in the sources map.
  if (d.source !== undefined) {
    const keys = Array.isArray(d.source) ? d.source : [d.source];
    for (const key of keys) {
      if (!sourceKeys.has(key)) {
        issues.push({
          path: trackPath,
          message: `Unknown source key: '${key}' in track ${trackPath}. Known sources: ${listQuoted(sourceKeys)}.`,
          code: 'unknown-source-key',
        });
      }
    }
  }

}

/**
 * Apply the string-shorthand resolution rules from
 * `TrackConfig.data`. For this validator we only need to detect the
 * one failure case:
 *
 *   - the value is not a URL, not a known data-file path, and not a
 *     known sources key → "Unknown source key".
 *
 * A `./hits.csv`-style path to a known generic format (see
 * `dataFileFormatForPath`) is accepted here; normalize.ts resolves it
 * to `from: 'file'` with the extension's built-in adapter. An
 * unrecognised extension (`./x.gff`) still falls through to the
 * unknown-source-key error.
 *
 * The rest of the expansion is normalize.ts's job.
 */
function checkStringShorthand(
  trackPath: string,
  value: string,
  sourceKeys: Set<string>,
  issues: ValidationIssue[]
): void {
  // Rule 1: a sources-map key is always OK.
  if (sourceKeys.has(value)) return;

  // Rule 2: http(s) URL is OK without any adapter/kind inference.
  if (/^https?:\/\//i.test(value)) return;

  // Rule 3: a path to a known data file (`./hits.csv`, `../x.tsv`) is OK
  // — normalize.ts resolves it to `from: file` with the extension's
  // built-in adapter, so it will load without an "Unknown adapter" error.
  if (dataFileFormatForPath(value)) return;

  // Rule 4 fell through: treat as sources-key reference, surface
  // "Unknown source key" with the registered keys list.
  issues.push({
    path: trackPath,
    message: `Unknown source key: '${value}' in track ${trackPath}. Known sources: ${listQuoted(sourceKeys)}.`,
    code: 'unknown-source-key',
  });
}

// ─────────────────────────────────────────────────────────────
// colorScale
// ─────────────────────────────────────────────────────────────

function checkColorScale(
  trackPath: string,
  cs: ColorScaleConfig,
  registry: Registry,
  issues: ValidationIssue[]
): void {
  if (cs.theme !== undefined && !registry.hasTheme(cs.theme)) {
    issues.push({
      path: trackPath,
      message: `Unknown colorScale theme: '${cs.theme}'. Registered themes: ${listQuoted(registry.listThemes())}.`,
      code: 'unknown-theme',
    });
  }
  // Schema.json's `anyOf: [theme | stops]` guarantees one of them is
  // present; the validator's belt-and-braces check for the other
  // direction (neither set) is therefore redundant here. Still keep
  // the code id `invalid-color-scale` in the type union for authors
  // that bypass the schema.
  if (cs.theme === undefined && (!cs.stops || cs.stops.length === 0)) {
    issues.push({
      path: trackPath,
      message: `colorScale must specify either 'theme' or 'stops' in ${trackPath}.`,
      code: 'invalid-color-scale',
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────

function listQuoted(values: Iterable<string>): string {
  const sorted = [...values].sort();
  if (sorted.length === 0) return '(none registered)';
  return sorted.map((v) => `'${v}'`).join(', ');
}

// Re-export ValidationIssueCode for callers that want to switch on
// `issue.code` without importing from './errors' directly.
export type { ValidationIssueCode };
