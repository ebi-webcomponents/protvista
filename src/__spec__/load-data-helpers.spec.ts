/**
 * The loader's small pure helpers: `toUrlList`, the url-to-list
 * normalisation the dedupe pass and the per-track body lookup share, and
 * `filterByType`, the track-level `filter:` shortcut every source applies.
 */

import { describe, it, expect } from 'vitest';

import { filterByType, toUrlList } from '../load-data.js';

describe('toUrlList', () => {
  it('wraps a single URL template', () => {
    expect(toUrlList('https://x/{accession}')).toEqual([
      'https://x/{accession}',
    ]);
  });

  it('returns a list of URL templates as is', () => {
    const urls = ['./a.json', './b.json'];
    expect(toUrlList(urls)).toBe(urls);
  });

  it("reads an absent url as one empty template ['']", () => {
    expect(toUrlList(undefined)).toEqual(['']);
  });

  it('keeps an empty array empty', () => {
    expect(toUrlList([])).toEqual([]);
  });
});

describe('filterByType', () => {
  const items = [{ type: 'HELIX' }, { type: 'STRAND' }, {}];

  it('keeps only the array items whose type matches', () => {
    expect(filterByType(items, 'HELIX')).toEqual([{ type: 'HELIX' }]);
  });

  it('returns the payload itself when no filter is set', () => {
    expect(filterByType(items, undefined)).toBe(items);
    expect(filterByType(items, '')).toBe(items);
  });

  it('passes a non-array payload through untouched', () => {
    const wrapped = { variants: [{ type: 'HELIX' }] };
    expect(filterByType(wrapped, 'HELIX')).toBe(wrapped);
    expect(filterByType(null, 'HELIX')).toBeNull();
    expect(filterByType(undefined, 'HELIX')).toBeUndefined();
  });
});
