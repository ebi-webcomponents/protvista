/**
 * Decode → validate → build: the pipeline that replaces the adapter grid.
 *
 * A source's **format** says how its bytes are encoded; a track's **shape**
 * says which records it needs. Neither knows about the other, so the ten
 * `<shape>-<format>` adapters were the cross-product of two independent
 * facts — a grid that grows multiplicatively and has to be named, registered,
 * documented and drift-tested cell by cell. Here the cross-product is
 * computed instead: four decoders, three shape builders, one composition.
 *
 * ```
 * bytes ──decode(format)──▶ records ──build(shape)──▶ what the component renders
 * ```
 *
 * Every source resolves through here — a fetched body, an inline block, a
 * `setTrackData()` payload — so one file read one way cannot come out two
 * different ways depending on where it entered. See "Shape and format
 * (normative)" in `specs/config-approach.md`.
 *
 * `formatLabel` is threaded through rather than derived so a caller can name
 * the input in the author's own terms: the file path they wrote, or "inline
 * data" when there is no path to name.
 */

import type { DataFormat, ShapeName } from '../types.js';
import { SHAPES } from '../shapes.js';
import { DATA_FORMATS } from '../file-formats.js';
import {
  parseDelimited,
  rowsToFeatureRecords,
  rowsToPointRecords,
  rowsToVariationRecords,
} from './dsv.js';
import { featuresJson } from './features-json.js';
import { linegraph, toSeries } from './linegraph.js';
import { variation, toVariants } from './variation.js';
import { bed } from './bed.js';

/** Raised when a format cannot produce the records a shape requires. */
export class ShapeFormatMismatchError extends Error {
  constructor(
    public readonly shape: ShapeName,
    public readonly format: DataFormat
  ) {
    const emits = DATA_FORMATS[format].emitsShape;
    super(
      emits
        ? `${format.toUpperCase()} files carry ${SHAPES[emits].label}; this ` +
            `track draws ${SHAPES[shape].label}.`
        : `${format} cannot produce ${SHAPES[shape].label}.`
    );
    this.name = 'ShapeFormatMismatchError';
    Object.setPrototypeOf(this, ShapeFormatMismatchError.prototype);
  }
}

/**
 * Whether a format can produce a shape's records.
 *
 * Only a format that declares `emitsShape` constrains anything: CSV, TSV and
 * JSON are containers and carry whatever the track asks for, while BED
 * encodes feature semantics in the format itself.
 */
export function formatCanProduce(
  format: DataFormat,
  shape: ShapeName
): boolean {
  const emits = DATA_FORMATS[format].emitsShape;
  return emits === undefined || emits === shape;
}

const DELIMITERS: Partial<Record<DataFormat, string>> = {
  csv: ',',
  tsv: '\t',
};

/** Build the component's payload from validated records of `shape`. */
function wrap(shape: ShapeName, records: unknown[]): unknown {
  switch (shape) {
    case 'point':
      return toSeries(records as never);
    case 'variation':
      return toVariants(records as never);
    case 'feature':
      // A feature array *is* the representation the track canvas renders.
      return records;
  }
}

/** Decode delimited text into records of `shape`. */
function fromDelimited(
  shape: ShapeName,
  text: string,
  delimiter: string,
  formatLabel: string
): unknown[] {
  const rows = parseDelimited(text, delimiter);
  switch (shape) {
    case 'feature':
      return rowsToFeatureRecords(rows, { formatLabel });
    case 'point':
      return rowsToPointRecords(rows, { formatLabel });
    case 'variation':
      return rowsToVariationRecords(rows, { formatLabel });
  }
}

/**
 * Validate an already-parsed JSON body as records of `shape`, returning the
 * component payload.
 *
 * The JSON validators own their own wrapping (they are the adapters a `kind`
 * resolves to today), so this returns their output directly rather than
 * re-wrapping it.
 */
function fromJson(
  shape: ShapeName,
  body: unknown,
  formatLabel: string
): unknown {
  switch (shape) {
    case 'feature':
      return featuresJson(body, formatLabel);
    case 'point':
      return linegraph(body, formatLabel);
    case 'variation':
      return variation(body, formatLabel);
  }
}

/**
 * How an error should name the input it rejected.
 *
 * The grid labelled parser errors with the adapter's own name —
 * `features-csv: row 3, column "start": …` — which told the author *nothing*
 * about which of their files was wrong. A config with four CSV tracks
 * reported the same prefix for all four.
 *
 * So the label names the source and how it was read:
 *
 *   ./depth.csv (parsed as CSV): row 3, column "value": …
 *   inline data (parsed as CSV): row 2, column "position": …
 *
 * The "(parsed as …)" half earns its place when the two disagree — a
 * `./readings.txt` with `format: csv`, or a `.tsv` the author overrode. It
 * states the reading the viewer chose, which is exactly what an author
 * debugging an unexpected parse error needs to see.
 */
export function sourceLabel(
  source: string | undefined,
  format: DataFormat
): string {
  const what = source === undefined || source === '' ? 'inline data' : source;
  return `${what} (parsed as ${format.toUpperCase()})`;
}

export interface PipelineOptions {
  /**
   * Prefix for row/column error messages. Defaults to {@link sourceLabel} of
   * `source` and the format.
   */
  formatLabel?: string;
  /** The file path or URL this body came from; omitted for inline data. */
  source?: string;
}

/**
 * Run one source body through the pipeline for a (shape, format) pair.
 *
 * Throws `ShapeFormatMismatchError` when the format cannot produce the
 * shape's records, and the decoder's own row/column-named error when the
 * bytes are malformed.
 */
export function runPipeline(
  shape: ShapeName,
  format: DataFormat,
  body: unknown,
  opts: PipelineOptions = {}
): unknown | Promise<unknown> {
  if (!formatCanProduce(format, shape)) {
    throw new ShapeFormatMismatchError(shape, format);
  }
  const formatLabel = opts.formatLabel ?? sourceLabel(opts.source, format);

  if (format === 'bed') {
    // BED decodes straight to feature records — its coordinate conversion is
    // part of reading the format, not of shaping it.
    return bed(body, formatLabel);
  }

  const delimiter = DELIMITERS[format];
  if (delimiter !== undefined) {
    if (typeof body !== 'string') {
      console.warn(
        `[protvista] ${formatLabel}: expected a text body; got ` +
          `${typeof body}. Treating as empty.`
      );
      return wrap(shape, []);
    }
    return wrap(shape, fromDelimited(shape, body, delimiter, formatLabel));
  }

  return fromJson(shape, body, formatLabel);
}
