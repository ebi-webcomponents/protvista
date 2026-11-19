/**
 * Which non-canonical fields a decoded feature record may carry.
 *
 * The CSV/TSV and JSON feature decoders keep every column or key an author
 * adds beyond `type, start, end, description, score`, so a file and the same
 * records written inline render the same way, and a `dataTooltip` that names
 * an extra column (say `gene`) finds it rather than silently showing nothing.
 * One rule, shared by both decoders, sorts each extra name into a group:
 *
 *   - **render** — `color`, `shape`, `fill`, `opacity`. Nightingale reads these
 *     per record ahead of the track's `rendering:`, so they are trimmed,
 *     type-checked, and left off when blank (a blank cell must not override the
 *     track's colour, and a blank `opacity` would paint the feature invisible).
 *   - **blocked** — names decoded data must never set: `tooltipContent` (the
 *     popover inserts it as raw HTML), `locations` / `residuesToHighlight` (the
 *     canvas iterates them and crashes on a string), and every name on
 *     `Object.prototype` (`__proto__` would replace the record's prototype;
 *     `toString` & co. would shadow methods downstream code calls). Dropped,
 *     and named in one warning per decode.
 *   - **skip** — the empty name a trailing delimiter leaves in a header.
 *     Dropped silently, as it always was.
 *   - **extra** — everything else, kept verbatim for `dataTooltip`.
 *
 * Structured inline records and `setTrackData()` payloads never pass through
 * here: they are trusted config and may still set the viewer fields.
 *
 * Nothing here logs. A decoder pushes the warnings below into the sink its
 * caller passed (`PipelineOptions.warnings`); the loader returns them and the
 * element routes each one as a `track-data` warning (`src/errors/router.ts`).
 */

import { isPaintableColor } from '../feature-vocabulary.js';

/**
 * The fields with rules of their own (`./dsv`, `./features-json`), validated
 * exactly as before pass-through and never copied as extras.
 */
export const FEATURE_CANONICAL_FIELDS: ReadonlySet<string> = new Set([
  'type',
  'start',
  'end',
  'description',
  'score',
]);

/** Per-record styling fields Nightingale reads ahead of the track's own. */
export const FEATURE_RENDER_FIELDS = [
  'color',
  'shape',
  'fill',
  'opacity',
] as const;

/** Fields the viewer sets or iterates, never taken from decoded data. */
export const FEATURE_VIEWER_FIELDS = [
  'tooltipContent',
  'locations',
  'residuesToHighlight',
] as const;

const RENDER = new Set<string>(FEATURE_RENDER_FIELDS);
const VIEWER = new Set<string>(FEATURE_VIEWER_FIELDS);

/**
 * Sort a non-canonical field name into its group. Matching is
 * case-sensitive: `Color` is a plain extra, not a render field.
 *
 * `name in Object.prototype` covers `__proto__` as well as the methods, which
 * is what makes plain assignment of every name that is not blocked safe.
 */
export function classifyExtraField(
  name: string
): 'render' | 'blocked' | 'skip' | 'extra' {
  if (name === '') return 'skip';
  if (VIEWER.has(name) || name in Object.prototype) return 'blocked';
  return RENDER.has(name) ? 'render' : 'extra';
}

/**
 * A finding a decoder reports rather than logs. `code` is the runtime
 * `ValidationIssueCode` the element puts on the routed event's issue;
 * `message` starts with the source label and carries no console prefix.
 */
export type DecodeWarning = {
  code: 'data-field-ignored' | 'unpaintable-color';
  message: string;
};

/** The names a warning lists: quoted, comma-separated. */
const quoteList = (names: readonly string[]): string =>
  names.map((n) => JSON.stringify(n)).join(', ');

/** One warning naming every blocked field a decode dropped. */
export function ignoredFieldsWarning(
  formatLabel: string,
  names: readonly string[]
): DecodeWarning {
  return {
    code: 'data-field-ignored',
    message:
      `${formatLabel}: ignored column(s) ${quoteList(names)} — these names ` +
      `are reserved by the viewer or by JavaScript and cannot come from a ` +
      `data file.`,
  };
}

/** At most this many offending values are named in a warning. */
const MAX_LISTED_VALUES = 3;

/** The first few distinct `values`, quoted, with `, …` when there are more. */
const quoteDistinct = (values: readonly string[]): string => {
  const distinct = [...new Set(values)];
  const more = distinct.length > MAX_LISTED_VALUES ? ', …' : '';
  return quoteList(distinct.slice(0, MAX_LISTED_VALUES)) + more;
};

/**
 * One warning for every row whose `color` / `fill` a browser will not paint.
 *
 * The values are kept on their records — `isPaintableColor` does not know
 * every modern CSS colour (`oklch()`, `lab()`, …), and dropping those would
 * discard colours that work. But a genuinely bad one (`#catFace`, `bleu`)
 * makes the canvas silently reuse the previous feature's colour, so the
 * author needs to hear about it.
 *
 * `rows` is how many records carry at least one such value; `values` are the
 * offending values in the order met, of which the first few distinct ones are
 * named.
 */
export function unpaintableColorWarning(
  formatLabel: string,
  rows: number,
  values: readonly string[]
): DecodeWarning {
  return {
    code: 'unpaintable-color',
    message:
      `${formatLabel}: ${rows} row(s) have a colour the canvas cannot paint ` +
      `(${quoteDistinct(values)}); those features are drawn in the previous ` +
      `feature's colour.`,
  };
}

/**
 * One warning for every row whose `shape` was dropped because it names an
 * `Object.prototype` property (see `isReservedShape`). `values` are the
 * dropped values in the order met, one per row.
 */
export function ignoredShapesWarning(
  formatLabel: string,
  values: readonly string[]
): DecodeWarning {
  return {
    code: 'data-field-ignored',
    message:
      `${formatLabel}: ignored "shape" value(s) in ${values.length} row(s) ` +
      `(${quoteDistinct(values)}) — these names are reserved by JavaScript, ` +
      `so those features take the track's or type's shape.`,
  };
}

/**
 * Whether a trimmed render-field value is a colour the canvas would not
 * paint. Only `color` and `fill` are checked: an unknown `shape` is not,
 * matching the track-level `rendering.shape` (Nightingale draws `?` and
 * warns) — but see `isReservedShape`.
 */
export function isUnpaintable(name: string, value: string): boolean {
  return (name === 'color' || name === 'fill') && !isPaintableColor(value);
}

/**
 * Whether a trimmed `shape` value names an `Object.prototype` property
 * (`valueOf`, `hasOwnProperty`, `constructor`, `__proto__`, …).
 *
 * The canvas looks a shape up as `drawers[shape]` on plain object literals,
 * so such a name finds an inherited method instead of missing: `valueOf`
 * and most others throw mid-draw, which stops the track painting, and
 * `constructor` / `toString` draw nothing. Unlike an unknown name, which
 * Nightingale draws as `?`, these are dropped so the feature falls back to
 * the track's or type's shape.
 */
export function isReservedShape(name: string, value: string): boolean {
  return name === 'shape' && value in Object.prototype;
}

/**
 * Throw unless `start`..`end` is a feature span both decoders accept.
 * Coordinates are residue positions, so both must be whole numbers, and
 * `end` may not precede `start` (equal endpoints — a single residue — are
 * fine), matching BED. Negative integers pass here; bounds are checked
 * against the sequence later.
 *
 * `where` names the record as the decoder's other errors do (`record 3`,
 * `row 4`). Without cell text the values are JSON's: each is a `field` and
 * is quoted as the number itself. A delimited decoder passes the untrimmed
 * `startCell` / `endCell` it parsed, so each is a `column` and is quoted as
 * the author wrote it.
 */
export function checkSpan(
  label: string,
  where: string,
  start: number,
  end: number,
  startCell?: string,
  endCell?: string
): void {
  checkWhole(label, where, 'start', start, startCell);
  checkWhole(label, where, 'end', end, endCell);
  if (end < start) {
    throw new Error(
      `${label}: ${where}: end (${end}) is before start (${start}).`
    );
  }
}

/** Throw unless coordinate `name` is a whole number (see `checkSpan`). */
function checkWhole(
  label: string,
  where: string,
  name: 'start' | 'end',
  n: number,
  cell: string | undefined
): void {
  if (Number.isInteger(n)) return;
  const what =
    cell === undefined
      ? `field "${name}": expected a whole number, got ${n}`
      : `column "${name}": expected a whole number, got "${cell}"`;
  throw new Error(`${label}: ${where}, ${what}.`);
}

/**
 * Applies the render-field rules (`color`, `shape`, `fill`, `opacity`) to
 * decoded records, and collects what both decoders warn about, to push once
 * the whole decode has succeeded: the blocked field names, the dropped
 * reserved `shape` values, and the unpaintable `color` / `fill` values with
 * the number of records carrying one. One collector serves one decode.
 *
 * The JSON decoder has already checked its values' types, so its `opacity`
 * arrives as a number — a `field`, quoted as the number in errors — and
 * every other render field as a string. A delimited decoder passes every
 * value as its cell's text and constructs the collector with its number
 * parser, which reads an `opacity` cell — a `column`, quoted as written.
 */
export class RenderFieldCollector {
  private readonly blocked = new Set<string>();
  private readonly reservedShapes: string[] = [];
  private readonly unpaintable: string[] = [];
  private unpaintableRows = 0;
  /** The last record counted in `unpaintableRows`, so each counts once. */
  private lastUnpaintable: object | undefined;
  private readonly label: string;
  private readonly parseCell: ((cell: string) => number | null) | undefined;

  constructor(label: string, parseCell?: (cell: string) => number | null) {
    this.label = label;
    this.parseCell = parseCell;
  }

  /** Note a blocked field name the decode dropped (named once in `flush`). */
  block(name: string): void {
    this.blocked.add(name);
  }

  /**
   * Set render field `key` on `record` from `value`, or leave it off.
   *
   * A string is trimmed, and a blank one leaves the field off, so the
   * track's `rendering:` still applies. `opacity` must be a number from 0 to
   * 1 (anything else throws, naming `where`); a `shape` naming an
   * `Object.prototype` property is dropped (see `isReservedShape`); a
   * `color` / `fill` the canvas cannot paint is kept but noted.
   */
  apply(
    record: Record<string, unknown>,
    key: string,
    value: string | number,
    where: string
  ): void {
    if (typeof value === 'number') {
      this.setOpacity(record, value, where);
      return;
    }
    const trimmed = value.trim();
    if (trimmed === '') return;
    if (key === 'opacity') {
      this.setOpacity(record, this.parseCell?.(trimmed), where, value);
      return;
    }
    if (isReservedShape(key, trimmed)) {
      this.reservedShapes.push(trimmed);
      return;
    }
    if (isUnpaintable(key, trimmed)) {
      this.unpaintable.push(trimmed);
      // Count each record carrying one once, however many it carries.
      if (record !== this.lastUnpaintable) this.unpaintableRows++;
      this.lastUnpaintable = record;
    }
    record[key] = trimmed;
  }

  /** Push the collected warnings, in their fixed order, onto `warnings`. */
  flush(warnings: DecodeWarning[] | undefined): void {
    if (!warnings) return;
    if (this.blocked.size > 0) {
      warnings.push(ignoredFieldsWarning(this.label, [...this.blocked]));
    }
    if (this.reservedShapes.length > 0) {
      warnings.push(ignoredShapesWarning(this.label, this.reservedShapes));
    }
    if (this.unpaintableRows > 0) {
      warnings.push(
        unpaintableColorWarning(
          this.label,
          this.unpaintableRows,
          this.unpaintable
        )
      );
    }
  }

  /**
   * Set `opacity`, or throw unless `n` is a finite number from 0 to 1
   * (`null` or `undefined` — a cell that did not parse — never is). The
   * error names a `column` and quotes `cell` as written when the value came
   * from one, else a `field` and `n`, as `checkSpan` does.
   */
  private setOpacity(
    record: Record<string, unknown>,
    n: number | null | undefined,
    where: string,
    cell?: string
  ): void {
    if (Number.isFinite(n) && n >= 0 && n <= 1) {
      record.opacity = n;
      return;
    }
    const what =
      cell === undefined
        ? `field "opacity": expected a number from 0 to 1, got ${n}`
        : `column "opacity": expected a number from 0 to 1, got "${cell}"`;
    throw new Error(`${this.label}: ${where}, ${what}.`);
  }
}
