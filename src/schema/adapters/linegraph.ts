/**
 * `linegraph` — built-in adapter for bring-your-own-data line graphs.
 *
 * Validates an author-supplied JSON array of `{ position, value }` records
 * (both finite numbers) and wraps them in a single series named `'value'`
 * with `range` always spanning zero, consumed by `nightingale-linegraph-track`.
 */

import type { AdapterFunction } from '../types.js';

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

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

export const linegraph: AdapterFunction = (raw) => {
  if (!Array.isArray(raw)) {
    throw new Error(
      `[linegraph] expected an array of { position, value } records; got ${describe(raw)}.`
    );
  }
  if (raw.length === 0) return [];

  let min = Infinity,
    max = -Infinity;
  const values: Array<{ position: number; value: number }> = [];

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
      const v = rec[f];
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
      if (!isFiniteNumber(v)) {
        throw new Error(
          `[linegraph] row ${i}: expected 'position' and 'value' (both numbers); got ${rowRendering} — '${f}' is not a finite number.`
        );
      }
    }
    const pos = rec.position as number;
    const val = rec.value as number;
    if (val < min) min = val;
    if (val > max) max = val;
    values.push({ position: pos, value: val });
  }

  return [{
    name: 'value',
    range: [Math.min(0, min), Math.max(0, max)],
    values,
  }];
};
