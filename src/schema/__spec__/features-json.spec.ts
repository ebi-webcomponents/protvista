/**
 * Unit tests for the `features-json` generic-format adapter.
 *
 * Covers:
 *   - happy path: an array of feature objects → clean feature records
 *     (`type`, `start`, `end`, optional `description` / `score`);
 *   - the `begin` alias normalising to `start` (`start` winning when both
 *     are present, and a `null` `start` falling back to `begin` rather
 *     than masking it);
 *   - `description` / `score` omitted when absent, `null`, or (for
 *     `description`) empty — but a present, wrong-typed value throws;
 *   - `isFiniteNumber` rejecting `NaN` / `Infinity`, and retaining a falsy
 *     `score: 0`;
 *   - coordinates held to whole numbers (negative integers still accepted)
 *     and `end` not preceding `start` (equal endpoints accepted);
 *   - strict, record/field-named errors on malformed input (non-string
 *     `type`, non-number `start` / `end` / `score`, non-object element);
 *   - the non-array guard throwing, naming the type it got;
 *   - extra keys kept (#283): render fields typed and trimmed, other keys
 *     by reference, viewer and `Object.prototype` names dropped with one
 *     warning in the third-argument sink.
 */

import { describe, it, expect, vi } from 'vitest';
import { featuresJson } from '../adapters/features-json.js';
import type { DecodeWarning } from '../adapters/feature-fields.js';

describe('features-json adapter', () => {
  it('passes a well-formed array through to clean feature records', () => {
    const input = [
      { type: 'DOMAIN', start: 10, end: 25, description: 'Kinase domain', score: 0.9 },
      { type: 'SITE', start: 42, end: 42, description: 'Active site', score: 0.5 },
    ];
    expect(featuresJson(input)).toEqual([
      { type: 'DOMAIN', start: 10, end: 25, description: 'Kinase domain', score: 0.9 },
      { type: 'SITE', start: 42, end: 42, description: 'Active site', score: 0.5 },
    ]);
  });

  it('normalises a `begin` coordinate to `start`', () => {
    expect(featuresJson([{ type: 'DOMAIN', begin: 10, end: 25 }])).toEqual([
      { type: 'DOMAIN', start: 10, end: 25 },
    ]);
  });

  it('prefers `start` over `begin` when both are present', () => {
    expect(
      featuresJson([{ type: 'DOMAIN', start: 10, begin: 99, end: 25 }])
    ).toEqual([{ type: 'DOMAIN', start: 10, end: 25 }]);
  });

  it('falls back to `begin` when `start` is explicitly null, rather than masking it', () => {
    expect(
      featuresJson([{ type: 'DOMAIN', start: null, begin: 10, end: 25 }])
    ).toEqual([{ type: 'DOMAIN', start: 10, end: 25 }]);
  });

  it('retains a falsy `start` of 0 (the `!= null` trap done right)', () => {
    expect(featuresJson([{ type: 'DOMAIN', start: 0, end: 5 }])).toEqual([
      { type: 'DOMAIN', start: 0, end: 5 },
    ]);
  });

  it('normalises a falsy `begin` of 0 to `start`', () => {
    expect(featuresJson([{ type: 'DOMAIN', begin: 0, end: 5 }])).toEqual([
      { type: 'DOMAIN', start: 0, end: 5 },
    ]);
  });

  it('throws on a present-but-invalid `start` rather than falling back to a valid `begin`', () => {
    // A `null`/absent `start` falls back to `begin`, but a *present*
    // garbage `start` is a real error — it must not be masked.
    expect(() =>
      featuresJson([{ type: 'DOMAIN', start: '10', begin: 20, end: 5 }])
    ).toThrow(
      /features-json: record 0, field "start": expected a number, got string/
    );
  });

  it('accepts negative integer coordinates (bounds are checked against the sequence later)', () => {
    expect(
      featuresJson([{ type: 'DOMAIN', start: -5, end: 3 }])
    ).toEqual([{ type: 'DOMAIN', start: -5, end: 3 }]);
  });

  it('rejects a fractional coordinate with a record/field-named error', () => {
    expect(() =>
      featuresJson([{ type: 'DOMAIN', start: -5, end: 3.14 }])
    ).toThrow(
      new Error(
        'features-json: record 0, field "end": expected a whole number, got 3.14.'
      )
    );
  });

  it('rejects a fractional start', () => {
    expect(() =>
      featuresJson([{ type: 'DOMAIN', start: 18.5, end: 20 }])
    ).toThrow(
      new Error(
        'features-json: record 0, field "start": expected a whole number, got 18.5.'
      )
    );
  });

  it('names a fractional begin as "start"', () => {
    expect(() =>
      featuresJson([{ type: 'DOMAIN', begin: 1.5, end: 20 }])
    ).toThrow(/record 0, field "start": expected a whole number, got 1\.5\./);
  });

  it('throws a record-named error when end is before start', () => {
    expect(() =>
      featuresJson([
        { type: 'DOMAIN', start: 1, end: 2 },
        { type: 'DOMAIN', start: 5, end: 4 },
      ])
    ).toThrow(
      new Error('features-json: record 1: end (4) is before start (5).')
    );
  });

  it('accepts a single-residue feature (start === end)', () => {
    expect(featuresJson([{ type: 'DOMAIN', start: 7, end: 7 }])).toEqual([
      { type: 'DOMAIN', start: 7, end: 7 },
    ]);
  });

  it('reports a fraction before an inverted interval', () => {
    expect(() =>
      featuresJson([{ type: 'DOMAIN', start: 9.5, end: 3 }])
    ).toThrow(/field "start": expected a whole number/);
  });

  it('retains a falsy score of 0', () => {
    expect(
      featuresJson([{ type: 'DOMAIN', start: 1, end: 5, score: 0 }])
    ).toEqual([{ type: 'DOMAIN', start: 1, end: 5, score: 0 }]);
  });

  it('omits description and score when absent', () => {
    expect(featuresJson([{ type: 'DOMAIN', start: 1, end: 5 }])).toEqual([
      { type: 'DOMAIN', start: 1, end: 5 },
    ]);
  });

  it('omits an empty-string description and a null score', () => {
    expect(
      featuresJson([{ type: 'DOMAIN', start: 1, end: 5, description: '', score: null }])
    ).toEqual([{ type: 'DOMAIN', start: 1, end: 5 }]);
  });

  it('keeps extra fields; `color` is a render field', () => {
    // Was "drops extra fields": #283 keeps them, so a JSON file and the same
    // records written inline render alike.
    const warnings: DecodeWarning[] = [];
    expect(
      featuresJson(
        [{ type: 'DOMAIN', start: 1, end: 5, color: ' red ', foo: 42 }],
        'features-json',
        warnings
      )
    ).toStrictEqual([{ type: 'DOMAIN', start: 1, end: 5, color: 'red', foo: 42 }]);
    expect(warnings).toEqual([]);
  });

  it('accepts an empty array', () => {
    expect(featuresJson([])).toEqual([]);
  });

  it('accepts a prototype-less record (Object.create(null))', () => {
    const record = Object.assign(Object.create(null), {
      type: 'DOMAIN',
      start: 1,
      end: 5,
      color: 'blue',
      pmid: '12345',
    });
    expect(featuresJson([record])).toEqual([
      { type: 'DOMAIN', start: 1, end: 5, color: 'blue', pmid: '12345' },
    ]);
  });

  it('throws a descriptive error on a non-array body', () => {
    // A file wrapped as `{ "features": [...] }` is the commonest way to get
    // this wrong. Warning and returning [] left an empty track with no badge,
    // which reads as "the file loaded and is empty".
    expect(() => featuresJson({ features: [] })).toThrow(
      'features-json: expected an array of feature records; got object.'
    );
  });

  it('names the type of a `null` body', () => {
    expect(() => featuresJson(null)).toThrow(/got null\.$/);
  });

  it('names the author\'s file when the pipeline supplies it', () => {
    expect(() => featuresJson({}, './hits.json (parsed as JSON)')).toThrow(
      /^\.\/hits\.json \(parsed as JSON\): expected an array/
    );
  });

  it('throws a record+field-named error on a non-string type', () => {
    expect(() => featuresJson([{ type: 5, start: 1, end: 5 }])).toThrow(
      /features-json: record 0, field "type": expected a string, got number/
    );
  });

  it('throws when neither start nor begin is a number', () => {
    expect(() => featuresJson([{ type: 'DOMAIN', end: 5 }])).toThrow(
      /features-json: record 0, field "start": expected a number, got undefined/
    );
  });

  it('rejects a string coordinate rather than coercing it', () => {
    expect(() =>
      featuresJson([{ type: 'DOMAIN', start: '10', end: 5 }])
    ).toThrow(
      /features-json: record 0, field "start": expected a number, got string/
    );
  });

  it('rejects NaN and Infinity coordinates despite being typeof "number"', () => {
    expect(() =>
      featuresJson([{ type: 'DOMAIN', start: NaN, end: 5 }])
    ).toThrow(/features-json: record 0, field "start": expected a number/);
    expect(() =>
      featuresJson([{ type: 'DOMAIN', start: 1, end: Infinity }])
    ).toThrow(/features-json: record 0, field "end": expected a number/);
  });

  it('throws a record+field-named error on a non-number end', () => {
    expect(() =>
      featuresJson([{ type: 'DOMAIN', start: 1, end: 'zz' }])
    ).toThrow(/features-json: record 0, field "end": expected a number, got string/);
  });

  it('throws on a non-number score', () => {
    expect(() =>
      featuresJson([{ type: 'DOMAIN', start: 1, end: 5, score: 'high' }])
    ).toThrow(/features-json: record 0, field "score": expected a number, got string/);
  });

  it('throws on a present, non-string description — symmetric with score', () => {
    expect(() =>
      featuresJson([{ type: 'DOMAIN', start: 1, end: 5, description: 42 }])
    ).toThrow(
      /features-json: record 0, field "description": expected a string, got number/
    );
  });

  it('reports the correct index for a malformed record after valid ones', () => {
    const input = [
      { type: 'DOMAIN', start: 1, end: 5 },
      { type: 'SITE', start: 8, end: 8 },
      { type: 'REGION', start: 'x', end: 20 },
    ];
    expect(() => featuresJson(input)).toThrow(
      /features-json: record 2, field "start": expected a number, got string/
    );
  });

  it('throws when an element is not an object', () => {
    expect(() => featuresJson([{ type: 'DOMAIN', start: 1, end: 5 }, null])).toThrow(
      /features-json: record 1 is not an object \(got null\)/
    );
    expect(() => featuresJson(['nope'])).toThrow(
      /features-json: record 0 is not an object \(got string\)/
    );
    expect(() => featuresJson([[1, 2]])).toThrow(
      /features-json: record 0 is not an object \(got array\)/
    );
  });
});

describe('features-json adapter — extra fields (#283)', () => {
  const decode = (records: unknown[]) => {
    const warnings: DecodeWarning[] = [];
    const out = featuresJson(records, 'hits.json', warnings) as Array<
      Record<string, unknown>
    >;
    return { out, warnings };
  };

  it('puts canonical fields first, then the rest in key order', () => {
    const { out } = decode([
      { pmid: 'p', type: 'DOMAIN', color: 'red', end: 5, start: 1, gene: 'g' },
    ]);
    expect(Object.keys(out[0])).toEqual([
      'type',
      'start',
      'end',
      'pmid',
      'color',
      'gene',
    ]);
  });

  it('keeps nested extras by reference and does not copy `begin`', () => {
    const xrefs = [{ name: 'PDB', url: 'https://example.org/1abc' }];
    const meta = { a: 1 };
    const { out } = decode([
      { type: 'DOMAIN', begin: 4, end: 9, xrefs, meta, note: null },
    ]);
    expect(out[0]).toStrictEqual({
      type: 'DOMAIN',
      start: 4,
      end: 9,
      xrefs,
      meta,
      note: null,
    });
    expect(out[0].xrefs).toBe(xrefs);
    expect(out[0].meta).toBe(meta);
    expect('begin' in out[0]).toBe(false);
  });

  it('trims `color` / `shape` / `fill` and keeps a numeric `opacity`', () => {
    const { out } = decode([
      {
        type: 'DOMAIN',
        start: 1,
        end: 5,
        color: ' #1f77b4 ',
        shape: ' diamond ',
        fill: 'rgb(1, 2, 3)',
        opacity: 0,
      },
    ]);
    expect(out[0]).toStrictEqual({
      type: 'DOMAIN',
      start: 1,
      end: 5,
      color: '#1f77b4',
      shape: 'diamond',
      fill: 'rgb(1, 2, 3)',
      opacity: 0,
    });
  });

  it('leaves a `null` or empty render field off', () => {
    const { out } = decode([
      {
        type: 'DOMAIN',
        start: 1,
        end: 5,
        color: null,
        shape: '',
        fill: '   ',
        opacity: null,
      },
      { type: 'DOMAIN', start: 2, end: 6, color: '', opacity: '' },
    ]);
    expect(out).toStrictEqual([
      { type: 'DOMAIN', start: 1, end: 5 },
      { type: 'DOMAIN', start: 2, end: 6 },
    ]);
  });

  it('throws on a wrongly typed render field', () => {
    expect(() => decode([{ type: 'DOMAIN', start: 1, end: 5, color: 5 }])).toThrow(
      'hits.json: record 0, field "color": expected a string, got number.'
    );
    expect(() =>
      decode([{ type: 'DOMAIN', start: 1, end: 5 }, { type: 'D', start: 1, end: 2, shape: [] }])
    ).toThrow('hits.json: record 1, field "shape": expected a string, got array.');
    expect(() =>
      decode([{ type: 'DOMAIN', start: 1, end: 5, opacity: '0.5' }])
    ).toThrow(
      'hits.json: record 0, field "opacity": expected a number from 0 to 1, got string.'
    );
  });

  it('throws on an `opacity` outside 0..1', () => {
    expect(() =>
      decode([{ type: 'DOMAIN', start: 1, end: 5, opacity: 1.5 }])
    ).toThrow(
      'hits.json: record 0, field "opacity": expected a number from 0 to 1, got 1.5.'
    );
    expect(() =>
      decode([{ type: 'DOMAIN', start: 1, end: 5, opacity: -0.1 }])
    ).toThrow(/field "opacity": expected a number from 0 to 1, got -0\.1\./);
    expect(() =>
      decode([{ type: 'DOMAIN', start: 1, end: 5, opacity: NaN }])
    ).toThrow(/field "opacity": expected a number from 0 to 1, got NaN\./);
  });

  it('reports the whole-number error before looking at render fields', () => {
    expect(() =>
      decode([{ type: 'DOMAIN', start: 1.5, end: 5, color: 5 }])
    ).toThrow('hits.json: record 0, field "start": expected a whole number, got 1.5.');
  });

  it('drops viewer and Object.prototype names with one warning per call', () => {
    const { out, warnings } = decode([
      {
        type: 'DOMAIN',
        start: 1,
        end: 5,
        tooltipContent: '<img src=x onerror=alert(1)>',
        locations: 'nope',
        pmid: '1',
      },
      { type: 'DOMAIN', start: 2, end: 6, residuesToHighlight: 'x', toString: 'x' },
    ]);
    expect(out).toStrictEqual([
      { type: 'DOMAIN', start: 1, end: 5, pmid: '1' },
      { type: 'DOMAIN', start: 2, end: 6 },
    ]);
    expect(warnings).toEqual([
      {
        code: 'data-field-ignored',
        message:
          'hits.json: ignored column(s) "tooltipContent", "locations", ' +
          '"residuesToHighlight", "toString" — these names are reserved by ' +
          'the viewer or by JavaScript and cannot come from a data file.',
      },
    ]);
  });

  it('drops a `shape` that names an Object.prototype property, with one warning', () => {
    const { out, warnings } = decode([
      { type: 'DOMAIN', start: 1, end: 5, shape: 'hasOwnProperty' },
      { type: 'DOMAIN', start: 2, end: 6, shape: ' toString ', gene: 'g' },
      { type: 'DOMAIN', start: 3, end: 7, shape: 'chevron' },
    ]);
    expect(out).toStrictEqual([
      { type: 'DOMAIN', start: 1, end: 5 },
      { type: 'DOMAIN', start: 2, end: 6, gene: 'g' },
      { type: 'DOMAIN', start: 3, end: 7, shape: 'chevron' },
    ]);
    expect(warnings).toEqual([
      {
        code: 'data-field-ignored',
        message:
          'hits.json: ignored "shape" value(s) in 2 row(s) ("hasOwnProperty", ' +
          '"toString") — these names are reserved by JavaScript, so those ' +
          "features take the track's or type's shape.",
      },
    ]);
  });

  it('names a blocked key once even when every record carries it', () => {
    const { out, warnings } = decode([
      { type: 'DOMAIN', start: 1, end: 5, tooltipContent: 'a' },
      { type: 'DOMAIN', start: 2, end: 6, tooltipContent: 'b' },
    ]);
    expect(out).toStrictEqual([
      { type: 'DOMAIN', start: 1, end: 5 },
      { type: 'DOMAIN', start: 2, end: 6 },
    ]);
    expect(warnings).toEqual([
      {
        code: 'data-field-ignored',
        message:
          'hits.json: ignored column(s) "tooltipContent" — these names are ' +
          'reserved by the viewer or by JavaScript and cannot come from a ' +
          'data file.',
      },
    ]);
  });

  it('drops an own `__proto__` key from JSON.parse without touching the prototype', () => {
    const parsed = JSON.parse(
      '[{"type":"DOMAIN","start":1,"end":5,"__proto__":{"tooltipContent":"x"},"gene":"g"}]'
    );
    const { out, warnings } = decode(parsed);
    expect(Object.getPrototypeOf(out[0])).toBe(Object.prototype);
    expect(out[0].tooltipContent).toBeUndefined();
    expect(out[0]).toStrictEqual({ type: 'DOMAIN', start: 1, end: 5, gene: 'g' });
    expect(warnings.map((w) => w.code)).toEqual(['data-field-ignored']);
    expect(warnings[0].message).toContain('"__proto__"');
  });

  it('keeps an unpaintable colour and warns once, naming it', () => {
    const { out, warnings } = decode([
      { type: 'A', start: 1, end: 2, color: 'bleu' },
      { type: 'A', start: 1, end: 2, color: 'red' },
      { type: 'A', start: 1, end: 2, fill: '#catFace', color: 'bleu' },
    ]);
    expect(out[0].color).toBe('bleu');
    expect(out[2].fill).toBe('#catFace');
    expect(warnings).toEqual([
      {
        code: 'unpaintable-color',
        message:
          'hits.json: 2 row(s) have a colour the canvas cannot paint ' +
          '("bleu", "#catFace"); those features are drawn in the previous ' +
          "feature's colour.",
      },
    ]);
  });

  it('pushes no warnings when the call throws', () => {
    const warnings: DecodeWarning[] = [];
    expect(() =>
      featuresJson(
        [
          { type: 'A', start: 1, end: 2, tooltipContent: 'x', color: 'bleu' },
          { type: 'A', start: 1, end: 2, opacity: 2 },
        ],
        'hits.json',
        warnings
      )
    ).toThrow(/opacity/);
    expect(warnings).toEqual([]);
  });

  it('never logs, with or without a sink', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      featuresJson([{ type: 'A', start: 1, end: 2, tooltipContent: 'x', color: 'bleu' }]);
      decode([{ type: 'A', start: 1, end: 2, tooltipContent: 'x', color: 'bleu' }]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('drops an empty-string key whatever its value', () => {
    const { out, warnings } = decode([
      { type: 'A', start: 1, end: 2, '': 'x' },
      { type: 'A', start: 1, end: 2, '': 5 },
    ]);
    expect(out).toStrictEqual([
      { type: 'A', start: 1, end: 2 },
      { type: 'A', start: 1, end: 2 },
    ]);
    expect(warnings).toEqual([]);
  });
});
