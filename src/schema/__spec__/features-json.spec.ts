/**
 * Unit tests for the `features-json` generic-format adapter.
 *
 * Covers:
 *   - happy path: an array of feature objects → clean feature records
 *     (`type`, `start`, `end`, optional `description` / `score`);
 *   - the `begin` alias normalising to `start` (and `start` winning when
 *     both are present);
 *   - `description` / `score` omitted when absent or empty;
 *   - strict, record/field-named errors on malformed input (non-string
 *     `type`, non-number `start` / `end` / `score`, non-object element);
 *   - the non-array guard returning `[]` with a warning.
 */

import { describe, it, expect, vi } from 'vitest';
import { featuresJson } from '../adapters/features-json';

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

  it('returns [] and warns with a descriptive message on a non-array body', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(featuresJson({ not: 'an array' })).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('expected an array')
    );
    warn.mockRestore();
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
      /features-json: record 0 is not an object \(got object\)/
    );
  });
});
