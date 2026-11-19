/**
 * `uniprot-variation-counts-json`: per-residue variant counts for the line
 * graph. Positions are 1-based, so the series covers `1..sequence.length`
 * and a variant on the last residue must be counted (#304).
 */

import { describe, it, expect } from 'vitest';

import { variationGraphAdapter } from '../variation-graph-adapter.js';

type Series = {
  name: string;
  range: [number, number];
  color: string;
  values: Array<{ position: number; value: number }>;
};

const SEQUENCE = 'MKTAY'; // 5 residues

const run = (features: unknown[]) =>
  variationGraphAdapter({ sequence: SEQUENCE, features }) as Series[];

/** The series' values as `[position, value]` pairs, for compact assertions. */
const counts = (series: Series) =>
  series.values.map(({ position, value }) => [position, value]);

describe('variationGraphAdapter', () => {
  const features = [
    { begin: '1' }, // first residue
    { begin: 5 }, // last residue
    { begin: '3', association: [{ disease: false }, { disease: true }] },
    { begin: '3', association: [{ disease: false }] },
  ];

  it('counts variants on the first and last residue, one value per residue', () => {
    const [variant] = run(features);

    expect(variant.name).toBe('variant');
    expect(counts(variant)).toEqual([
      [1, 1],
      [2, 0],
      [3, 2],
      [4, 0],
      [5, 1],
    ]);
  });

  it('counts only disease-associated variants in the disease series', () => {
    const [, disease] = run(features);

    expect(disease.name).toBe('disease causing variant');
    expect(counts(disease)).toEqual([
      [1, 0],
      [2, 0],
      [3, 1],
      [4, 0],
      [5, 0],
    ]);
  });

  it('shares one range across both series', () => {
    const [variant, disease] = run(features);

    expect(variant.range).toEqual([0, 2]);
    expect(disease.range).toEqual([0, 2]);
  });

  it('ignores out-of-range positions without throwing', () => {
    const [variant, disease] = run([
      { begin: 0 },
      { begin: '-1', association: [{ disease: true }] },
      { begin: 6, association: [{ disease: true }] },
      { begin: 'not-a-number' },
      { begin: 5 },
    ]);

    expect(counts(variant)).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 1],
    ]);
    expect(disease.values.every(({ value }) => value === 0)).toBe(true);
  });

  it('never emits a value for position 0', () => {
    for (const series of run([{ begin: 0 }, { begin: 1 }])) {
      expect(series.values.map(({ position }) => position)).toEqual([
        1, 2, 3, 4, 5,
      ]);
    }
  });

  it('does not saturate at 255 variants per residue', () => {
    const [variant] = run(Array.from({ length: 300 }, () => ({ begin: 2 })));

    expect(variant.values[1]).toEqual({ position: 2, value: 300 });
    expect(variant.range).toEqual([0, 300]);
  });
});
