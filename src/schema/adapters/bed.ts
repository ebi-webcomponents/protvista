/**
 * `bed` — a generic-format adapter for standard BED (browser extensible
 * data), the canonical genomic-interval format.
 *
 * Parses a tab-separated BED body into the same feature records the
 * Nightingale track components render directly, so an author can point a
 * track at `./regions.bed` with no per-track glue.
 *
 * Unlike `features-csv` / `features-tsv`, BED is **headerless and
 * positional**: columns are addressed by index, not by a header row, and
 * there is no RFC-4180 quoting to honour — so this adapter splits lines
 * by hand rather than reusing `parseDelimited`. It shares the
 * `FeatureRecord` output shape with the delimited adapters via `./dsv`.
 *
 * Column mapping (BED3 minimum, up to BED6):
 *
 *   | BED column      | output                                         |
 *   | --------------- | ---------------------------------------------- |
 *   | 1 `chrom`       | dropped (single-sequence viewer; informational) |
 *   | 2 `chromStart`  | `start` — see coordinate conversion below       |
 *   | 3 `chromEnd`    | `end`   — see coordinate conversion below       |
 *   | 4 `name`        | `description`                                   |
 *   | 5 `score`       | `score` (passed through verbatim)               |
 *   | 6 `strand`, …   | dropped                                         |
 *
 * BED has no `type` column, so every record synthesises `type: 'BED'`,
 * keeping the track's `filter:` shortcut predictable (`filter: BED` shows
 * everything). Authors needing finer-grained typing pin a custom adapter.
 *
 * **Coordinate conversion is the load-bearing detail.** BED is 0-based,
 * half-open; the viewer is 1-based, inclusive. We shift on the way in so
 * downstream sees the same convention everywhere:
 *
 *     start = chromStart + 1        end = chromEnd
 *
 * e.g. a BED interval `100  200` becomes `start: 101, end: 200`.
 *
 * `score` is emitted verbatim (not renormalised to 0–1). The BED spec
 * nominally defines score as 0–1000, but real-world files routinely carry
 * out-of-range values (peak-caller `-10log10(q)`, p-values, signal), and
 * the standard tooling (`bedtools`, `pybedtools`) passes it through
 * unchanged — so dividing by 1000 would silently corrupt those files.
 *
 * On malformed input (fewer than 3 columns, or a non-numeric coordinate /
 * score) this throws a descriptive error naming the offending line. The
 * loader's per-track try/catch turns that into the track's parse-failure
 * surface (a `console.warn` + an empty track) rather than crashing the
 * viewer — matching the delimited adapters.
 */

import type { AdapterFunction } from '../types';
import { parseDecimal, type FeatureRecord } from './dsv';

/**
 * BED coordinates are non-negative integers, so we accept exactly that.
 * Deliberately stricter than `Number()`, which would coerce `0x10` and
 * `1.5` and silently shift features. (Score is *not* validated with this —
 * it uses the DSV siblings' `parseDecimal`, since real BED files carry
 * fractional / signed scores; see the score branch below.)
 */
const NON_NEGATIVE_INT = /^\d+$/;

/** Lines the BED spec allows as non-data: comments and browser/track headers. */
const HEADER_LINE = /^(?:track|browser|#)/i;

export const bed: AdapterFunction = (raw) => {
  if (typeof raw !== 'string') {
    console.warn(
      '[protvista] bed adapter: expected a text body; got ' +
        typeof raw +
        '. Treating as empty.'
    );
    return [];
  }

  const records: FeatureRecord[] = [];
  const lines = raw.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1; // 1-based physical line number for error messages.

    // Skip blank lines and BED comment / `track` / `browser` header lines.
    // Test the trimmed line so an indented comment is skipped too, not
    // mis-parsed as (malformed) data.
    const trimmed = line.trim();
    if (trimmed === '' || HEADER_LINE.test(trimmed)) continue;

    const cols = line.split('\t');
    if (cols.length < 3) {
      throw new Error(
        `bed: line ${lineNo}: expected at least 3 tab-separated columns ` +
          `(chrom, start, end), got ${cols.length}.`
      );
    }

    const start0 = parseCoord(cols[1], lineNo, 'start', 2);
    const end0 = parseCoord(cols[2], lineNo, 'end', 3);

    // BED is 0-based half-open; the viewer is 1-based inclusive.
    const record: FeatureRecord = {
      type: 'BED',
      start: start0 + 1,
      end: end0,
    };

    // BED4: name → description (skip an empty / placeholder `.` cell only
    // when it is genuinely empty; a literal `.` is a valid BED name so it
    // is preserved as-is).
    if (cols.length >= 4 && cols[3] !== '') record.description = cols[3];

    // BED5: score → score, passed through verbatim (no 0–1000 → 0–1 shift).
    // Validated with the DSV siblings' decimal grammar rather than the
    // integer coord rule: real BED files carry fractional / signed scores
    // (peak-caller `-10log10(q)`, p-values, signal), and this keeps the
    // number grammar identical to `features-csv` / `features-tsv`.
    if (cols.length >= 5 && cols[4].trim() !== '') {
      const s = parseDecimal(cols[4]);
      if (s === null) {
        throw new Error(
          `bed: line ${lineNo}: non-numeric score "${cols[4]}" (BED column 5).`
        );
      }
      record.score = s;
    }

    // BED6 strand and any further columns are dropped.

    records.push(record);
  }

  return records;
};

/**
 * Parse a BED coordinate cell into a non-negative integer, throwing a
 * line-named error when it is not one. `columnName` / `columnNo` make the
 * message point the author at the exact offending field.
 */
function parseCoord(
  raw: string,
  lineNo: number,
  columnName: 'start' | 'end',
  columnNo: number
): number {
  const t = raw.trim();
  if (!NON_NEGATIVE_INT.test(t)) {
    throw new Error(
      `bed: line ${lineNo}: non-numeric ${columnName} coordinate "${raw}" ` +
        `(BED column ${columnNo}).`
    );
  }
  return Number(t);
}
