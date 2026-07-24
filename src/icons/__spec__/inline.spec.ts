import { describe, it, expect } from 'vitest';
import { inlineSvg } from '../inline';

describe('inlineSvg', () => {
  it('passes a string icon through unchanged', () => {
    expect(inlineSvg('<svg><path/></svg>')).toBe('<svg><path/></svg>');
    expect(inlineSvg('')).toBe('');
  });

  it('coerces a non-string to "" so unsafeHTML never throws', () => {
    // What a non-inlining bundler (e.g. Astro) hands back for an .svg import.
    expect(inlineSvg({ src: '/spinner.svg', width: 16, height: 16 })).toBe('');
    expect(inlineSvg(undefined)).toBe('');
    expect(inlineSvg(null)).toBe('');
    expect(inlineSvg(42)).toBe('');
  });
});
