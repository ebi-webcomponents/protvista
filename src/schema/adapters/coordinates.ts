/**
 * Sequence-bounds check for bring-your-own-data tracks.
 *
 * The decoders reject coordinates that are wrong on their own terms — a
 * fractional `start`, an `end` before its `start` — but they cannot know the
 * protein. A 0-based export or isoform numbering passes every shape-level
 * check and then draws a *wrong* picture. Once the entry's sequence has
 * loaded, this module counts the rows whose `start`, `end`, or `position`
 * falls below 1 or past the last residue, and words the warning the author
 * sees.
 *
 * Row numbers travel beside the renderer payload, never inside it: an extra
 * scalar on a feature record would show up in its auto-fallback tooltip.
 * The loader collects them before `filter:` (so every track reading a file
 * counts the file's rows), and the component runs the check once both the
 * sequence and the track's data are present.
 */

import type { DataFormat, ShapeName } from '../types.js';

/** A coordinate field as the author names it. A `begin` alias is `start`. */
export type CoordinateField = 'start' | 'end' | 'position';

/** One authored row's coordinates, numbered the way its decoder numbers rows. */
export interface CoordinateRow {
  /** CSV/TSV row (header = 1), BED physical line, or 0-based JSON/inline index. */
  row: number;
  /** In message order: `start` before `end`; point/variation carry only `position`. */
  fields: ReadonlyArray<readonly [CoordinateField, number]>;
}

/** What the bounds check needs about one track, taken before `filter:`. */
export interface TrackCoordinates {
  /** `sourceLabel()` of the author's source and format. */
  label: string;
  shape: ShapeName;
  format: DataFormat;
  /** Every decoded row (M = rows.length). */
  rows: CoordinateRow[];
  /** The substituted URL the track fetched; absent for inline data. */
  url?: string;
}

export interface OutOfRange {
  /** N: rows with at least one out-of-range field (each row counted once). */
  count: number;
  /** M: every row checked. */
  total: number;
  /** The first offending row, carrying only its out-of-range fields. */
  first: CoordinateRow;
}

/**
 * Count the rows with a coordinate below 1 or past `length`. Returns `null`
 * when every row is in range, since no warning is emitted for N = 0.
 */
export function findOutOfRange(
  rows: readonly CoordinateRow[],
  length: number
): OutOfRange | null {
  const outside = (value: number) => value < 1 || value > length;
  let count = 0;
  let first: CoordinateRow | undefined;
  for (const r of rows) {
    if (!r.fields.some(([, value]) => outside(value))) continue;
    count += 1;
    first ??= {
      row: r.row,
      fields: r.fields.filter(([, value]) => outside(value)),
    };
  }
  return first === undefined ? null : { count, total: rows.length, first };
}

/**
 * The one-line hint for the two classic causes. BED is 0-based by definition
 * and converted on read, so its hint drops the 0-based clause; point and
 * variation rows carry `position`, so their hint names that field.
 */
export function coordinateHint(shape: ShapeName, format: DataFormat): string {
  if (format === 'bed') {
    return "Coordinates must be positions on this protein's canonical sequence — check for isoform numbering.";
  }
  const field = shape === 'feature' ? 'start' : 'position';
  return (
    "Coordinates must be 1-based positions on this protein's canonical " +
    `sequence — check for 0-based coordinates (${field} 0) or isoform numbering.`
  );
}

/**
 * The warning text, e.g.
 *
 *   ./hits.csv (parsed as CSV): 12 of 340 rows fall outside P05067 (770
 *   residues); first: row 7, end 812. Coordinates must be 1-based …
 *
 * The wording is fixed, so the count always reads "rows".
 */
export function formatOutOfRangeWarning(
  coords: Pick<TrackCoordinates, 'label' | 'shape' | 'format'>,
  accession: string,
  length: number,
  found: OutOfRange
): string {
  const fields = found.first.fields
    .map(([name, value]) => `${name} ${value}`)
    .join(', ');
  return (
    `${coords.label}: ${found.count} of ${found.total} rows fall outside ` +
    `${accession} (${length} residues); first: row ${found.first.row}, ` +
    `${fields}. ${coordinateHint(coords.shape, coords.format)}`
  );
}
