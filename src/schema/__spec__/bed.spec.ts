/**
 * Unit tests for the `bed` generic-format adapter.
 *
 * Covers:
 *   - the BED 0-based half-open → viewer 1-based inclusive coordinate
 *     shift, pinned with a hand-checked fixture on both edges;
 *   - BED3/BED4/BED5/BED6 column mapping (name → description, verbatim
 *     score, dropped strand, synthesised `type: 'BED'`);
 *   - comment / `track` / `browser` / blank-line skipping;
 *   - strict, line-named errors on malformed input (fewer than 3 columns,
 *     a non-numeric coordinate);
 *   - the non-string guard returning `[]`.
 */

import { describe, it, expect, vi } from 'vitest';
import { bed } from '../adapters/bed';

describe('bed adapter', () => {
  it('shifts BED 0-based half-open coordinates to 1-based inclusive', () => {
    // The load-bearing correctness case. A hand-checked BED6 interval:
    //   chromStart 100 (0-based) → start 101 (1-based)
    //   chromEnd   200 (half-open, exclusive) → end 200 (inclusive)
    // `name` maps to description; `score` passes through verbatim; strand
    // is dropped; `type` is synthesised as 'BED'.
    const src = 'chr1\t100\t200\tpeak1\t500\t+';
    const [rec] = bed(src) as Array<Record<string, unknown>>;

    expect(rec.start).toBe(101);
    expect(rec.end).toBe(200);
    expect(rec).toEqual({
      type: 'BED',
      start: 101,
      end: 200,
      description: 'peak1',
      score: 500,
    });
  });

  it('parses a BED3 minimal record, shifting the 0-start edge to 1', () => {
    // No name/score columns → no `description`/`score` keys emitted.
    // chromStart 0 → start 1 pins the low edge of the shift.
    expect(bed('chr1\t0\t10')).toEqual([{ type: 'BED', start: 1, end: 10 }]);
  });

  it('renders a zero-length feature (chromStart === chromEnd) as a single-base point', () => {
    // Spec-legal insertion point: the empty half-open span collapses to a
    // 1-based point with start === end (not the inverted {start: 6, end: 5}).
    expect(bed('chr1\t5\t5')).toEqual([{ type: 'BED', start: 6, end: 6 }]);
  });

  it('throws a line-named error on a genuinely inverted interval (end < start)', () => {
    expect(() => bed('chr1\t5\t4')).toThrow(
      /bed: line 1: end \(4\) is before start \(5\) \(BED columns 2–3\)\./
    );
  });

  it('maps BED4 name → description without a score', () => {
    expect(bed('chr1\t5\t9\tregion-a')).toEqual([
      { type: 'BED', start: 6, end: 9, description: 'region-a' },
    ]);
  });

  it('preserves a literal "." name (a valid BED name, not an empty cell)', () => {
    expect(bed('chr1\t5\t9\t.')).toEqual([
      { type: 'BED', start: 6, end: 9, description: '.' },
    ]);
  });

  it('passes an out-of-range score through verbatim (no 0–1000 → 0–1 shift)', () => {
    // Guards the load-bearing "no renormalise" decision: an in-range 500
    // would look identical whether or not a /1000 shift existed.
    expect(bed('chr1\t100\t200\tpeak\t9999')).toEqual([
      { type: 'BED', start: 101, end: 200, description: 'peak', score: 9999 },
    ]);
  });

  it('accepts fractional and negative scores (real-world BED, matching CSV/TSV)', () => {
    // Peak-callers / p-value tracks write floats and signed values into the
    // score column; the adapter must not reject them.
    expect(bed('chr1\t100\t200\tpeak\t35.7')[0]).toMatchObject({ score: 35.7 });
    expect(bed('chr1\t100\t200\tpeak\t-10.2')[0]).toMatchObject({ score: -10.2 });
  });

  it('omits description/score when the BED4/BED5 cells are empty', () => {
    // Trailing empty `name` and `score` fields must not produce an empty
    // description or a NaN score.
    expect(bed('chr1\t5\t9\t\t')).toEqual([{ type: 'BED', start: 6, end: 9 }]);
  });

  it('skips blank lines and browser / track / comment header lines', () => {
    const src = [
      'browser position chr1:1-1000',
      'track name="peaks" description="demo"',
      '# a comment',
      '',
      'chr1\t100\t200\tpeak1',
      '   ',
      'chr1\t300\t400\tpeak2',
    ].join('\n');

    expect(bed(src)).toEqual([
      { type: 'BED', start: 101, end: 200, description: 'peak1' },
      { type: 'BED', start: 301, end: 400, description: 'peak2' },
    ]);
  });

  it('skips an indented comment line rather than parsing it as data', () => {
    expect(bed('  # indented note\nchr1\t100\t200')).toEqual([
      { type: 'BED', start: 101, end: 200 },
    ]);
  });

  it('returns [] for empty input', () => {
    expect(bed('')).toEqual([]);
  });

  it('handles CRLF line endings and a trailing newline', () => {
    expect(bed('chr1\t100\t200\tpeak1\r\nchr1\t300\t400\tpeak2\r\n')).toEqual([
      { type: 'BED', start: 101, end: 200, description: 'peak1' },
      { type: 'BED', start: 301, end: 400, description: 'peak2' },
    ]);
  });

  it('throws a line-named error when a row has fewer than 3 columns', () => {
    expect(() => bed('chr1\t100')).toThrow(
      /bed: line 1: expected at least 3 tab-separated columns \(chrom, start, end\), got 2\./
    );
  });

  it('throws a line-named error on a non-numeric start coordinate', () => {
    expect(() => bed('chr1\tabc\t200')).toThrow(
      /bed: line 1: non-numeric start coordinate "abc" \(BED column 2\)\./
    );
  });

  it('names the offending physical line even after skipped header lines', () => {
    const src = ['# header', 'chr1\t100\t200', 'chr1\t300\txyz'].join('\n');
    expect(() => bed(src)).toThrow(
      /bed: line 3: non-numeric end coordinate "xyz" \(BED column 3\)\./
    );
  });

  it('rejects a non-integer coordinate rather than coercing it', () => {
    // Number('1.5') would be 1.5; the adapter must not silently accept it.
    expect(() => bed('chr1\t1.5\t9')).toThrow(
      /bed: line 1: non-numeric start coordinate "1\.5" \(BED column 2\)\./
    );
  });

  it('throws on a non-numeric score column', () => {
    expect(() => bed('chr1\t100\t200\tpeak1\thigh')).toThrow(
      /bed: line 1: non-numeric score "high" \(BED column 5\)\./
    );
  });

  it('returns [] and warns with a descriptive message on a non-string body', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(bed({ not: 'text' })).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('expected a text body')
    );
    warn.mockRestore();
  });
});
