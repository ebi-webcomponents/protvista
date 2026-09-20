/**
 * Single source of truth mapping a data file's extension to the built-in
 * adapter that parses it and how its HTTP body must be read.
 *
 * Three consumers share this table so they can never disagree about what
 * `./x.csv` means:
 *   - `normalize.ts` — infers the adapter for a file-path `data:` shorthand.
 *   - `validate.ts`  — recognises a file-path shorthand as valid (rather
 *     than reporting "Unknown source key").
 *   - `load-data.ts` — decides whether to read a track's response as text
 *     (delimited formats) or JSON.
 *
 * To add a format: add one row below and register the adapter in
 * `adapters/index.ts` and the runtime `adapters` map in
 * `protvista-uniprot.ts`. Nothing else here needs to change —
 * `body: 'json'` vs `'text'` already distinguishes a JSON payload
 * (`features-json`) from delimited text (`bed`).
 *
 * This table is consulted only for a track with no `kind:`. A kind-addressed
 * track resolves its adapter through the kind's own family — see
 * {@link KIND_ADAPTER_VARIANTS} — so a `kind:` and a file extension can never
 * name two different adapters and need no precedence rule between them.
 */

import type { DataFormat } from './types.js';
import type { ShapeName } from './shapes.js';

export interface DataFileFormat {
  /** The lower-cased extension including the dot, e.g. `.csv`. */
  ext: string;
  /** How the fetched response body must be read before decoding. */
  body: 'text' | 'json';
}

/**
 * Formats — *how* a source's bytes are encoded. The other half of the pair
 * that replaces the `<shape>-<format>` adapter grid (see "Shape and format
 * (normative)" in `specs/config-approach.md`).
 *
 * A format says nothing about what the records mean. `bed` is the exception,
 * and declares it: the format carries feature semantics (0-based half-open,
 * converted on read), so it can only produce feature records. That is
 * expressed as `emitsShape` rather than special-cased, so GFF/GTF/VCF slot in
 * the same way later.
 *
 * `FormatDefinition` is shaped to become a registry entry for the reserved
 * `registerFormat()` extension point.
 */
export interface FormatDefinition {
  name: DataFormat;
  /** The file extension that implies this format, lower-case, dot-prefixed. */
  ext: string;
  /** How the body must be read before decoding. */
  body: 'text' | 'json';
  /**
   * Set when the format itself determines the records it can produce. A kind
   * whose shape differs is a config error naming both sides.
   */
  emitsShape?: ShapeName;
}

export const DATA_FORMATS: Readonly<Record<DataFormat, FormatDefinition>> = {
  csv: { name: 'csv', ext: '.csv', body: 'text' },
  tsv: { name: 'tsv', ext: '.tsv', body: 'text' },
  json: { name: 'json', ext: '.json', body: 'json' },
  bed: { name: 'bed', ext: '.bed', body: 'text', emitsShape: 'feature' },
};

export const DATA_FORMAT_NAMES = Object.keys(DATA_FORMATS) as DataFormat[];

export function isDataFormat(value: string): value is DataFormat {
  return Object.prototype.hasOwnProperty.call(DATA_FORMATS, value);
}

/** The format a path's extension implies, or `undefined`. */
export function formatForPath(value: string): FormatDefinition | undefined {
  const fmt = dataFileFormatForPath(value);
  return fmt === undefined ? undefined : DATA_FORMATS[extFormatName(fmt.ext)];
}

function extFormatName(ext: string): DataFormat {
  return (DATA_FORMAT_NAMES.find((n) => DATA_FORMATS[n].ext === ext) ??
    'json') as DataFormat;
}

/** Extension → format descriptor. Keys are lower-case, dot-prefixed. */
export const DATA_FILE_FORMATS: Record<string, DataFileFormat> = {
  '.csv': { ext: '.csv', body: 'text' },
  '.tsv': { ext: '.tsv', body: 'text' },
  '.json': { ext: '.json', body: 'json' },
  '.bed': { ext: '.bed', body: 'text' },
};

/**
 * If `value` looks like a path to a known data file, return its format
 * descriptor; otherwise `undefined`. Query string and hash fragment are
 * stripped and the extension is matched case-insensitively, so
 * `./hits.CSV` and `https://host/x.csv?v=2` both resolve.
 */
export function dataFileFormatForPath(value: string): DataFileFormat | undefined {
  const path = value.split(/[?#]/, 1)[0];
  const dot = path.lastIndexOf('.');
  if (dot === -1) return undefined;
  return DATA_FILE_FORMATS[path.slice(dot).toLowerCase()];
}
