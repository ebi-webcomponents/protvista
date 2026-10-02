import { describe, it, expect } from 'vitest';
import {
  coordinateHint,
  findOutOfRange,
  formatOutOfRangeWarning,
  type CoordinateRow,
} from '../coordinates.js';
import type { DataFormat, ShapeName } from '../../types.js';

const START_HINT =
  "Coordinates must be 1-based positions on this protein's canonical sequence — check for 0-based coordinates (start 0) or isoform numbering.";
const POSITION_HINT =
  "Coordinates must be 1-based positions on this protein's canonical sequence — check for 0-based coordinates (position 0) or isoform numbering.";
const BED_HINT =
  "Coordinates must be positions on this protein's canonical sequence — check for isoform numbering.";

describe('findOutOfRange', () => {
  it('returns null when every field is within 1..length', () => {
    expect(
      findOutOfRange(
        [
          {
            row: 2,
            fields: [
              ['start', 1],
              ['end', 770],
            ],
          },
        ],
        770
      )
    ).toBeNull();
  });

  it('flags an end past the sequence and reports only that field', () => {
    const rows: CoordinateRow[] = [
      {
        row: 2,
        fields: [
          ['start', 1],
          ['end', 10],
        ],
      },
      {
        row: 7,
        fields: [
          ['start', 5],
          ['end', 812],
        ],
      },
    ];
    expect(findOutOfRange(rows, 770)).toEqual({
      count: 1,
      total: 2,
      first: { row: 7, fields: [['end', 812]] },
    });
  });

  it('flags a start below 1 (zero and negative)', () => {
    const found = findOutOfRange(
      [
        {
          row: 2,
          fields: [
            ['start', 0],
            ['end', 5],
          ],
        },
        {
          row: 3,
          fields: [
            ['start', -3],
            ['end', 5],
          ],
        },
      ],
      770
    );
    expect(found?.count).toBe(2);
    expect(found?.first.fields).toEqual([['start', 0]]);
  });

  it('counts a row out of range on both sides once and names both fields in order', () => {
    const found = findOutOfRange(
      [
        {
          row: 7,
          fields: [
            ['start', 0],
            ['end', 812],
          ],
        },
      ],
      770
    );
    expect(found?.count).toBe(1);
    expect(found?.first.fields).toEqual([
      ['start', 0],
      ['end', 812],
    ]);
  });

  it('names both fields when the whole interval lies past the end', () => {
    const found = findOutOfRange(
      [
        {
          row: 2,
          fields: [
            ['start', 900],
            ['end', 950],
          ],
        },
      ],
      770
    );
    expect(found?.first.fields).toEqual([
      ['start', 900],
      ['end', 950],
    ]);
  });

  it('checks position fields', () => {
    const found = findOutOfRange(
      [{ row: 0, fields: [['position', 812]] }],
      770
    );
    expect(found?.first.fields).toEqual([['position', 812]]);
  });

  it('ignores rows with no fields but counts them in the total', () => {
    const found = findOutOfRange(
      [
        { row: 0, fields: [] },
        { row: 1, fields: [['position', 0]] },
      ],
      770
    );
    expect(found?.count).toBe(1);
    expect(found?.total).toBe(2);
    expect(found?.first.row).toBe(1);
  });

  it('picks the first offending row in row order', () => {
    const found = findOutOfRange(
      [
        { row: 1, fields: [['position', 5]] },
        { row: 2, fields: [['position', 900]] },
        { row: 3, fields: [['position', 0]] },
      ],
      770
    );
    expect(found?.count).toBe(2);
    expect(found?.first).toEqual({ row: 2, fields: [['position', 900]] });
  });
});

describe('coordinateHint', () => {
  it('uses the (start 0) hint for non-BED feature tracks', () => {
    for (const format of ['csv', 'json', 'tsv'] as const) {
      expect(coordinateHint('feature', format)).toBe(START_HINT);
    }
  });

  it('uses the BED hint, without the 0-based clause, for BED', () => {
    const hint = coordinateHint('feature', 'bed');
    expect(hint).toBe(BED_HINT);
    expect(hint).not.toContain('0-based');
  });

  it('uses the (position 0) hint for point and variation tracks', () => {
    expect(coordinateHint('point', 'csv')).toBe(POSITION_HINT);
    expect(coordinateHint('variation', 'json')).toBe(POSITION_HINT);
  });
});

describe('formatOutOfRangeWarning', () => {
  it('matches the agreed CSV wording exactly', () => {
    expect(
      formatOutOfRangeWarning(
        {
          label: './hits.csv (parsed as CSV)',
          shape: 'feature',
          format: 'csv',
        },
        'P05067',
        770,
        { count: 12, total: 340, first: { row: 7, fields: [['end', 812]] } }
      )
    ).toBe(
      "./hits.csv (parsed as CSV): 12 of 340 rows fall outside P05067 (770 residues); first: row 7, end 812. Coordinates must be 1-based positions on this protein's canonical sequence — check for 0-based coordinates (start 0) or isoform numbering."
    );
  });

  it('names every out-of-range field of the first row', () => {
    const message = formatOutOfRangeWarning(
      { label: './hits.csv (parsed as CSV)', shape: 'feature', format: 'csv' },
      'P05067',
      770,
      {
        count: 1,
        total: 3,
        first: {
          row: 7,
          fields: [
            ['start', 0],
            ['end', 812],
          ],
        },
      }
    );
    expect(message).toContain('first: row 7, start 0, end 812.');
  });

  it('uses the BED hint for BED tracks', () => {
    const message = formatOutOfRangeWarning(
      {
        label: './regions.bed (parsed as BED)',
        shape: 'feature',
        format: 'bed',
      },
      'P05067',
      770,
      { count: 1, total: 1, first: { row: 7, fields: [['end', 812]] } }
    );
    expect(
      message.endsWith(
        "first: row 7, end 812. Coordinates must be positions on this protein's canonical sequence — check for isoform numbering."
      )
    ).toBe(true);
  });

  it('uses the position hint for point/variation tracks', () => {
    const message = formatOutOfRangeWarning(
      { label: './v.csv (parsed as CSV)', shape: 'variation', format: 'csv' },
      'P05067',
      770,
      { count: 1, total: 1, first: { row: 7, fields: [['position', 812]] } }
    );
    expect(message).toContain(
      "first: row 7, position 812. Coordinates must be 1-based positions on this protein's canonical sequence — check for 0-based coordinates (position 0) or isoform numbering."
    );
    expect(message).not.toContain('(start 0)');
  });

  it('uses no adapter or internal vocabulary', () => {
    const cases: Array<[string, ShapeName, DataFormat, CoordinateRow]> = [
      [
        './hits.csv (parsed as CSV)',
        'feature',
        'csv',
        {
          row: 7,
          fields: [
            ['start', 0],
            ['end', 812],
          ],
        },
      ],
      [
        './regions.bed (parsed as BED)',
        'feature',
        'bed',
        { row: 7, fields: [['end', 812]] },
      ],
      [
        './v.csv (parsed as CSV)',
        'variation',
        'csv',
        { row: 7, fields: [['position', 812]] },
      ],
    ];
    for (const [label, shape, format, first] of cases) {
      const message = formatOutOfRangeWarning(
        { label, shape, format },
        'P05067',
        770,
        { count: 1, total: 2, first }
      );
      for (const word of ['adapter', 'record', 'features-', 'aa)', '=']) {
        expect(message).not.toContain(word);
      }
    }
  });
});
