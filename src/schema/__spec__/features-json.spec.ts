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
 *   - the non-array guard throwing, naming the type it got.
 */

import { describe, it, expect } from 'vitest';
import { featuresJson } from '../adapters/features-json.js';

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

  it('drops extra fields — output is the canonical record shape only', () => {
    expect(
      featuresJson([{ type: 'DOMAIN', start: 1, end: 5, color: 'red', foo: 42 }])
    ).toEqual([{ type: 'DOMAIN', start: 1, end: 5 }]);
  });

  it('accepts an empty array', () => {
    expect(featuresJson([])).toEqual([]);
  });

  it('accepts a prototype-less record (Object.create(null))', () => {
    const record = Object.assign(Object.create(null), {
      type: 'DOMAIN',
      start: 1,
      end: 5,
    });
    expect(featuresJson([record])).toEqual([
      { type: 'DOMAIN', start: 1, end: 5 },
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
