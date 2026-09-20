/**
 * `linegraph-csv` / `linegraph-tsv` — the delimited forms of the
 * `kind: linegraph` records.
 *
 * The parsing discipline (quoting, ragged rows, the number grammar) is
 * already pinned by the `features-csv` / `features-tsv` suites over the same
 * `parseDelimited` / `parseDecimal` core, so this covers what is specific to
 * the point layer: the `position,value` header contract, its error messages,
 * and that all three transports of this kind land on one identical series.
 */

import { describe, it, expect, vi } from 'vitest';
import { linegraphCsv } from '../linegraph-csv.js';
import { linegraphTsv } from '../linegraph-tsv.js';
import { linegraph, LINE_COLOR } from '../linegraph.js';

const CSV = 'position,value\n1,412\n30,688\n60,905\n';
const TSV = CSV.replace(/,/g, '\t');

describe('linegraph-csv / linegraph-tsv', () => {
  it('parses a position,value body into one line-graph series', () => {
    expect(linegraphCsv(CSV)).toEqual([
      {
        name: 'value',
        color: LINE_COLOR,
        range: [412, 905],
        values: [
          { position: 1, value: 412 },
          { position: 30, value: 688 },
          { position: 60, value: 905 },
        ],
      },
    ]);
  });

  it('emits byte-identical series for CSV, TSV and the JSON adapter', () => {
    const fromJson = linegraph([
      { position: 1, value: 412 },
      { position: 30, value: 688 },
      { position: 60, value: 905 },
    ]);
    expect(linegraphCsv(CSV)).toEqual(fromJson);
    expect(linegraphTsv(TSV)).toEqual(fromJson);
  });

  it('accepts the columns in either order and ignores extra ones', () => {
    expect(linegraphCsv('value,label,position\n7,a,1\n')).toEqual([
      {
        name: 'value',
        color: LINE_COLOR,
        range: [0, 14],
        values: [{ position: 1, value: 7 }],
      },
    ]);
  });

  it('preserves file order — it does not sort by position', () => {
    const series = linegraphCsv('position,value\n60,1\n1,5\n') as Array<{
      values: unknown[];
    }>;
    expect(series[0].values).toEqual([
      { position: 60, value: 1 },
      { position: 1, value: 5 },
    ]);
  });

  it('returns an empty series for an empty body', () => {
    expect(linegraphCsv('')).toEqual([]);
    expect(linegraphCsv('position,value\n')).toEqual([]);
  });

  it('names the missing column when the header is wrong', () => {
    expect(() => linegraphCsv('type,start,end\nBINDING,1,2\n')).toThrow(
      'linegraph-csv: missing required header column "position". ' +
        'Header must contain position, value.'
    );
    expect(() => linegraphTsv('position\t\n1\t\n')).toThrow(
      'linegraph-tsv: missing required header column "value".'
    );
  });

  it('names the row and column for a non-numeric cell', () => {
    expect(() => linegraphCsv('position,value\n1,412\n2,abc\n')).toThrow(
      'linegraph-csv: row 3, column "value": expected a number, got "abc".'
    );
  });

  it('rejects a ragged row by line number', () => {
    expect(() => linegraphCsv('position,value\n1,412\n2\n')).toThrow(
      'linegraph-csv: row 3 is ragged — expected 2 columns, got 1.'
    );
  });

  it('rejects a duplicate header column', () => {
    expect(() => linegraphCsv('position,value,value\n1,2,3\n')).toThrow(
      'linegraph-csv: duplicate header column "value".'
    );
  });

  it('accepts the trailing blank line a spreadsheet export leaves', () => {
    // "Save as CSV" ends the file with a newline-terminated blank line. That
    // used to be read as a ragged row and rejected the whole file, failing
    // the least technical authors at their first step — while `bed.ts` had
    // always skipped blank lines.
    expect(linegraphCsv('position,value\n1,412\n30,688\n\n')).toEqual(
      linegraphCsv('position,value\n1,412\n30,688\n')
    );
    expect(linegraphTsv('position\tvalue\n1\t412\n\n')).toEqual(
      linegraphTsv('position\tvalue\n1\t412\n')
    );
  });

  it('skips blank lines anywhere, and still numbers the rows by line', () => {
    // Skipping happens in the row consumer, not the tokenizer, so a later
    // error still names the physical line the author has to go and look at.
    expect(linegraphCsv('position,value\n1,412\n\n60,905\n')).toEqual(
      linegraphCsv('position,value\n1,412\n60,905\n')
    );
    expect(() => linegraphCsv('position,value\n1,412\n\n60,abc\n')).toThrow(
      'linegraph-csv: row 4, column "value": expected a number, got "abc".'
    );
  });

  it('accepts a header column named after an Object.prototype member', () => {
    // The index used to be an object literal, so `'toString' in index` was
    // true before any column was read: a file with a `toString` column was
    // rejected as a duplicate, contradicting "extra columns are ignored".
    for (const name of ['toString', 'constructor', 'valueOf', '__proto__']) {
      expect(
        linegraphCsv(`position,value,${name}\n1,412,x\n`),
        `column named ${name}`
      ).toEqual(linegraphCsv('position,value\n1,412\n'));
    }
  });

  it('warns and renders empty when handed a non-text body', () => {
    // The loader fetches these as text; a JSON body here means the wiring
    // broke, and one track degrading beats the viewer throwing.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(linegraphCsv([{ position: 1, value: 2 }] as never)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('linegraph-csv adapter: expected a text body')
    );
    warn.mockRestore();
  });
});
