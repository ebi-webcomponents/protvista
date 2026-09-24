/**
 * `variation` — built-in adapter for bring-your-own-data residue changes.
 *
 * Validates an author-supplied JSON array of `{ position, variant }` records
 * (plus optional `wildType`, `description`, `consequence`) and wraps them in
 * the `{ variants }` shape `nightingale-variation-canvas` consumes. It backs
 * the `variants` and `rna-editing` kinds when their data is a file rather
 * than a UniProt API response, so those kinds keep their plain domain names
 * whichever side the records come from.
 *
 * The component also needs the protein `sequence` — it builds one row per
 * residue and indexes variants by `start - 1`. An author's file has no
 * sequence in it, so the adapter emits the wrapper without one and the
 * viewer fills it in from the entry it already fetched (see
 * `_fillVariationSequence` in `protvista-uniprot.ts`). A variation payload
 * that reached the component with no sequence would render nothing at all,
 * silently, which is why that injection is not optional.
 */

import type { AdapterFunction } from '../types.js';
import type { VariationRecord } from './dsv.js';

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

/** The optional string fields a record may carry, in emitted order. */
const OPTIONAL_STRINGS = ['wildType', 'description', 'consequence'] as const;

/**
 * Wrap validated records in the shape `nightingale-variation-canvas` renders.
 *
 * Shared by every transport of this family — the JSON/inline `variation`
 * adapter and its delimited `variation-csv` / `variation-tsv` siblings — so a
 * track looks identical whichever file the author brought it in.
 *
 * `xrefNames` and `hasPredictions` are the component's own required fields;
 * an author's file has neither, so they are emitted empty rather than left
 * undefined (the canvas reads them without guarding). `accession` is the
 * component's per-variant identity, so it is synthesised from the change
 * itself — stable across reloads, and readable in the DOM when debugging.
 */
export function toVariants(records: readonly VariationRecord[]): {
  variants: unknown[];
} {
  return {
    variants: records.map((r) => {
      const out: Record<string, unknown> = {
        accession: `${r.wildType ?? ''}${r.position}${r.variant}`,
        variant: r.variant,
        start: r.position,
        end: r.position,
        xrefNames: [],
        hasPredictions: false,
        consequenceType: r.consequence ?? '',
      };
      for (const f of OPTIONAL_STRINGS) {
        if (r[f] !== undefined) out[f] = r[f];
      }
      return out;
    }),
  };
}

export const variation: AdapterFunction = (raw, labelArg) => {
  // Every parser prefixes its errors the same way — `<label>: …` — so an
  // author reading two failures side by side sees one shape. The pipeline
  // passes their own source; a direct call falls back to this record family's
  // name.
  const label = typeof labelArg === 'string' ? labelArg : 'variation';
  if (!Array.isArray(raw)) {
    throw new Error(
      `${label}: expected an array of { position, variant } records; got ${describe(raw)}.`
    );
  }
  if (raw.length === 0) return { variants: [] };

  const records: VariationRecord[] = [];

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(
        `${label}: row ${i}: expected 'position' (a number) and 'variant' (a string); got ${repr(row)} — row is ${kindOf(row)}, not an object.`
      );
    }
    const rec = row as Record<string, unknown>;
    const keys = Object.keys(rec);
    // Built lazily: only the throw branches read it, and a genome-scale file
    // would otherwise allocate one of these per row on the happy path.
    const rowRendering = () =>
      keys.length === 0
        ? '{}'
        : `{ ${keys.map((k) => `${k}: ${repr(rec[k])}`).join(', ')} }`;

    // Own properties only: the rendering above is built from `Object.keys`,
    // so reading through the prototype chain would let an inherited field
    // pass validation while the message for a sibling failure printed `{}`.
    const own = (f: string): unknown =>
      Object.prototype.hasOwnProperty.call(rec, f) ? rec[f] : undefined;

    const position = own('position');
    if (position === undefined) {
      throw new Error(
        `${label}: row ${i}: expected 'position' (a number) and 'variant' (a string); got ${rowRendering()} — 'position' is missing.`
      );
    }
    if (typeof position !== 'number' || !Number.isFinite(position)) {
      throw new Error(
        `${label}: row ${i}: expected 'position' (a number) and 'variant' (a string); got ${rowRendering()} — 'position' is ${
          typeof position === 'number' ? 'not a finite number' : `${kindOf(position)}, not a number`
        }.`
      );
    }

    const variant = own('variant');
    if (variant === undefined) {
      throw new Error(
        `${label}: row ${i}: expected 'position' (a number) and 'variant' (a string); got ${rowRendering()} — 'variant' is missing.`
      );
    }
    if (typeof variant !== 'string' || variant === '') {
      throw new Error(
        `${label}: row ${i}: expected 'variant' to be the residue the position changes to (e.g. 'K', '*' for a stop, '-' for a deletion); got ${rowRendering()} — 'variant' is ${
          variant === '' ? 'an empty string' : `${kindOf(variant)}, not a string`
        }.`
      );
    }

    const record: VariationRecord = { position, variant };
    for (const f of OPTIONAL_STRINGS) {
      const v = own(f);
      if (v === undefined) continue;
      if (typeof v !== 'string') {
        throw new Error(
          `${label}: row ${i}: expected '${f}' to be a string; got ${rowRendering()} — '${f}' is ${kindOf(v)}.`
        );
      }
      record[f] = v;
    }
    records.push(record);
  }

  return toVariants(records);
};
