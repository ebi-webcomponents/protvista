import { describe, it, expect } from 'vitest';
import { configFileName, detectFormat } from '../format.js';

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

describe('configFileName', () => {
  it('names JSON configs config.json', () => {
    expect(configFileName('{ "accession": "P05067" }')).toBe('config.json');
    expect(configFileName('  [1, 2]\n')).toBe('config.json');
  });

  it('names everything else config.yaml', () => {
    expect(configFileName('accession: P05067')).toBe('config.yaml');
    expect(configFileName('# comment')).toBe('config.yaml');
    expect(configFileName('')).toBe('config.yaml');
  });
});
