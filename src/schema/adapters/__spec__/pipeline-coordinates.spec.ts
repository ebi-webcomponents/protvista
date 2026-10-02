import { describe, it, expect, vi, afterEach } from 'vitest';
import { runPipeline } from '../pipeline.js';
import type { CoordinateRow } from '../coordinates.js';
import type { DataFormat, ShapeName } from '../../types.js';

const collect = (shape: ShapeName, format: DataFormat, body: unknown) => {
  const coordinates: CoordinateRow[] = [];
  const payload = runPipeline(shape, format, body, {
    source: './x',
    coordinates,
  });
  return { payload, coordinates };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runPipeline coordinate sink', () => {
  it('numbers CSV feature rows from the header as row 1, skipping blank rows', () => {
    const { coordinates } = collect(
      'feature',
      'csv',
      'type,start,end,description\nDOMAIN,1,10,a\n\nSITE,5,812,b\n'
    );
    expect(coordinates).toEqual([
      {
        row: 2,
        fields: [
          ['start', 1],
          ['end', 10],
        ],
      },
      {
        row: 4,
        fields: [
          ['start', 5],
          ['end', 812],
        ],
      },
    ]);
  });

  it('numbers TSV point rows the same way and reads position only', () => {
    const { coordinates } = collect(
      'point',
      'tsv',
      'position\tvalue\n3\t0.5\n9\t1\n'
    );
    expect(coordinates).toEqual([
      { row: 2, fields: [['position', 3]] },
      { row: 3, fields: [['position', 9]] },
    ]);
  });

  it('numbers CSV variation rows and reads position', () => {
    const { coordinates } = collect(
      'variation',
      'csv',
      'position,variant\n42,K\n'
    );
    expect(coordinates).toEqual([{ row: 2, fields: [['position', 42]] }]);
  });

  it('uses BED physical lines and the shifted 1-based coordinates', () => {
    const { coordinates } = collect(
      'feature',
      'bed',
      '# comment\nchr1\t0\t10\nchr1\t5\t5\n'
    );
    expect(coordinates).toEqual([
      {
        row: 2,
        fields: [
          ['start', 1],
          ['end', 10],
        ],
      },
      // Zero-length feature: a single residue at chromStart + 1.
      {
        row: 3,
        fields: [
          ['start', 6],
          ['end', 6],
        ],
      },
    ]);
  });

  it('uses the 0-based index for JSON features, naming begin as start', () => {
    const { coordinates } = collect('feature', 'json', [
      { type: 'A', begin: 3, end: 4 },
      { type: 'B', start: 1, end: 900 },
    ]);
    expect(coordinates).toEqual([
      {
        row: 0,
        fields: [
          ['start', 3],
          ['end', 4],
        ],
      },
      {
        row: 1,
        fields: [
          ['start', 1],
          ['end', 900],
        ],
      },
    ]);
  });

  it('uses the 0-based index for JSON point and variation records', () => {
    expect(
      collect('point', 'json', [{ position: 5, value: 1 }]).coordinates
    ).toEqual([{ row: 0, fields: [['position', 5]] }]);
    expect(
      collect('variation', 'json', [{ position: 7, variant: 'K' }]).coordinates
    ).toEqual([{ row: 0, fields: [['position', 7]] }]);
  });

  it('returns the same payload with or without the sink', () => {
    const cases: Array<[ShapeName, DataFormat, unknown]> = [
      ['feature', 'csv', 'type,start,end,description,score\nDOMAIN,1,10,a,2\n'],
      ['point', 'csv', 'position,value\n3,0.5\n'],
      ['variation', 'json', [{ position: 7, variant: 'K' }]],
      ['feature', 'bed', 'chr1\t0\t10\tname\t5\n'],
    ];
    for (const [shape, format, body] of cases) {
      const plain = runPipeline(shape, format, body, { source: './x' });
      const { payload } = collect(shape, format, body);
      expect(payload).toEqual(plain);
      if (shape === 'feature') {
        for (const item of payload as object[]) {
          for (const key of Object.keys(item)) {
            expect(['type', 'start', 'end', 'description', 'score']).toContain(
              key
            );
          }
        }
      }
    }
  });

  it('adds nothing for a non-text delimited body', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(collect('feature', 'csv', 42).coordinates).toEqual([]);
  });
});
