/**
 * `uniprot-rna-editing-counts-json`: per-residue missense RNA-editing counts
 * for the line graph. Positions are 1-based, so the series covers
 * `1..sequence.length` and an event on the last residue must be counted
 * (#304).
 */

import { describe, it, expect } from 'vitest';

import { rnaEditingGraphAdapter } from '../rna-editing-graph-adapter.js';

type Series = {
  name: string;
  range: [number, number];
  color: string;
  values: Array<{ position: number; value: number }>;
};

const SEQUENCE = 'MKTAY'; // 5 residues

/** The minimum of an API feature the adapter reads. */
const event = (position: number, consequenceType = 'missense') => ({
  locationType: { position: { position, status: 'certain' } },
  variantType: { consequenceType },
});

const run = (features: unknown[]) =>
  rnaEditingGraphAdapter({ sequence: SEQUENCE, features }) as Series[];

/** The series' values as `[position, value]` pairs, for compact assertions. */
const counts = (series: Series) =>
  series.values.map(({ position, value }) => [position, value]);

describe('rnaEditingGraphAdapter', () => {
  it('counts missense events on the first and last residue, one value per residue', () => {
    const [missense] = run([event(1), event(5), event(3), event(3)]);

    expect(missense.name).toBe('missense');
    expect(counts(missense)).toEqual([
      [1, 1],
      [2, 0],
      [3, 2],
      [4, 0],
      [5, 1],
    ]);
    expect(missense.range).toEqual([0, 2]);
  });

  it('leaves non-missense events out of the missense series', () => {
    const [missense] = run([event(2), event(2, 'synonymous')]);

    expect(missense.values[1]).toEqual({ position: 2, value: 1 });
  });

  it('ignores out-of-range positions without throwing', () => {
    const [missense] = run([event(0), event(-1), event(6), event(5)]);

    expect(counts(missense)).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 1],
    ]);
    expect(missense.range).toEqual([0, 1]);
  });

  it('never emits a value for position 0', () => {
    const [missense] = run([event(0), event(1)]);

    expect(missense.values.map(({ position }) => position)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('does not saturate at 255 events per residue', () => {
    const [missense] = run(Array.from({ length: 300 }, () => event(4)));

    expect(missense.values[3]).toEqual({ position: 4, value: 300 });
    expect(missense.range).toEqual([0, 300]);
  });
});
