/**
 * Single source of truth for the formats a source's bytes can be in: the
 * extension that implies each one, and how its HTTP body must be read.
 *
 * Three consumers share this table so they can never disagree about what
 * `./x.csv` means:
 *   - `normalize.ts` — reads the format off a file-path `data:` shorthand.
 *   - `validate.ts`  — recognises a file-path shorthand as valid (rather
 *     than reporting "Unknown source key"), and checks a declared `format:`
 *     against the records the track's `kind` draws.
 *   - `load-data.ts` — decides whether to read a track's response as text
 *     (delimited formats) or JSON.
 *
 * A format is half of the pair that replaced the `<shape>-<format>` adapter
 * grid: it says how the bytes are encoded, while the track's `kind` says what
 * the records mean. Neither can override the other, so a `kind:` and a file
 * extension need no precedence rule between them — see "Shape and format
 * (normative)" in `specs/config-approach.md`.
 *
 * To add a format: add one row below and a decoder branch in
 * `adapters/pipeline.ts`. Nothing else needs to change.
 */

import type { DataFormat } from './types.js';
import type { ShapeName } from './shapes.js';

/**
 * One format — *how* a source's bytes are encoded.
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

/** Extension → format, derived from the table above so the two cannot drift. */
const BY_EXTENSION: ReadonlyMap<string, FormatDefinition> = new Map(
  DATA_FORMAT_NAMES.map((n) => [DATA_FORMATS[n].ext, DATA_FORMATS[n]])
);

/**
 * The format a path's extension implies, or `undefined`.
 *
 * Query string and hash fragment are stripped and the extension is matched
 * case-insensitively, so `./hits.CSV` and `https://host/x.csv?v=2` both
 * resolve. An extension no format claims returns `undefined` rather than a
 * default — a guessed format is a file read the wrong way with nothing to
 * point at.
 */
export function formatForPath(value: string): FormatDefinition | undefined {
  const path = value.split(/[?#]/, 1)[0];
  const dot = path.lastIndexOf('.');
  if (dot === -1) return undefined;
  return BY_EXTENSION.get(path.slice(dot).toLowerCase());
}
