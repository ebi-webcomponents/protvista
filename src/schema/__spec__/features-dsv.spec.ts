/**
 * Unit tests for the delimited generic-format adapters and their shared
 * parser core.
 *
 * Covers:
 *   - the RFC-4180 tokenizer (`parseDelimited`): quoted delimiters,
 *     escaped quotes, embedded newlines, CRLF, trailing newline;
 *   - `features-csv` / `features-tsv` happy path → feature records
 *     (`type`, `start`, `end`, optional `description` / `score`);
 *   - strict, row/column-named errors on malformed input (missing
 *     header column, non-numeric coordinate, ragged row);
 *   - the non-string guard returning `[]`.
 */

import { describe, it, expect, vi } from 'vitest';
import { parseDelimited, rowsToFeatureRecords } from '../adapters/dsv';
import { featuresCsv } from '../adapters/features-csv';
import { featuresTsv } from '../adapters/features-tsv';

// ─────────────────────────────────────────────────────────────
// parseDelimited — RFC-4180 tokenizer
// ─────────────────────────────────────────────────────────────

describe('parseDelimited', () => {
  it('splits simple comma rows', () => {
    expect(parseDelimited('a,b,c\n1,2,3', ',')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps a delimiter inside a quoted field', () => {
    expect(parseDelimited('type,description\nDOMAIN,"a, b, c"', ',')).toEqual([
      ['type', 'description'],
      ['DOMAIN', 'a, b, c'],
    ]);
  });

  it('unescapes a doubled quote inside a quoted field', () => {
    expect(parseDelimited('x\n"she said ""hi"""', ',')).toEqual([
      ['x'],
      ['she said "hi"'],
    ]);
  });

  it('keeps an embedded newline inside a quoted field', () => {
    expect(parseDelimited('x\n"line1\nline2"', ',')).toEqual([
      ['x'],
      ['line1\nline2'],
    ]);
  });

  it('handles CRLF line endings and a trailing newline', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('tokenizes tabs for the TSV case', () => {
    expect(parseDelimited('a\tb\n1\t2', '\t')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('returns no rows for empty input', () => {
    expect(parseDelimited('', ',')).toEqual([]);
  });

  it('does not append a spurious empty row for a trailing newline', () => {
    expect(parseDelimited('a\n', ',')).toEqual([['a']]);
  });

  it('preserves a final quoted-empty field as its own row', () => {
    // Regression guard for the flush condition: a trailing `""` row must
    // not be dropped (matters for the reusable headerless case).
    expect(parseDelimited('a\n""', ',')).toEqual([['a'], ['']]);
  });
});

// ─────────────────────────────────────────────────────────────
// features-csv — happy path
// ─────────────────────────────────────────────────────────────

describe('features-csv adapter', () => {
  it('parses the documented header into feature records', () => {
    const csv =
      'type,start,end,description,score\n' +
      'DOMAIN,10,25,Kinase domain,0.9\n' +
      'SITE,42,42,Active site,0.5';
    expect(featuresCsv(csv)).toEqual([
      {
        type: 'DOMAIN',
        start: 10,
        end: 25,
        description: 'Kinase domain',
        score: 0.9,
      },
      { type: 'SITE', start: 42, end: 42, description: 'Active site', score: 0.5 },
    ]);
  });

  it('omits description/score when absent or empty', () => {
    const csv = 'type,start,end,description\nDOMAIN,1,5,';
    expect(featuresCsv(csv)).toEqual([{ type: 'DOMAIN', start: 1, end: 5 }]);
  });

  it('accepts a quoted comma in the description', () => {
    const csv =
      'type,start,end,description\nDOMAIN,1,5,"binds ATP, Mg2+"';
    expect(featuresCsv(csv)).toEqual([
      { type: 'DOMAIN', start: 1, end: 5, description: 'binds ATP, Mg2+' },
    ]);
  });

  it('throws a row+column-named error on a non-numeric start', () => {
    const csv = 'type,start,end,description\nDOMAIN,abc,5,x';
    expect(() => featuresCsv(csv)).toThrow(
      /features-csv: row 2, column "start": expected a number, got "abc"/
    );
  });

  it('throws naming the missing required header column', () => {
    const csv = 'type,start,description\nDOMAIN,1,x';
    expect(() => featuresCsv(csv)).toThrow(
      /features-csv: missing required header column "end"/
    );
  });

  it('throws on a ragged row', () => {
    const csv = 'type,start,end,description\nDOMAIN,1,5';
    expect(() => featuresCsv(csv)).toThrow(
      /features-csv: row 2 is ragged — expected 4 columns, got 3/
    );
  });

  it('numbers rows by record even when a quoted field spans physical lines', () => {
    // Row 2 is valid but its description contains an embedded newline; the
    // malformed row 3 must still be reported as "row 3" (record-based, not
    // physical-line-based).
    const csv =
      'type,start,end,description\n' +
      'DOMAIN,1,5,"multi\nline note"\n' +
      'SITE,x,9,bad';
    expect(() => featuresCsv(csv)).toThrow(
      /features-csv: row 3, column "start": expected a number, got "x"/
    );
  });

  it('rejects a non-decimal numeric literal (hex) rather than coercing it', () => {
    // Number('0x10') is 16; the adapter must not silently accept it.
    const csv = 'type,start,end,description\nDOMAIN,0x10,25,x';
    expect(() => featuresCsv(csv)).toThrow(
      /features-csv: row 2, column "start": expected a number, got "0x10"/
    );
  });

  it('throws on a duplicate header column', () => {
    const csv = 'type,start,end,start,description\nDOMAIN,1,5,2,x';
    expect(() => featuresCsv(csv)).toThrow(
      /features-csv: duplicate header column "start"/
    );
  });

  it('returns [] and warns with a descriptive message on a non-string body', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(featuresCsv({ not: 'text' })).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('expected a text body')
    );
    warn.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────
// features-tsv — same behaviour, tab-delimited
// ─────────────────────────────────────────────────────────────

describe('features-tsv adapter', () => {
  it('parses tab-separated rows into feature records', () => {
    const tsv = 'type\tstart\tend\tdescription\nDOMAIN\t10\t25\tKinase domain';
    expect(featuresTsv(tsv)).toEqual([
      { type: 'DOMAIN', start: 10, end: 25, description: 'Kinase domain' },
    ]);
  });

  it('throws a row+column-named error on a non-numeric end', () => {
    const tsv = 'type\tstart\tend\tdescription\nDOMAIN\t1\tzz\tx';
    expect(() => featuresTsv(tsv)).toThrow(
      /features-tsv: row 2, column "end": expected a number, got "zz"/
    );
  });

  it('keeps a tab-free description with commas verbatim (no CSV quoting rules)', () => {
    const tsv = 'type\tstart\tend\tdescription\nDOMAIN\t1\t5\tbinds ATP, Mg2+';
    expect(featuresTsv(tsv)).toEqual([
      { type: 'DOMAIN', start: 1, end: 5, description: 'binds ATP, Mg2+' },
    ]);
  });

  it('returns [] and warns with a descriptive message on a non-string body', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(featuresTsv(42)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('expected a text body')
    );
    warn.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────
// rowsToFeatureRecords — shared edge cases
// ─────────────────────────────────────────────────────────────

describe('rowsToFeatureRecords', () => {
  it('returns [] for no rows', () => {
    expect(rowsToFeatureRecords([], { formatLabel: 'features-csv' })).toEqual([]);
  });

  it('rejects a non-numeric score', () => {
    const rows = [
      ['type', 'start', 'end', 'description', 'score'],
      ['DOMAIN', '1', '5', 'x', 'high'],
    ];
    expect(() =>
      rowsToFeatureRecords(rows, { formatLabel: 'features-csv' })
    ).toThrow(/row 2, column "score": expected a number, got "high"/);
  });
});
