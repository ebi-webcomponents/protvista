/**
 * `features-json` — a generic-format adapter for bring-your-own-data.
 *
 * Accepts a JSON array of feature-shaped objects — the same
 * `type,start,end,description[,score]` convention the delimited adapters
 * use — so an author can point a track at `./features.json` with no
 * per-track glue. Unlike `features-csv` / `features-tsv`, the fetch has
 * already parsed the body (the loader reads `.json` files with
 * `response.json()`), so `raw` is the parsed value, not text — there is
 * no tokenizer, just structural validation.
 *
 * Each record's start coordinate may be given as either `start` or
 * `begin` (the UniProt convention); it is normalised to `start` on
 * output. `start` wins when both are present and non-null; a `null`
 * (or absent) `start` falls back to `begin` rather than masking it.
 * `begin` itself is used up as the alias and not copied.
 *
 * Every other key is kept on the record, after the canonical fields and in
 * the object's own key order, so a JSON file and the same records written
 * inline render alike (`./feature-fields` has the rule):
 *
 *   - `color`, `shape`, `fill` must be strings (trimmed) and `opacity` a
 *     number from 0 to 1; `null` or `''` leaves the field off, so the
 *     track's `rendering:` still applies. A wrong type throws.
 *   - Any other key is kept as given — objects and arrays by reference.
 *   - `tooltipContent`, `locations`, `residuesToHighlight` and names on
 *     `Object.prototype` (an own `__proto__` key from `JSON.parse`
 *     included) are dropped.
 *
 * An optional third argument is a warnings sink (`DecodeWarning[]`), filled
 * the way `rowsToFeatureRecords` fills its `opts.warnings`: at most one
 * `data-field-ignored` warning for dropped keys, one for dropped `shape`
 * values that name an `Object.prototype` property, and one
 * `unpaintable-color` warning per call, pushed only when the call returns.
 * Nothing is logged.
 *
 * `description` and `score` are optional: absent or `null` omits the
 * field from the output, but a *present* value of the wrong type (e.g.
 * `description: 42`, `score: "high"`) throws rather than being silently
 * dropped — both fields are held to the same type contract.
 *
 * Coordinates must be whole numbers (negative integers are accepted here;
 * bounds are checked against the sequence later), and `end` may not precede
 * `start` — equal endpoints are a single residue — matching BED.
 *
 * Malformed input throws a descriptive, record/field-named error (naming
 * the offending array index and field); the loader's per-track try/catch
 * turns that into the track's `⚠` badge and `protvista-error` event rather
 * than crashing the viewer. A body that is not an array at all throws too,
 * as `linegraph` and `variation` do: a file wrapped as
 * `{ "features": [...] }` is the commonest way to get this wrong, and an
 * empty track with only a console line would tell the author their file
 * loaded and was empty. (A *failed* fetch never reaches here as a
 * non-array — the loader hands the decoder `[]` and reports the fetch.)
 */

import type { AdapterFunction } from '../types.js';
import type { AuthoredFeatureRecord } from './dsv.js';
import {
  FEATURE_CANONICAL_FIELDS,
  RenderFieldCollector,
  checkSpan,
  classifyExtraField,
  type DecodeWarning,
} from './feature-fields.js';

/**
 * Default error prefix, used when this validator is called directly rather
 * than through the pipeline. The pipeline passes the author's own source
 * instead — `./hits.json (parsed as JSON)` — so an error names the file the
 * author has to go and fix rather than the machinery that read it.
 */
const FORMAT_LABEL = 'features-json';

/** A parsed, finite JSON number (rejects `NaN`; strings never qualify). */
function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * How a value reads in an error message: its `typeof`, or `"null"` /
 * `"array"`. Arrays are called out explicitly because `typeof []` is
 * `"object"` — reporting "got object" for an array is technically true
 * but misleading, especially in the "record N is not an object" guard
 * where the offending value often *is* an array.
 */
function describe(x: unknown): string {
  if (x === null) return 'null';
  if (Array.isArray(x)) return 'array';
  return typeof x;
}

export const featuresJson: AdapterFunction = (raw, labelArg, warningsArg) => {
  const label = typeof labelArg === 'string' ? labelArg : FORMAT_LABEL;
  const warnings = Array.isArray(warningsArg)
    ? (warningsArg as DecodeWarning[])
    : undefined;
  if (!Array.isArray(raw)) {
    throw new Error(
      `${label}: expected an array of feature records; got ${describe(raw)}.`
    );
  }

  const fields = new RenderFieldCollector(label);
  const records: AuthoredFeatureRecord[] = [];
  for (let i = 0; i < raw.length; i++) {
    records.push(decodeRecord(raw[i], i, label, fields));
  }
  fields.flush(warnings);
  return records;
};

/**
 * Decode array element `i` into a feature record, or throw naming it.
 * Render fields and blocked keys go through `fields`, which collects the
 * warnings for the whole decode.
 */
function decodeRecord(
  item: unknown,
  i: number,
  label: string,
  fields: RenderFieldCollector
): AuthoredFeatureRecord {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(
      `${label}: record ${i} is not an object (got ${describe(item)}).`
    );
  }
  const r = item as Record<string, unknown>;
  const where = `record ${i}`;

  const type = requireString(r.type, 'type', label, where);

  // Accept `start` or `begin`; `start` wins when both are present.
  // `!= null` (not `!== undefined`) so an explicit `start: null` falls
  // back to `begin` instead of masking it — matching the `score` guard
  // below, which likewise treats `null` as absent. A `begin`-given record
  // is still reported as "start".
  const rawStart = r.start != null ? r.start : r.begin;
  const start = requireNumber(rawStart, 'start', label, where);
  const end = requireNumber(r.end, 'end', label, where);
  checkSpan(label, where, start, end);

  const record: AuthoredFeatureRecord = { type, start, end };
  decodeOptionalFields(r, record, label, where);
  decodeExtras(r, record, label, where, fields);
  return record;
}

/** `value` if it is a finite number, else throw naming `field`. */
function requireNumber(
  value: unknown,
  field: string,
  label: string,
  where: string
): number {
  if (isFiniteNumber(value)) return value;
  throw new Error(
    `${label}: ${where}, field "${field}": expected a number, ` +
      `got ${describe(value)}.`
  );
}

/** `value` if it is a string, else throw naming `field`. */
function requireString(
  value: unknown,
  field: string,
  label: string,
  where: string
): string {
  if (typeof value === 'string') return value;
  throw new Error(
    `${label}: ${where}, field "${field}": expected a string, ` +
      `got ${describe(value)}.`
  );
}

/**
 * Copy `description` and `score` onto `record`. Absent or `null` omits
 * either (and `''` omits `description`); a present value of the wrong
 * type throws.
 */
function decodeOptionalFields(
  r: Record<string, unknown>,
  record: AuthoredFeatureRecord,
  label: string,
  where: string
): void {
  if (r.description != null) {
    const description = requireString(
      r.description,
      'description',
      label,
      where
    );
    if (description !== '') record.description = description;
  }

  if (r.score != null) {
    record.score = requireNumber(r.score, 'score', label, where);
  }
}

/**
 * Copy every other key of `r` onto `record`, in the object's own key
 * order, by the rule in `./feature-fields`: extras as given, render fields
 * through `fields`, blocked keys noted there and dropped.
 */
function decodeExtras(
  r: Record<string, unknown>,
  record: AuthoredFeatureRecord,
  label: string,
  where: string,
  fields: RenderFieldCollector
): void {
  for (const key of Object.keys(r)) {
    if (FEATURE_CANONICAL_FIELDS.has(key) || key === 'begin') continue;
    const group = classifyExtraField(key);
    if (group === 'blocked') {
      fields.block(key);
    } else if (group === 'extra') {
      // Safe as plain assignment: every `Object.prototype` name, `__proto__`
      // included, was classified as blocked above.
      record[key] = r[key];
    } else if (group === 'render') {
      applyRenderField(r[key], key, record, label, where, fields);
    }
  }
}

/**
 * Type-check render field `key`'s value and hand it to `fields`: `opacity`
 * must be a number and the others strings. `null` and `''` alike leave a
 * render field off, as `null` does for `description` / `score`.
 */
function applyRenderField(
  value: unknown,
  key: string,
  record: AuthoredFeatureRecord,
  label: string,
  where: string,
  fields: RenderFieldCollector
): void {
  if (value == null || value === '') return;
  if (key !== 'opacity') {
    fields.apply(record, key, requireString(value, key, label, where), where);
    return;
  }
  if (typeof value !== 'number') {
    throw new Error(
      `${label}: ${where}, field "opacity": expected a number from ` +
        `0 to 1, got ${describe(value)}.`
    );
  }
  fields.apply(record, key, value, where);
}
