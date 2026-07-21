/**
 * Public entry point for the ProtVista viewer-config schema.
 *
 * Exposes both the type surface (for authoring / editor tooling)
 * and the runtime pieces needed to ingest a config (validator,
 * loader, normalizer, registry). The runtime surface is
 * tree-shakeable — consumers that only need the types pay no bundle
 * cost for the runtime (Ajv, js-yaml, normalize) because none of
 * these re-exports run side-effects at load time.
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
} from './types';

// ── Top-level-entry discriminator ────────────────────────────
export { isGroupConfig } from './discriminate';

// ── Registry ─────────────────────────────────────────────────
export { createRegistry } from './registry';
export type { Registry } from './registry';

// ── Validator ────────────────────────────────────────────────
export { validateConfig } from './validate';
export type { ValidationIssueCode } from './validate';

// ── Loader ───────────────────────────────────────────────────
export { loadConfig } from './load';
export type { LoadConfigOptions } from './load';

// ── Extends merger ─────────────────────────────────────
export { mergeExtends } from './extends';
export type {
  ExtendsResolver,
  ExtendsFetcher,
  MergeExtendsOptions,
} from './extends';

// ── Normalize (output shape is part of the runtime API) ──────
export { normalizeConfig, titleCaseId } from './normalize';
export type {
  NormalizedConfig,
  NormalizedDefaults,
  NormalizedRow,
  NormalizedTrack,
  NormalizedDataSource,
  NormalizeOptions,
} from './normalize';

import type { NormalizedRow } from './normalize';

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
export { ConfigValidationError } from './errors';
export type { ValidationIssue, ValidationResult } from './errors';
