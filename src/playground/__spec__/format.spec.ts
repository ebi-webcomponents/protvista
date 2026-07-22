import { describe, it, expect } from 'vitest';
import { detectFormat } from '../format';

describe('detectFormat', () => {
  it('detects JSON by a leading { or [ (after whitespace)', () => {
    expect(detectFormat('{ "a": 1 }')).toBe('json');
    expect(detectFormat('  [1, 2]')).toBe('json');
    expect(detectFormat('\n\t{"x":1}')).toBe('json');
  });

  it('treats everything else as YAML', () => {
    expect(detectFormat('rows:\n  - id: a')).toBe('yaml');
    expect(detectFormat('# comment\naccession: P05067')).toBe('yaml');
    expect(detectFormat('')).toBe('yaml');
  });
});
