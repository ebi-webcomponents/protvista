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
 * Records are pared down to the canonical `FeatureRecord` shape the
 * Nightingale tracks consume — extra fields are dropped so the four
 * generic adapters share one output contract.
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
import type { FeatureRecord } from './dsv.js';

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

export const featuresJson: AdapterFunction = (raw, labelArg) => {
  const label = typeof labelArg === 'string' ? labelArg : FORMAT_LABEL;
  if (!Array.isArray(raw)) {
    throw new Error(
      `${label}: expected an array of feature records; got ${describe(raw)}.`
    );
  }

  const records: FeatureRecord[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item: unknown = raw[i];

    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(
        `${label}: record ${i} is not an object (got ${describe(item)}).`
      );
    }
    const r = item as Record<string, unknown>;

    if (typeof r.type !== 'string') {
      throw new Error(
        `${label}: record ${i}, field "type": expected a string, ` +
          `got ${describe(r.type)}.`
      );
    }

    // Accept `start` or `begin`; `start` wins when both are present.
    // `!= null` (not `!== undefined`) so an explicit `start: null` falls
    // back to `begin` instead of masking it — matching the `score` guard
    // below, which likewise treats `null` as absent.
    const rawStart = r.start != null ? r.start : r.begin;
    if (!isFiniteNumber(rawStart)) {
      throw new Error(
        `${label}: record ${i}, field "start": expected a number, ` +
          `got ${describe(rawStart)}.`
      );
    }
    if (!isFiniteNumber(r.end)) {
      throw new Error(
        `${label}: record ${i}, field "end": expected a number, ` +
          `got ${describe(r.end)}.`
      );
    }
    // Coordinates are residue positions, so they must be whole numbers, and
    // `end` may not precede `start` (equal endpoints — a single residue — are
    // fine), matching BED. A `begin`-given record is still reported as
    // "start", as above. Negative integers pass here; bounds are checked
    // against the sequence later.
    if (!Number.isInteger(rawStart)) {
      throw new Error(
        `${label}: record ${i}, field "start": expected a whole number, ` +
          `got ${rawStart}.`
      );
    }
    if (!Number.isInteger(r.end)) {
      throw new Error(
        `${label}: record ${i}, field "end": expected a whole number, ` +
          `got ${r.end}.`
      );
    }
    if (r.end < rawStart) {
      throw new Error(
        `${label}: record ${i}: end (${r.end}) is before start (${rawStart}).`
      );
    }

    const record: FeatureRecord = {
      type: r.type,
      start: rawStart,
      end: r.end,
    };

    if (r.description !== undefined && r.description !== null) {
      if (typeof r.description !== 'string') {
        throw new Error(
          `${label}: record ${i}, field "description": expected a ` +
            `string, got ${describe(r.description)}.`
        );
      }
      if (r.description !== '') {
        record.description = r.description;
      }
    }

    if (r.score !== undefined && r.score !== null) {
      if (!isFiniteNumber(r.score)) {
        throw new Error(
          `${label}: record ${i}, field "score": expected a number, ` +
            `got ${describe(r.score)}.`
        );
      }
      record.score = r.score;
    }

    records.push(record);
  }

  return records;
};
