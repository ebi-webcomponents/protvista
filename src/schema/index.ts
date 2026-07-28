/**
 * Public entry point for the ProtVista viewer-config schema.
 *
 * Exposes both the type surface (for authoring / editor tooling)
 * and the runtime pieces needed to ingest a config (validator,
 * loader, normalizer, registry). The type surface costs nothing at
 * runtime: `export type` re-exports are erased at compile time, so an
 * importer naming only types never pulls in Ajv or js-yaml.
 *
 * That is narrower than it sounds for *package* consumers. `exports` has
 * no schema subpath, and the package entry (`src/index.ts`) imports the
 * component unconditionally — so anything reached through the
 * `protvista-uniprot` specifier carries the whole bundle regardless.
 */

// ── Type surface ─────────────────────────────────────────────
export type {
  ProtvistaViewerConfig,
  ConfigDefaults,
  GroupConfig,
  TrackConfig,
  TopLevelEntry,
  DataSourceDescriptor,
  RenderingOptions,
  ColorScaleConfig,
  ColorStop,
  SemanticKind,
  KnownSemanticKind,
  ComponentName,
  KnownComponentName,
  AdapterName,
  KnownAdapterName,
  ProtvistaRuntimeAPI,
  SemanticKindDefinition,
  AdapterFunction,
} from './types.js';

// ── Top-level-entry discriminator ────────────────────────────
export { isGroupConfig } from './discriminate.js';

// ── Registry ─────────────────────────────────────────────────
export { createRegistry } from './registry.js';
export type { Registry } from './registry.js';

// ── Validator ────────────────────────────────────────────────
export { validateConfig } from './validate.js';
export type { ValidationIssueCode } from './validate.js';

// ── Loader ───────────────────────────────────────────────────
export { loadConfig } from './load.js';
export type { LoadConfigOptions } from './load.js';

// ── Extends merger ─────────────────────────────────────
export { mergeExtends } from './extends.js';
export type {
  ExtendsResolver,
  ExtendsFetcher,
  MergeExtendsOptions,
} from './extends.js';

// ── Normalize (output shape is part of the runtime API) ──────
export { normalizeConfig, titleCaseId } from './normalize.js';
export type {
  NormalizedConfig,
  NormalizedDefaults,
  NormalizedRow,
  NormalizedTrack,
  NormalizedDataSource,
  NormalizeOptions,
} from './normalize.js';

import type { NormalizedRow } from './normalize.js';

/**
 * @deprecated Renamed to {@link NormalizedRow}, for symmetry with the
 * authored `rows:` field — a row is not always a group (a standalone
 * track is one row with no collapse header). Kept for one release so a
 * programmatic consumer that imported the old name still compiles.
 *
 * `NormalizedConfig.groups` was renamed to `rows` in the same change and
 * deliberately has no alias: it is a field, not a type. Aliasing it
 * would let stale code keep reading `.groups` and silently get
 * `undefined` at runtime, where a hard type error is the kinder failure.
 */
export type NormalizedGroup = NormalizedRow;

// ── Errors ───────────────────────────────────────────────────
export { ConfigValidationError } from './errors.js';
export type { ValidationIssue, ValidationResult } from './errors.js';
