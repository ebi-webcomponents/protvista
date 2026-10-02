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
 *
 * A caller may also pass a `coordinates` sink to collect each decoded row's
 * coordinates and row number, for the sequence-bounds warning
 * (`./coordinates`), without touching the payload.
 */

import type { DataFormat, ShapeName } from '../types.js';
import { SHAPES } from '../shapes.js';
import { DATA_FORMATS } from '../file-formats.js';
import {
  parseDelimited,
  rowsToFeatureRecords,
  rowsToPointRecords,
  rowsToVariationRecords,
  type FeatureRecord,
  type PointRecord,
} from './dsv.js';
import { featuresJson } from './features-json.js';
import { linegraph, toSeries } from './linegraph.js';
import { variation, toVariants } from './variation.js';
import { bed } from './bed.js';
import type { CoordinateRow } from './coordinates.js';

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

/**
 * Decode delimited text into records of `shape`. `rowNumbers`, when given,
 * receives each record's row number in record order.
 */
function fromDelimited(
  shape: ShapeName,
  text: string,
  delimiter: string,
  formatLabel: string,
  rowNumbers?: number[]
): unknown[] {
  const rows = parseDelimited(text, delimiter);
  switch (shape) {
    case 'feature':
      return rowsToFeatureRecords(rows, { formatLabel, rowNumbers });
    case 'point':
      return rowsToPointRecords(rows, { formatLabel, rowNumbers });
    case 'variation':
      return rowsToVariationRecords(rows, { formatLabel, rowNumbers });
  }
}

/**
 * One decoded record's coordinates, as the bounds check reads them: a
 * feature's `start` then `end`, or a point/variation record's `position`.
 */
function coordinateRow(
  shape: ShapeName,
  row: number,
  record: unknown
): CoordinateRow {
  if (shape === 'feature') {
    const r = record as FeatureRecord;
    return {
      row,
      fields: [
        ['start', r.start],
        ['end', r.end],
      ],
    };
  }
  return { row, fields: [['position', (record as PointRecord).position]] };
}

/**
 * Read the coordinates back from a validated JSON payload. The validators
 * throw on any bad row and otherwise emit one record per input element, in
 * order, so index *i* is the author's row *i*.
 */
function jsonCoordinates(shape: ShapeName, payload: unknown): CoordinateRow[] {
  switch (shape) {
    case 'feature':
      // `featuresJson` has already normalised `begin` to `start`.
      return (payload as FeatureRecord[]).map((r, i) =>
        coordinateRow(shape, i, r)
      );
    case 'point':
      return (
        (payload as Array<{ values?: PointRecord[] }>)[0]?.values ?? []
      ).map((r, i) => coordinateRow(shape, i, r));
    case 'variation':
      // `toVariants` sets `start = position`.
      return (payload as { variants: Array<{ start: number }> }).variants.map(
        (v, i) => ({ row: i, fields: [['position', v.start]] })
      );
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
  /**
   * When given, receives one entry per decoded record, in decode order: the
   * record's row number (as its decoder numbers rows) and its coordinates,
   * taken before any `filter:`. The returned payload is identical either way.
   */
  coordinates?: CoordinateRow[];
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
  const sink = opts.coordinates;
  const rowNumbers: number[] = [];
  const collect = (records: unknown[]) =>
    records.forEach((r, i) =>
      sink?.push(coordinateRow(shape, rowNumbers[i], r))
    );

  if (format === 'bed') {
    // BED decodes straight to feature records — its coordinate conversion is
    // part of reading the format, not of shaping it. `bed` is synchronous;
    // `AdapterFunction` just types it loosely.
    const records = bed(body, formatLabel, rowNumbers) as FeatureRecord[];
    collect(records);
    return records;
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
    const records = fromDelimited(
      shape,
      body,
      delimiter,
      formatLabel,
      rowNumbers
    );
    collect(records);
    return wrap(shape, records);
  }

  const payload = fromJson(shape, body, formatLabel);
  if (sink) for (const row of jsonCoordinates(shape, payload)) sink.push(row);
  return payload;
}
