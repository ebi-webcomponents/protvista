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
  DataSourceDescriptor,
  Transform,
  FieldPredicate,
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
  TransformFunction,
} from './types';

// ── Registry ─────────────────────────────────────────────────
export { createRegistry, BUILTIN_TRANSFORM_OPERATORS } from './registry';
export type { Registry } from './registry';

// ── Validator ────────────────────────────────────────────────
export { validateConfig } from './validate';
export type { ValidationIssueCode } from './validate';

// ── Loader ───────────────────────────────────────────────────
export { loadConfig } from './load';
export type { LoadConfigOptions } from './load';

// ── Extends merger (#20) ─────────────────────────────────────
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
  NormalizedGroup,
  NormalizedTrack,
  NormalizedDataSource,
  NormalizeOptions,
} from './normalize';

// ── Errors ───────────────────────────────────────────────────
export { ConfigValidationError } from './errors';
export type { ValidationIssue, ValidationResult } from './errors';
