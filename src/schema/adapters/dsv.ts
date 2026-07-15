/**
 * Shared parser core for the delimited generic-format adapters
 * (`features-csv`, `features-tsv`, and — when it lands — `bed`).
 *
 * Two independent pieces live here so they can be reused without
 * dragging the feature-mapping opinions along:
 *
 *   - `parseDelimited()` is a format-agnostic RFC-4180 tokenizer. It
 *     knows about quoting and delimiters, nothing about ProtVista
 *     features. `bed` (tab-delimited, headerless, positional columns)
 *     can reuse it directly.
 *   - `rowsToFeatureRecords()` layers the ProtVista feature convention
 *     on top: a required `type,start,end,description[,score]` header,
 *     numeric coercion, and strict, row/column-named error reporting.
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
  let sawAnyChar = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    sawAnyChar = true;

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
    } else if (c === delimiter) {
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else if (c === '\r') {
      // Swallow CR; the following LF (if any) closes the row.
      if (text[i + 1] === '\n') i++;
      pushRow();
    } else {
      field += c;
    }
  }

  // Flush the final record unless the text ended exactly on a row break
  // (i.e. there is no dangling partial row to emit). An empty input
  // yields no rows at all.
  if (field !== '' || row.length > 0 || (sawAnyChar && rows.length === 0)) {
    pushRow();
  }

  return rows;
}

const REQUIRED_COLUMNS = ['type', 'start', 'end', 'description'] as const;

/**
 * Turn tokenized rows (header + data) into `FeatureRecord`s.
 *
 * The header row must contain `type`, `start`, `end`, and `description`
 * (in any order); `score` is optional. Every data row must have exactly
 * as many fields as the header. `start`/`end` are coerced to numbers and
 * must be finite; `score`, when the column is present and the cell is
 * non-empty, is likewise coerced and validated.
 *
 * On any violation this throws with a message naming the offending row
 * (by 1-based line number, header = line 1) and column, e.g.
 * `features-csv: row 3, column "start": expected a number, got "abc"`.
 * The loader's per-track try/catch turns that throw into the track's
 * parse-failure surface (⚠ badge / `protvista-error`), so a bad file
 * degrades one track rather than taking the viewer down.
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
    index[name.trim()] = i;
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
      const n = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(n)) {
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
        const s = Number(rawScore);
        if (!Number.isFinite(s)) {
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
