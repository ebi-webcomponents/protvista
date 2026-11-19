/**
 * Shared parser core for the delimited (CSV/TSV) readers and `bed`.
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
 *     Every other column is kept on the record (see `./feature-fields`).
 *   - `rowsToPointRecords()` is its sibling for the graph kinds: the same
 *     header/ragged/number discipline over a `position,value` header,
 *     emitting the `{ position, value }` records `linegraph` consumes.
 *     A second layer rather than an option on the first, because the two
 *     share no columns and nothing but the validation grammar.
 *   - `parseDecimal()` is the shared strict-number validator, reused by
 *     `bed` for its `score` column so the number grammars can't drift.
 *   - `suspectDelimiter()` diagnoses a header that fails the required-columns
 *     check because the file uses a different delimiter from the one its
 *     format implies. It is diagnosis only: the format alone picks the
 *     delimiter (`DELIMITERS` in `./pipeline`), and nothing here ever
 *     re-reads a file with another one.
 *
 * We deliberately hand-roll the tokenizer rather than pull in
 * `d3-dsv`/`papaparse`: it is small and stable, the shipped web-component
 * bundle stays lean, and — crucially — owning the scanner is what lets us
 * emit the "row N, column X" errors the tickets require, which no
 * off-the-shelf parser produces.
 */

import {
  FEATURE_CANONICAL_FIELDS,
  RenderFieldCollector,
  checkSpan,
  classifyExtraField,
  type DecodeWarning,
} from './feature-fields.js';

/** One parsed feature record, matching the shape Nightingale tracks consume. */
export interface FeatureRecord {
  type: string;
  start: number;
  end: number;
  description?: string;
  score?: number;
}

/**
 * A feature record decoded from an author's CSV, TSV or JSON file: the
 * canonical fields plus whatever else the file carried. The four render
 * fields are typed because Nightingale reads them per record; every other
 * extra is opaque data for `dataTooltip`.
 *
 * Kept separate from {@link FeatureRecord} so `bed()` — whose columns are
 * positional and carry no extras — still returns the canonical shape, and
 * the type checker holds it to that.
 */
export type AuthoredFeatureRecord = FeatureRecord & {
  color?: string;
  shape?: string;
  fill?: string;
  opacity?: number;
  [field: string]: unknown;
};

/** A delimiter a header may turn out to use, for {@link suspectDelimiter}. */
export type Delimiter = ',' | '\t' | ';';

/**
 * Raised when a delimited header lacks a column its shape requires.
 *
 * Typed so `runPipeline` can recognise this one failure — and only this one —
 * and append a delimiter hint without matching on message text. `required`
 * is the shape's full required list; `suspectedDelimiter` is set only on the
 * hinted rethrow, never by the builders that raise it first.
 */
export class MissingHeaderColumnError extends Error {
  constructor(
    message: string,
    public readonly column: string,
    public readonly required: readonly string[],
    public readonly suspectedDelimiter?: Delimiter
  ) {
    super(message);
    this.name = 'MissingHeaderColumnError';
    Object.setPrototypeOf(this, MissingHeaderColumnError.prototype);
  }
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

const CANDIDATE_DELIMITERS: readonly Delimiter[] = [',', '\t', ';'];

/**
 * The delimiter `text`'s header seems to use instead of `used`, or
 * `undefined` when nothing points to a mismatch.
 *
 * Called only after a header has failed the required-columns check. Each
 * other candidate (comma, tab, semicolon) re-tokenises the header through
 * {@link parseDelimited}, so quoting rules hold — Excel's
 * `"type";"start";…` splits cleanly under `;`. A candidate qualifies when
 * either:
 *
 *   (a) its header contains every `required` column; or
 *   (b) `used` read the header as a single cell and the candidate splits it
 *       into two or more. A one-cell header that another delimiter splits is
 *       near-conclusive, and this is what catches `Type;Start;End;Description`,
 *       which (a) misses on case.
 *
 * A candidate passing (a) wins, then the one giving more cells, then
 * candidate order. A genuinely missing column under the right delimiter
 * qualifies no candidate, so it never gets a misleading hint.
 */
export function suspectDelimiter(
  text: string,
  used: string,
  required: readonly string[]
): Delimiter | undefined {
  const headerOf = (delimiter: string) =>
    (parseDelimited(text, delimiter)[0] ?? []).map((cell) => cell.trim());
  const declaredCells = headerOf(used).length;

  let best:
    { delimiter: Delimiter; complete: boolean; cells: number } | undefined;
  for (const delimiter of CANDIDATE_DELIMITERS) {
    if (delimiter === used) continue;
    const header = headerOf(delimiter);
    const complete = required.every((col) => header.includes(col));
    const splits = declaredCells === 1 && header.length >= 2;
    if (!complete && !splits) continue;
    if (
      best === undefined ||
      (complete && !best.complete) ||
      (complete === best.complete && header.length > best.cells)
    ) {
      best = { delimiter, complete, cells: header.length };
    }
  }
  return best?.delimiter;
}

/**
 * Whether a tokenized row is a blank line rather than data.
 *
 * `parseDelimited` deliberately preserves every physical record so errors can
 * name a 1-based line number, which means a blank line arrives as `['']`.
 * Skipping it here rather than there keeps the line numbering honest while
 * accepting the files people actually have: a trailing newline-terminated
 * blank line is what most spreadsheet exports produce, and rejecting the
 * whole file for it — `row 4 is ragged` — fails the least technical authors
 * at the first step. `bed.ts` already skips blank lines; this brings the
 * delimited parsers in line with it.
 *
 * A row of empty cells (`,,` or `\t\t`) counts as blank too. Spreadsheets
 * write cleared rows inside the used range that way, and they have the
 * header's column count, so without this they pass the ragged check and
 * then fail as `expected a number, got ""`.
 */
function isBlankRow(cells: readonly string[]): boolean {
  return cells.every((cell) => cell.trim() === '');
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
 * Throw unless an already-parsed coordinate is a whole number. The message
 * quotes the untrimmed cell, as the "expected a number" errors do.
 */
function wholeNumber(
  cells: string[],
  index: Map<string, number>,
  col: string,
  n: number,
  line: number,
  formatLabel: string
): void {
  if (Number.isInteger(n)) return;
  throw new Error(
    `${formatLabel}: row ${line}, column "${col}": expected a whole number, ` +
      `got "${cells[index.get(col) as number]}".`
  );
}

/**
 * Turn tokenized rows (header + data) into feature records.
 *
 * The header row must contain `type`, `start`, `end`, and `description`
 * (in any order, no duplicates); `score` is optional. Every data row must
 * have exactly as many fields as the header. `start`/`end` are coerced to
 * decimal numbers, must be finite whole numbers, and `end` may not precede
 * `start` (equal endpoints — a single residue — are fine, as in BED);
 * `score`, when the column is present and the cell is non-empty, is coerced
 * and validated but may be any decimal.
 *
 * On any violation this throws with a message naming the offending row (by
 * 1-based line number, header = line 1) and, where meaningful, the column —
 * e.g. `./hits.csv (parsed as CSV): row 3, column "start": expected a number,
 * got "abc"`. The loader's per-track try/catch records the throw as that track's
 * failure and leaves the track empty, so one bad file degrades one row. The
 * element routes it like any other track failure: this message is the ⚠
 * badge's text, the `protvista-error` event's `message`, and the console line
 * — so the author sees which row and column to fix without opening the
 * console.
 *
 * A missing required column throws {@link MissingHeaderColumnError}, which
 * `runPipeline` extends with a delimiter hint when the header looks like it
 * uses a different delimiter (see {@link suspectDelimiter}).
 *
 * Every other column is kept on the record, keyed by its trimmed header
 * name, in header order after the canonical fields (`./feature-fields` has
 * the rule):
 *
 *   - `color`, `shape`, `fill` are trimmed and `opacity` is coerced to a
 *     number from 0 to 1 (anything else is a row/column error); a blank cell
 *     leaves the field off, so the track's `rendering:` still applies to that
 *     row.
 *   - Any other column is kept as the verbatim cell string — untrimmed, and
 *     `''` when blank, so the column exists on every row.
 *   - `tooltipContent`, `locations`, `residuesToHighlight` and names on
 *     `Object.prototype` are dropped; an empty header name is dropped
 *     silently.
 *
 * `opts.rowNumbers`, when given, is an out-array: it receives each returned
 * record's row number (same numbering as the errors), in the same order as
 * the returned records. Skipped blank rows add nothing.
 *
 * `opts.warnings`, when given, is an out-array too: it receives at most one
 * `data-field-ignored` warning for the dropped column names, one more for
 * `shape` values dropped because they name an `Object.prototype` property
 * (`isReservedShape`), and one `unpaintable-color` warning (the `color` /
 * `fill` values a browser will not paint, which are still kept). Nothing is
 * logged either way; a call that throws pushes nothing.
 */
export function rowsToFeatureRecords(
  rows: string[][],
  opts: {
    formatLabel: string;
    rowNumbers?: number[];
    warnings?: DecodeWarning[];
  }
): AuthoredFeatureRecord[] {
  const { formatLabel } = opts;

  if (rows.length === 0) return [];

  const header = rows[0];
  // A `Map`, not an object literal: `'toString' in {}` is true, so a column
  // legitimately named `toString` / `constructor` / `valueOf` would be
  // rejected as a duplicate, and `__proto__` would not record an index at all.
  const index = new Map<string, number>();
  header.forEach((name, i) => {
    const key = name.trim();
    if (index.has(key)) {
      throw new Error(
        `${formatLabel}: duplicate header column "${key}". ` +
          `Each column name must be unique.`
      );
    }
    index.set(key, i);
  });

  for (const col of REQUIRED_COLUMNS) {
    if (!index.has(col)) {
      throw new MissingHeaderColumnError(
        `${formatLabel}: missing required header column "${col}". ` +
          `Header must contain type, start, end, description[, score].`,
        col,
        REQUIRED_COLUMNS
      );
    }
  }
  const { extras, blocked } = planExtraColumns(index);
  const plan: FeatureRowPlan = {
    formatLabel,
    index,
    width: header.length,
    hasScore: index.has('score'),
    extras,
  };
  // Collects the warnings, which are pushed only once every row has
  // decoded: a file that throws reports its error alone.
  const fields = new RenderFieldCollector(formatLabel, parseDecimal);
  for (const name of blocked) fields.block(name);

  const records: AuthoredFeatureRecord[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const line = r + 1; // header is line 1

    if (isBlankRow(cells)) continue;

    records.push(decodeRow(cells, line, plan, fields));
    opts.rowNumbers?.push(line);
  }

  fields.flush(opts.warnings);
  return records;
}

/** What {@link decodeRow} needs from a feature file's header, worked out once. */
type FeatureRowPlan = {
  formatLabel: string;
  index: ReadonlyMap<string, number>;
  /** The header's column count, which every data row must match. */
  width: number;
  hasScore: boolean;
  extras: ReturnType<typeof planExtraColumns>['extras'];
};

/**
 * Decode one non-blank data row (1-based `line`) into a feature record, or
 * throw naming the row and, where meaningful, the column. Render fields go
 * through `fields`, which collects the warnings for the whole file.
 */
function decodeRow(
  cells: string[],
  line: number,
  plan: FeatureRowPlan,
  fields: RenderFieldCollector
): AuthoredFeatureRecord {
  const { formatLabel, index } = plan;
  if (cells.length !== plan.width) {
    throw new Error(
      `${formatLabel}: row ${line} is ragged — expected ${plan.width} ` +
        `columns, got ${cells.length}.`
    );
  }
  const where = `row ${line}`;

  const startCell = cells[index.get('start') as number];
  const endCell = cells[index.get('end') as number];
  const record: AuthoredFeatureRecord = {
    type: cells[index.get('type') as number],
    start: cellNumber(startCell, 'start', formatLabel, where),
    end: cellNumber(endCell, 'end', formatLabel, where),
  };

  // Coordinates must be whole residues; checked after both parse so a
  // non-number start or end is reported first.
  checkSpan(formatLabel, where, record.start, record.end, startCell, endCell);

  const description = cells[index.get('description') as number];
  if (description !== '') record.description = description;

  if (plan.hasScore) {
    const rawScore = cells[index.get('score') as number];
    if (rawScore.trim() !== '') {
      record.score = cellNumber(rawScore, 'score', formatLabel, where);
    }
  }

  // Extras last, after every canonical check, so a coordinate error is
  // still the one reported for a row that has both.
  for (const { name, i, render } of plan.extras) {
    if (render) {
      fields.apply(record, name, cells[i], where);
    } else {
      // Safe as plain assignment: every `Object.prototype` name was
      // classified as blocked and is not in the plan.
      record[name] = cells[i];
    }
  }
  return record;
}

/** Parse cell `raw` of column `col` as a decimal, or throw naming both. */
function cellNumber(
  raw: string,
  col: string,
  formatLabel: string,
  where: string
): number {
  const n = parseDecimal(raw);
  if (n !== null) return n;
  throw new Error(
    `${formatLabel}: ${where}, column "${col}": expected a number, ` +
      `got "${raw}".`
  );
}

/**
 * The non-canonical columns a feature file carries, in header order, plus
 * the blocked names it dropped. Built once per file rather than per row.
 */
function planExtraColumns(index: ReadonlyMap<string, number>): {
  extras: Array<{ name: string; i: number; render: boolean }>;
  blocked: string[];
} {
  const extras: Array<{ name: string; i: number; render: boolean }> = [];
  const blocked: string[] = [];
  // A `Map` iterates in insertion order, which is header order.
  for (const [name, i] of index) {
    if (FEATURE_CANONICAL_FIELDS.has(name)) continue;
    const group = classifyExtraField(name);
    if (group === 'blocked') blocked.push(name);
    else if (group !== 'skip')
      extras.push({ name, i, render: group === 'render' });
  }
  return { extras, blocked };
}

/** One parsed graph point, matching the shape `linegraph` series carry. */
export interface PointRecord {
  position: number;
  value: number;
}

/**
 * Header columns a delimited (CSV/TSV) line-graph file must declare.
 * Exported so the generated adapter reference can be pinned to the
 * parser's actual requirement by a drift test, exactly as
 * {@link REQUIRED_COLUMNS} is for the feature formats.
 */
export const POINT_COLUMNS = ['position', 'value'] as const;

/**
 * Turn tokenized rows (header + data) into `PointRecord`s.
 *
 * The sibling of {@link rowsToFeatureRecords} for the graph kinds, with
 * the same discipline: the header must contain `position` and `value` (in
 * any order, no duplicates), every data row must have exactly as many
 * fields as the header, and both cells are coerced through
 * {@link parseDecimal} so the number grammar cannot drift between the
 * feature and graph formats. `position` must be a whole number; `value`
 * may be any decimal. Extra columns are permitted and ignored — unlike
 * the feature layer, which keeps them for `dataTooltip`; a graph point has
 * no per-item hover to show them in.
 *
 * Rows are returned in file order — `linegraph` draws points in the order
 * it receives them and neither sorts nor de-duplicates, so the file's
 * order is the rendered order.
 *
 * Errors name the offending row by 1-based line number (header = line 1)
 * and the column, e.g.
 * `linegraph-csv: row 3, column "value": expected a number, got "abc"`.
 *
 * `opts.rowNumbers`, when given, is an out-array: it receives each returned
 * record's row number (same numbering as the errors), in the same order as
 * the returned records. Skipped blank rows add nothing.
 */
export function rowsToPointRecords(
  rows: string[][],
  opts: { formatLabel: string; rowNumbers?: number[] }
): PointRecord[] {
  const { formatLabel } = opts;

  if (rows.length === 0) return [];

  const header = rows[0];
  // A `Map`, not an object literal: `'toString' in {}` is true, so a column
  // legitimately named `toString` / `constructor` / `valueOf` would be
  // rejected as a duplicate, and `__proto__` would not record an index at all.
  const index = new Map<string, number>();
  header.forEach((name, i) => {
    const key = name.trim();
    if (index.has(key)) {
      throw new Error(
        `${formatLabel}: duplicate header column "${key}". ` +
          `Each column name must be unique.`
      );
    }
    index.set(key, i);
  });

  for (const col of POINT_COLUMNS) {
    if (!index.has(col)) {
      throw new MissingHeaderColumnError(
        `${formatLabel}: missing required header column "${col}". ` +
          `Header must contain position, value.`,
        col,
        POINT_COLUMNS
      );
    }
  }

  const records: PointRecord[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const line = r + 1; // header is line 1

    if (isBlankRow(cells)) continue;

    if (cells.length !== header.length) {
      throw new Error(
        `${formatLabel}: row ${line} is ragged — expected ${header.length} ` +
          `columns, got ${cells.length}.`
      );
    }

    const num = (col: string): number => {
      const raw = cells[index.get(col) as number];
      const n = parseDecimal(raw);
      if (n === null) {
        throw new Error(
          `${formatLabel}: row ${line}, column "${col}": expected a number, ` +
            `got "${raw}".`
        );
      }
      return n;
    };

    const record: PointRecord = {
      position: num('position'),
      value: num('value'),
    };
    wholeNumber(cells, index, 'position', record.position, line, formatLabel);
    records.push(record);
    opts.rowNumbers?.push(line);
  }

  return records;
}

/** One parsed residue change, matching the shape `variation` records carry. */
export interface VariationRecord {
  position: number;
  variant: string;
  wildType?: string;
  description?: string;
  consequence?: string;
}

/**
 * Header columns a delimited (CSV/TSV) variation file must declare.
 * `wildType`, `description`, and `consequence` are accepted as optional
 * extra columns. Exported so the generated adapter reference can be pinned
 * to the parser's actual requirement by a drift test, exactly as
 * {@link REQUIRED_COLUMNS} and {@link POINT_COLUMNS} are for the other two
 * record shapes.
 */
export const VARIATION_COLUMNS = ['position', 'variant'] as const;

/** The optional columns a variation file may add. */
export const VARIATION_OPTIONAL_COLUMNS = [
  'wildType',
  'description',
  'consequence',
] as const;

/**
 * Turn tokenized rows (header + data) into `VariationRecord`s.
 *
 * The third sibling of {@link rowsToFeatureRecords} / {@link rowsToPointRecords},
 * with the same discipline: the header must contain `position` and `variant`
 * (in any order, no duplicates), every data row must have exactly as many
 * fields as the header, and `position` is coerced through
 * {@link parseDecimal} and must be a whole number. Extra columns beyond the
 * documented optional ones are permitted and ignored.
 *
 * `variant` is a string, not a number — it is the residue (or residues) the
 * position changes to, `*` for a stop, `-` for a deletion. It is required to
 * be non-empty because an empty cell would silently render as "no change".
 *
 * Errors name the offending row by 1-based line number (header = line 1) and
 * the column, e.g.
 * `variation-csv: row 3, column "position": expected a number, got "abc"`.
 *
 * `opts.rowNumbers`, when given, is an out-array: it receives each returned
 * record's row number (same numbering as the errors), in the same order as
 * the returned records. Skipped blank rows add nothing.
 */
export function rowsToVariationRecords(
  rows: string[][],
  opts: { formatLabel: string; rowNumbers?: number[] }
): VariationRecord[] {
  const { formatLabel } = opts;

  if (rows.length === 0) return [];

  const header = rows[0];
  const index = new Map<string, number>();
  header.forEach((name, i) => {
    const key = name.trim();
    if (index.has(key)) {
      throw new Error(
        `${formatLabel}: duplicate header column "${key}". ` +
          `Each column name must be unique.`
      );
    }
    index.set(key, i);
  });

  for (const col of VARIATION_COLUMNS) {
    if (!index.has(col)) {
      throw new MissingHeaderColumnError(
        `${formatLabel}: missing required header column "${col}". ` +
          `Header must contain ${VARIATION_COLUMNS.join(', ')}.`,
        col,
        VARIATION_COLUMNS
      );
    }
  }

  const records: VariationRecord[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const line = r + 1; // header is line 1

    if (isBlankRow(cells)) continue;

    if (cells.length !== header.length) {
      throw new Error(
        `${formatLabel}: row ${line} is ragged — expected ${header.length} ` +
          `columns, got ${cells.length}.`
      );
    }

    const cell = (col: string): string | undefined => {
      const i = index.get(col);
      return i === undefined ? undefined : cells[i].trim();
    };

    const rawPosition = cells[index.get('position') as number];
    const position = parseDecimal(rawPosition);
    if (position === null) {
      throw new Error(
        `${formatLabel}: row ${line}, column "position": expected a number, ` +
          `got "${rawPosition}".`
      );
    }
    wholeNumber(cells, index, 'position', position, line, formatLabel);

    const variant = cell('variant') ?? '';
    if (variant === '') {
      throw new Error(
        `${formatLabel}: row ${line}, column "variant": expected the residue ` +
          `the position changes to (e.g. "K", "*" for a stop, "-" for a ` +
          `deletion); got an empty cell.`
      );
    }

    const record: VariationRecord = { position, variant };
    for (const col of VARIATION_OPTIONAL_COLUMNS) {
      const v = cell(col);
      if (v !== undefined && v !== '') {
        record[col] = v;
      }
    }
    records.push(record);
    opts.rowNumbers?.push(line);
  }

  return records;
}
