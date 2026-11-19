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
 * different ways depending on where it entered.
 *
 * `formatLabel` is threaded through rather than derived so a caller can name
 * the input in the author's own terms: the file path they wrote, or "inline
 * data" when there is no path to name.
 *
 * A caller may also pass a `coordinates` sink to collect each decoded row's
 * coordinates and row number, for the sequence-bounds warning
 * (`./coordinates`), without touching the payload. A `warnings` sink
 * likewise collects a feature decoder's findings (columns it dropped,
 * colours a browser will not paint) instead of the decoder logging them.
 */

import type { DataFormat, ShapeName } from '../types.js';
import { SHAPES } from '../shapes.js';
import { DATA_FORMATS, formatForPath } from '../file-formats.js';
import {
  MissingHeaderColumnError,
  parseDelimited,
  rowsToFeatureRecords,
  rowsToPointRecords,
  rowsToVariationRecords,
  suspectDelimiter,
  type Delimiter,
  type FeatureRecord,
  type PointRecord,
} from './dsv.js';
import { featuresJson } from './features-json.js';
import { linegraph, toSeries } from './linegraph.js';
import { variation, toVariants } from './variation.js';
import { bed } from './bed.js';
import type { CoordinateRow } from './coordinates.js';
import type { DecodeWarning } from './feature-fields.js';

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
 * receives each record's row number in record order; `warnings` receives
 * the feature decoder's warnings (the other shapes have none).
 */
function fromDelimited(
  shape: ShapeName,
  text: string,
  delimiter: string,
  formatLabel: string,
  rowNumbers?: number[],
  warnings?: DecodeWarning[]
): unknown[] {
  const rows = parseDelimited(text, delimiter);
  switch (shape) {
    case 'feature':
      return rowsToFeatureRecords(rows, { formatLabel, rowNumbers, warnings });
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
  formatLabel: string,
  warnings?: DecodeWarning[]
): unknown {
  switch (shape) {
    case 'feature':
      return featuresJson(body, formatLabel, warnings);
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
 * debugging an unexpected parse error needs to see. When a header fails
 * because the file seems to use another delimiter, `runPipeline` appends a
 * hint after the message (see {@link delimiterHint}).
 */
export function sourceLabel(
  source: string | undefined,
  format: DataFormat
): string {
  const what = source === undefined || source === '' ? 'inline data' : source;
  return `${what} (parsed as ${format.toUpperCase()})`;
}

/** The shared opening of both semicolon hints in {@link delimiterHint}. */
const SEMICOLON_LEAD =
  'The header looks semicolon-separated, which ProtVista does not read. ' +
  'If it came from Excel, ';

/**
 * The sentence appended to a missing-column error whose header seems to use
 * `suspected` rather than the delimiter `declared` implies.
 *
 * `format:` is always the first remedy: an explicit `format:` wins over the
 * extension, so it is the one fix that works for every source. Renaming is
 * offered as well only when the source is a path whose extension implies the
 * format it was read as — then a new extension changes the reading, unless an
 * explicit `format:` also pins it (the pipeline cannot tell, which is why
 * `format:` comes first). Inline data and extensionless URLs get `format:`
 * alone.
 *
 * No `format:` value reads semicolons, so that hint points at Excel's
 * locale-independent "Text (Tab delimited)" export instead; its "CSV" export
 * uses the locale's list separator and would write semicolons again.
 */
function delimiterHint(
  suspected: Delimiter,
  declared: DataFormat,
  source: string | undefined
): string {
  const renamable =
    source !== undefined &&
    source !== '' &&
    formatForPath(source)?.name === declared;
  if (suspected === ';' && declared === 'tsv') {
    // Already read as TSV, so "read it as TSV" is no remedy on its own: the
    // tab export must be re-saved, and a comma export must switch to CSV.
    return (
      SEMICOLON_LEAD +
      'save it again as "Text (Tab delimited)" and ' +
      'keep reading it as TSV (`format: tsv`), or re-export it ' +
      'comma-separated and read it as CSV: set `format: csv`' +
      (renamable ? ' (or rename the file to .csv)' : '') +
      '.'
    );
  }
  if (suspected === ';') {
    const how = renamable
      ? '`format: tsv` or a .tsv name — Excel names that export .txt'
      : '`format: tsv`';
    return (
      SEMICOLON_LEAD +
      'save it as "Text (Tab delimited)" and read it ' +
      `as TSV (${how}), or re-export it comma-separated.`
    );
  }
  const [name, format] = suspected === '\t' ? ['tab', 'tsv'] : ['comma', 'csv'];
  const rename = renamable ? ` (or rename the file to .${format})` : '';
  return (
    `The header looks ${name}-separated — read it as ` +
    `${format.toUpperCase()}: set \`format: ${format}\`${rename}.`
  );
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
  /**
   * When given, receives the feature decoder's warnings — at most one
   * `data-field-ignored` for columns it dropped, one for `shape` values it
   * dropped, and one `unpaintable-color` (colours it kept but a browser will
   * not paint) per call. Nothing is logged without it; the returned payload
   * is identical either way.
   */
  warnings?: DecodeWarning[];
}

/**
 * Run one source body through the pipeline for a (shape, format) pair.
 *
 * Throws `ShapeFormatMismatchError` when the format cannot produce the
 * shape's records, and the decoder's own row/column-named error when the
 * bytes are malformed. A delimited header missing a required column throws
 * `MissingHeaderColumnError`; when the header looks like it uses another
 * delimiter, the message gains a one-line hint naming it and the fix. The
 * delimiter itself is never switched — only the message changes.
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
    let records: unknown[];
    try {
      records = fromDelimited(
        shape,
        body,
        delimiter,
        formatLabel,
        rowNumbers,
        opts.warnings
      );
    } catch (err) {
      if (!(err instanceof MissingHeaderColumnError)) throw err;
      const suspected = suspectDelimiter(body, delimiter, err.required);
      if (suspected === undefined) throw err;
      throw new MissingHeaderColumnError(
        `${err.message} ${delimiterHint(suspected, format, opts.source)}`,
        err.column,
        err.required,
        suspected
      );
    }
    collect(records);
    return wrap(shape, records);
  }

  const payload = fromJson(shape, body, formatLabel, opts.warnings);
  if (sink) for (const row of jsonCoordinates(shape, payload)) sink.push(row);
  return payload;
}
