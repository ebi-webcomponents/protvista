/**
 * `linegraph` — built-in adapter for bring-your-own-data line graphs.
 *
 * Validates an author-supplied JSON array of `{ position, value }` records
 * (both finite numbers) and wraps them in a single series — fixed stroke,
 * `range` fitted to the data's own extent — consumed by
 * `nightingale-linegraph-track`.
 *
 * The series name is a placeholder, not a unit: the track pluralises a series
 * name into its hover readout (`12 variants`), which only reads correctly for
 * the domain count adapters. Tracks on this adapter therefore render without
 * `show-label-name` — see `showsSeriesLabel` in `protvista-uniprot.ts`.
 */

import type { AdapterFunction } from '../types.js';
import type { PointRecord } from './dsv.js';

/**
 * Stroke for the single series. A neutral dark slate rather than a hue: the
 * data carries no categorical meaning to colour by, and it stays legible on
 * the track background without competing with the domain tracks above it.
 */
export const LINE_COLOR = '#3d4451';

function describe(x: unknown): string {
  if (x === null) return 'null';
  if (Array.isArray(x)) return 'array';
  return typeof x;
}

function repr(v: unknown): string {
  if (typeof v === 'string') return `'${v}'`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return String(v);
  return Array.isArray(v) ? '[array]' : '[object]';
}

function kindOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'object') return 'an object';
  if (typeof v === 'string') return 'a string';
  return typeof v === 'boolean' ? 'a boolean' : `a ${typeof v}`;
}

/**
 * Wrap validated `{ position, value }` records in the single-series shape
 * `nightingale-linegraph-track` renders.
 *
 * Shared by every transport of this kind — the JSON/inline `linegraph`
 * adapter and its delimited `linegraph-csv` / `linegraph-tsv` siblings — so
 * a graph looks identical whichever file the author brought it in.
 */
export function toSeries(values: readonly PointRecord[]): unknown[] {
  if (values.length === 0) return [];

  let min = Infinity;
  let max = -Infinity;
  for (const { value } of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  // Fit the y-axis to the data, not to zero. `fill` is unset so the track
  // draws a line rather than an area, which is what a zero baseline would be
  // for; anchoring to zero instead flattens the values authors actually bring
  // (read depth 1000–1200, pLDDT 70–95) into a straight trace at the top of a
  // 50px track. A constant series has no extent of its own, so pad it to keep
  // d3's zero-width domain from pinning the line to the track floor.
  const pad = min === max ? Math.abs(min) || 1 : 0;

  return [
    {
      name: 'value',
      // Explicit: `nightingale-linegraph-track` falls back to
      // `interpolateRainbow(Math.random())`, which would repaint the graph a
      // different hue on every accession change and disagree between two
      // viewers on the same page.
      color: LINE_COLOR,
      range: [min - pad, max + pad],
      values: [...values],
    },
  ];
}

export const linegraph: AdapterFunction = (raw) => {
  if (!Array.isArray(raw)) {
    throw new Error(
      `[linegraph] expected an array of { position, value } records; got ${describe(raw)}.`
    );
  }
  if (raw.length === 0) return [];

  const values: PointRecord[] = [];

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(
        `[linegraph] row ${i}: expected 'position' and 'value' (both numbers); got ${repr(row)} — row is ${kindOf(row)}, not an object.`
      );
    }
    const rec = row as Record<string, unknown>;
    const keys = Object.keys(rec);
    const rowRendering =
      keys.length === 0 ? '{}' : `{ ${keys.map((k) => `${k}: ${repr(rec[k])}`).join(', ')} }`;

    for (const f of ['position', 'value'] as const) {
      // Own properties only: the row rendering above is built from
      // `Object.keys`, so reading through the prototype chain here would let
      // an inherited field pass validation while the error message for a
      // sibling failure printed `{}`.
      const v = Object.prototype.hasOwnProperty.call(rec, f)
        ? rec[f]
        : undefined;
      if (v === undefined) {
        throw new Error(
          `[linegraph] row ${i}: expected 'position' and 'value' (both numbers); got ${rowRendering} — '${f}' is missing.`
        );
      }
      if (typeof v !== 'number') {
        throw new Error(
          `[linegraph] row ${i}: expected 'position' and 'value' (both numbers); got ${rowRendering} — '${f}' is ${kindOf(v)}, not a number.`
        );
      }
      if (!Number.isFinite(v)) {
        throw new Error(
          `[linegraph] row ${i}: expected 'position' and 'value' (both numbers); got ${rowRendering} — '${f}' is not a finite number.`
        );
      }
    }
    values.push({
      position: rec.position as number,
      value: rec.value as number,
    });
  }

  return toSeries(values);
};
