/**
 * Shared parser core for the delimited generic-format adapters
 * (`features-csv`, `features-tsv`, and `bed`).
 *
 * Three independent pieces live here so they can be reused without
 * dragging the feature-mapping opinions along:
 *
 *   - `parseDelimited()` is a format-agnostic RFC-4180 tokenizer. It
 *     knows about quoting and delimiters, nothing about ProtVista
 *     features. `bed` does *not* use it — BED is headerless and
 *     positional with no quoting to honour, so `bed` hand-splits on
 *     tabs and shares only `parseDecimal` and the `FeatureRecord` shape
 *     from this module.
 *   - `rowsToFeatureRecords()` layers the ProtVista feature convention
 *     on top: a required `type,start,end,description[,score]` header,
 *     numeric coercion, and strict, row/column-named error reporting.
 *   - `parseDecimal()` is the shared strict-number validator, reused by
 *     `bed` for its `score` column so the number grammars can't drift.
 *
 * We deliberately hand-roll the tokenizer rather than pull in
 * `d3-dsv`/`papaparse`: it is small and stable, the shipped web-component
 * bundle stays lean, and — crucially — owning the scanner is what lets us
 * emit the "row N, column X" errors the tickets require, which no
 * off-the-shelf parser produces.
 */

/** One parsed feature record, matching the shape Nightingale tracks consume. */
export interface FeatureRecord {
  type: string;
  start: number;
  end: number;
  description?: string;
  score?: number;
}

/**
 * Tokenize delimited text into rows of string fields per RFC 4180.
 *
 * Handles quoted fields (`"..."`), escaped quotes inside them (`""`),
 * delimiters and newlines embedded in quoted fields, and both `\n` and
 * `\r\n` line endings. A single trailing newline is ignored (it does not
 * produce a spurious empty final row); a genuinely blank line in the
 * middle yields a one-element `['']` row, which the feature layer treats
 * as ragged and rejects.
 *
 * The returned array preserves every physical record in order, so the
 * caller can address rows by 1-based line number for error messages.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  // Whether the current row has consumed any content (a field char, a
  // delimiter, or an opening quote) since the last row break. Drives the
  // final flush: a row that has started but not been terminated by a
  // newline is emitted, while a trailing newline leaves nothing pending.
  // A quoted-empty final field (`""`) counts as started, so it is not lost.
  let rowStarted = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    rowStarted = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      rowStarted = true;
    } else if (c === delimiter) {
      pushField();
      rowStarted = true;
    } else if (c === '\n') {
      pushRow();
    } else if (c === '\r') {
      // Swallow CR; the following LF (if any) closes the row.
      if (text[i + 1] === '\n') i++;
      pushRow();
    } else {
      field += c;
      rowStarted = true;
    }
  }

  // Flush a dangling final row (input that did not end on a row break).
  // A trailing newline leaves `rowStarted` false, so no spurious empty
  // row is appended; empty input yields no rows at all.
  if (rowStarted) {
    pushRow();
  }

  return rows;
}

/**
 * Header columns a delimited (CSV/TSV) feature file must declare. `score`
 * is accepted as an optional extra column. Exported so the generated
 * adapter reference (`docs/adapter-reference.md`) can be pinned to the
 * parser's actual requirement by a drift test.
 */
export const REQUIRED_COLUMNS = ['type', 'start', 'end', 'description'] as const;

/**
 * A plain decimal number literal (optional sign, integer/fraction, optional
 * exponent). Deliberately stricter than `Number()`, which would silently
 * accept `0x10`, `0b1`, `0o7`, and `Infinity` — none of which is a sane
 * coordinate. A cell that fails this is reported as "expected a number".
 */
const DECIMAL = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/** Parse a trimmed decimal token, or `null` if it is empty / not decimal. */
export function parseDecimal(raw: string): number | null {
  const t = raw.trim();
  if (t === '' || !DECIMAL.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn tokenized rows (header + data) into `FeatureRecord`s.
 *
 * The header row must contain `type`, `start`, `end`, and `description`
 * (in any order, no duplicates); `score` is optional. Every data row must
 * have exactly as many fields as the header. `start`/`end` are coerced to
 * decimal numbers and must be finite; `score`, when the column is present
 * and the cell is non-empty, is likewise coerced and validated.
 *
 * On any violation this throws with a message naming the offending row (by
 * 1-based line number, header = line 1) and, where meaningful, the column —
 * e.g. `features-csv: row 3, column "start": expected a number, got "abc"`.
 * The loader's per-track try/catch catches the throw, emits a
 * `console.warn`, and renders that one track empty; the descriptive
 * message reaches the developer console so the file can be fixed. (It does
 * not currently raise a ⚠ badge / `protvista-error` event — a text body
 * that parses as text but is semantically malformed is invisible to the
 * fetch-level error surface. Surfacing adapter throws as track errors is a
 * follow-up.)
 */
export function rowsToFeatureRecords(
  rows: string[][],
  opts: { formatLabel: string }
): FeatureRecord[] {
  const { formatLabel } = opts;

  if (rows.length === 0) return [];

  const header = rows[0];
  const index: Record<string, number> = {};
  header.forEach((name, i) => {
    const key = name.trim();
    if (key in index) {
      throw new Error(
        `${formatLabel}: duplicate header column "${key}". ` +
          `Each column name must be unique.`
      );
    }
    index[key] = i;
  });

  for (const col of REQUIRED_COLUMNS) {
    if (!(col in index)) {
      throw new Error(
        `${formatLabel}: missing required header column "${col}". ` +
          `Header must contain type, start, end, description[, score].`
      );
    }
  }
  const hasScore = 'score' in index;

  const records: FeatureRecord[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const line = r + 1; // header is line 1

    if (cells.length !== header.length) {
      throw new Error(
        `${formatLabel}: row ${line} is ragged — expected ${header.length} ` +
          `columns, got ${cells.length}.`
      );
    }

    const num = (col: string): number => {
      const raw = cells[index[col]];
      const n = parseDecimal(raw);
      if (n === null) {
        throw new Error(
          `${formatLabel}: row ${line}, column "${col}": expected a number, ` +
            `got "${raw}".`
        );
      }
      return n;
    };

    const record: FeatureRecord = {
      type: cells[index.type],
      start: num('start'),
      end: num('end'),
    };

    const description = cells[index.description];
    if (description !== '') record.description = description;

    if (hasScore) {
      const rawScore = cells[index.score];
      if (rawScore.trim() !== '') {
        const s = parseDecimal(rawScore);
        if (s === null) {
          throw new Error(
            `${formatLabel}: row ${line}, column "score": expected a number, ` +
              `got "${rawScore}".`
          );
        }
        record.score = s;
      }
    }

    records.push(record);
  }

  return records;
}
