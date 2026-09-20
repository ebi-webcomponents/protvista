/**
 * Record shapes — *which* records a track needs.
 *
 * One half of the pair that replaces the `<shape>-<format>` adapter grid. A
 * kind declares the shape it draws; a source declares the format it is
 * encoded in; the adapter for the pair is computed rather than named. See
 * "Shape and format (normative)" in `specs/config-approach.md`.
 *
 * A shape is deliberately more than a list of field names: `label` is what
 * error messages are built from, and it is the reason a mismatch can read
 * "BED files carry feature records (type, start, end); `kind: variants` draws
 * variation records (position, variant)" rather than naming adapters and body
 * types at an author who was promised neither.
 *
 * `ShapeDefinition` is shaped to become a registry entry: the reserved
 * `registerShape()` extension point (see the spec) adds consumer shapes
 * without changing this module's contract.
 */

import type { ShapeName } from './types.js';

export type { ShapeName };

export interface ShapeDefinition {
  name: ShapeName;
  /**
   * Author-facing description, used verbatim in diagnostics —
   * "feature records (type, start, end)". Written as a noun phrase so it
   * composes into a sentence from either side of a mismatch.
   */
  label: string;
  /** Fields every record must carry. */
  requiredFields: readonly string[];
  /** Fields a record may carry, documented and passed through. */
  optionalFields: readonly string[];
  /**
   * Whether the renderer's representation differs from the records.
   *
   * `point` records are wrapped into `[{ name, color, range, values }]` and
   * `variation` records into `{ variants }`, but a `feature` array *is* what
   * the track canvas renders. This decides whether an inline or
   * `setTrackData()` payload needs adapting at all — and running an adapter
   * where it isn't needed is not free: it would strip any field outside the
   * shape, including ones a `dataTooltip` path references.
   */
  wraps: boolean;
  /**
   * Whether the viewer supplies the protein sequence. `variation` payloads
   * need it — `nightingale-variation-canvas` lays out one row per residue and
   * renders nothing without it — and an author's file has no sequence in it.
   */
  needsSequence?: boolean;
}

export const SHAPES: Readonly<Record<ShapeName, ShapeDefinition>> = {
  feature: {
    name: 'feature',
    label: 'feature records (type, start, end)',
    requiredFields: ['type', 'start', 'end'],
    optionalFields: ['description', 'score'],
    wraps: false,
  },
  point: {
    name: 'point',
    label: 'point records (position, value)',
    requiredFields: ['position', 'value'],
    optionalFields: [],
    wraps: true,
  },
  variation: {
    name: 'variation',
    label: 'variation records (position, variant)',
    requiredFields: ['position', 'variant'],
    optionalFields: ['wildType', 'description', 'consequence'],
    wraps: true,
    needsSequence: true,
  },
};

export const SHAPE_NAMES = Object.keys(SHAPES) as ShapeName[];

export function isShapeName(value: string): value is ShapeName {
  return Object.prototype.hasOwnProperty.call(SHAPES, value);
}

/** The author-facing label for a shape, for use in diagnostics. */
export function shapeLabel(name: ShapeName): string {
  return SHAPES[name].label;
}
