/**
 * Runtime validation for user-supplied viewer configurations.
 *
 * This is a hand-rolled mirror of schema/protvista-config.schema.json kept
 * dependency-free on purpose: the viewer is distributed as a web component
 * and a full JSON Schema validator would add significant bundle weight for
 * what is a small, stable structure. The JSON Schema file remains the
 * canonical, machine-readable contract for external tooling; any change here
 * must be reflected there and vice versa.
 */

import { ProtvistaConfig } from './config';

export const TRACK_TYPES = [
  'nightingale-track-canvas',
  'nightingale-interpro-track',
  'nightingale-colored-sequence',
  'nightingale-variation-canvas',
  'nightingale-linegraph-track',
  'nightingale-sequence-heatmap',
] as const;

export const ADAPTERS = [
  'feature-adapter',
  'structure-adapter',
  'proteomics-adapter',
  'variation-adapter',
  'variation-graph-adapter',
  'interpro-adapter',
  'alphafold-confidence-adapter',
  'alphamissense-pathogenicity-adapter',
  'alphamissense-heatmap-adapter',
  'proteomics-ptm-adapter',
  'rna-editing-adapter',
  'rna-editing-graph-adapter',
] as const;

export type ConfigValidationError = {
  /** JSON-pointer-like path to the offending value, e.g. /categories/0/tracks/2/data */
  path: string;
  message: string;
};

export type ConfigValidationResult =
  | { valid: true; config: ProtvistaConfig }
  | { valid: false; errors: ConfigValidationError[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

function validateDataSource(
  source: unknown,
  path: string,
  errors: ConfigValidationError[]
) {
  if (!isRecord(source)) {
    errors.push({ path, message: 'data source must be an object' });
    return;
  }
  const { url, adapter } = source;
  if (Array.isArray(url)) {
    if (url.length === 0 || !url.every(isNonEmptyString)) {
      errors.push({
        path: `${path}/url`,
        message: 'url array must contain at least one non-empty string',
      });
    }
  } else if (!isNonEmptyString(url)) {
    errors.push({
      path: `${path}/url`,
      message:
        'url is required and must be a non-empty string or an array of non-empty strings',
    });
  }
  if (
    adapter !== undefined &&
    !ADAPTERS.includes(adapter as (typeof ADAPTERS)[number])
  ) {
    errors.push({
      path: `${path}/adapter`,
      message: `unknown adapter "${String(adapter)}". Supported adapters: ${ADAPTERS.join(', ')}`,
    });
  }
}

function validateTrack(
  track: unknown,
  path: string,
  errors: ConfigValidationError[]
) {
  if (!isRecord(track)) {
    errors.push({ path, message: 'track must be an object' });
    return;
  }
  if (!isNonEmptyString(track.name)) {
    errors.push({
      path: `${path}/name`,
      message: 'name is required and must be a non-empty string',
    });
  }
  if (!TRACK_TYPES.includes(track.trackType as (typeof TRACK_TYPES)[number])) {
    errors.push({
      path: `${path}/trackType`,
      message: `unknown trackType "${String(track.trackType)}". Supported track types: ${TRACK_TYPES.join(', ')}`,
    });
  }
  if (typeof track.tooltip !== 'string') {
    errors.push({
      path: `${path}/tooltip`,
      message: 'tooltip is required and must be a string',
    });
  }
  if (!Array.isArray(track.data) || track.data.length === 0) {
    errors.push({
      path: `${path}/data`,
      message: 'data is required and must be a non-empty array of data sources',
    });
  } else {
    track.data.forEach((source, i) =>
      validateDataSource(source, `${path}/data/${i}`, errors)
    );
  }
}

function validateCategory(
  category: unknown,
  path: string,
  errors: ConfigValidationError[]
) {
  if (!isRecord(category)) {
    errors.push({ path, message: 'category must be an object' });
    return;
  }
  if (!isNonEmptyString(category.name)) {
    errors.push({
      path: `${path}/name`,
      message: 'name is required and must be a non-empty string',
    });
  }
  if (!isNonEmptyString(category.label)) {
    errors.push({
      path: `${path}/label`,
      message: 'label is required and must be a non-empty string',
    });
  }
  if (
    !TRACK_TYPES.includes(category.trackType as (typeof TRACK_TYPES)[number])
  ) {
    errors.push({
      path: `${path}/trackType`,
      message: `unknown trackType "${String(category.trackType)}". Supported track types: ${TRACK_TYPES.join(', ')}`,
    });
  }
  if (!Array.isArray(category.tracks)) {
    errors.push({
      path: `${path}/tracks`,
      message: 'tracks is required and must be an array (it may be empty)',
    });
  } else {
    category.tracks.forEach((track, i) =>
      validateTrack(track, `${path}/tracks/${i}`, errors)
    );
  }
}

/**
 * Validate an arbitrary value against the viewer configuration contract.
 * Never throws; returns either the value narrowed to ProtvistaConfig or the
 * full list of problems found (not just the first one).
 */
export function validateConfig(value: unknown): ConfigValidationResult {
  const errors: ConfigValidationError[] = [];
  if (!isRecord(value)) {
    return {
      valid: false,
      errors: [{ path: '', message: 'configuration must be a JSON object' }],
    };
  }
  if (!Array.isArray(value.categories) || value.categories.length === 0) {
    errors.push({
      path: '/categories',
      message: 'categories is required and must be a non-empty array',
    });
  } else {
    value.categories.forEach((category, i) =>
      validateCategory(category, `/categories/${i}`, errors)
    );
  }
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, config: value as unknown as ProtvistaConfig };
}

/** Format validation errors into a single human-readable message. */
export function formatConfigErrors(errors: ConfigValidationError[]): string {
  return [
    `Invalid ProtVista configuration (${errors.length} problem${errors.length === 1 ? '' : 's'}):`,
    ...errors.map(({ path, message }) => `  ${path || '/'}: ${message}`),
  ].join('\n');
}
