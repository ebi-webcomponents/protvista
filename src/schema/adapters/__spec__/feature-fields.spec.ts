/**
 * The span check and render-field collector both feature decoders share.
 * `features-json.spec.ts` and `features-dsv.spec.ts` pin the decoders' end
 * to end messages; these pin the helpers' own contract, in both dialects.
 */
import { describe, it, expect } from 'vitest';
import {
  RenderFieldCollector,
  checkSpan,
  type DecodeWarning,
} from '../feature-fields.js';
import { parseDecimal } from '../dsv.js';

describe('checkSpan', () => {
  it('accepts whole numbers with end at or after start, negatives included', () => {
    expect(() => checkSpan('L', 'record 0', 3, 3)).not.toThrow();
    expect(() => checkSpan('L', 'record 0', -2, 5)).not.toThrow();
  });

  it('names a JSON field and quotes the number itself', () => {
    expect(() => checkSpan('L', 'record 2', 1.5, 4)).toThrow(
      'L: record 2, field "start": expected a whole number, got 1.5.'
    );
    expect(() => checkSpan('L', 'record 2', 1, 4.25)).toThrow(
      'L: record 2, field "end": expected a whole number, got 4.25.'
    );
  });

  it('names a column and quotes the cell as written when given cells', () => {
    expect(() => checkSpan('L', 'row 3', 1.5, 4, ' 1.50', '4')).toThrow(
      'L: row 3, column "start": expected a whole number, got " 1.50".'
    );
    expect(() => checkSpan('L', 'row 3', 1, 4.5, '1', '4.50 ')).toThrow(
      'L: row 3, column "end": expected a whole number, got "4.50 ".'
    );
  });

  it('checks start before end, and wholeness before order', () => {
    expect(() => checkSpan('L', 'record 0', 1.5, 2.5)).toThrow(/field "start"/);
    expect(() => checkSpan('L', 'record 0', 9, 2.5)).toThrow(/field "end"/);
  });

  it('rejects an end before start', () => {
    expect(() => checkSpan('L', 'row 4', 9, 2, '9', '2')).toThrow(
      'L: row 4: end (2) is before start (9).'
    );
  });
});

describe('RenderFieldCollector', () => {
  it('trims strings and leaves a blank one off', () => {
    const c = new RenderFieldCollector('L');
    const record: Record<string, unknown> = {};
    c.apply(record, 'color', '  red ', 'record 0');
    c.apply(record, 'fill', '   ', 'record 0');
    expect(record).toEqual({ color: 'red' });
  });

  it('range-checks a JSON opacity, quoting the number', () => {
    const c = new RenderFieldCollector('L');
    const record: Record<string, unknown> = {};
    c.apply(record, 'opacity', 0, 'record 0');
    expect(record.opacity).toBe(0);
    expect(() => c.apply({}, 'opacity', 1.5, 'record 1')).toThrow(
      'L: record 1, field "opacity": expected a number from 0 to 1, got 1.5.'
    );
    expect(() => c.apply({}, 'opacity', NaN, 'record 1')).toThrow(/got NaN\./);
  });

  it('parses an opacity cell, quoting it as written on failure', () => {
    const c = new RenderFieldCollector('L', parseDecimal);
    const record: Record<string, unknown> = {};
    c.apply(record, 'opacity', ' 0.25 ', 'row 2');
    expect(record.opacity).toBe(0.25);
    c.apply(record, 'opacity', '  ', 'row 2');
    expect(record.opacity).toBe(0.25);
    for (const cell of ['2', ' half', '0x1']) {
      expect(() => c.apply({}, 'opacity', cell, 'row 3')).toThrow(
        `L: row 3, column "opacity": expected a number from 0 to 1, ` +
          `got "${cell}".`
      );
    }
  });

  it('collects blocked names, reserved shapes and unpaintable colours', () => {
    const c = new RenderFieldCollector('L');
    c.block('tooltipContent');
    c.block('tooltipContent');
    c.block('locations');
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    c.apply(a, 'shape', 'valueOf', 'record 0');
    c.apply(a, 'color', 'bleu', 'record 0');
    c.apply(a, 'fill', '#catFace', 'record 0');
    c.apply(b, 'color', 'bleu', 'record 1');
    c.apply(b, 'shape', 'circle', 'record 1');
    // Unpaintable values are kept; reserved shapes are dropped.
    expect(a).toEqual({ color: 'bleu', fill: '#catFace' });
    expect(b).toEqual({ color: 'bleu', shape: 'circle' });

    const warnings: DecodeWarning[] = [];
    c.flush(warnings);
    expect(warnings.map((w) => w.code)).toEqual([
      'data-field-ignored',
      'data-field-ignored',
      'unpaintable-color',
    ]);
    expect(warnings[0].message).toContain('"tooltipContent", "locations"');
    expect(warnings[1].message).toContain('in 1 row(s) ("valueOf")');
    // Two records carry an unpaintable value, three values in all.
    expect(warnings[2].message).toContain(
      'L: 2 row(s) have a colour the canvas cannot paint ' +
        '("bleu", "#catFace")'
    );
  });

  it('pushes nothing when nothing was collected, or without a sink', () => {
    const c = new RenderFieldCollector('L');
    c.apply({}, 'color', 'red', 'record 0');
    const warnings: DecodeWarning[] = [];
    c.flush(warnings);
    expect(warnings).toEqual([]);
    c.block('locations');
    expect(() => c.flush(undefined)).not.toThrow();
  });
});
