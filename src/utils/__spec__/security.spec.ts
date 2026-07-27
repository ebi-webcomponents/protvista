import { describe, it, expect } from 'vitest';

import { escapeHtml, sanitizeUrl } from '../security.js';

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('escapes all special characters together', () => {
    expect(escapeHtml('<a href="x&y">it\'s</a>')).toBe(
      '&lt;a href=&quot;x&amp;y&quot;&gt;it&#39;s&lt;/a&gt;'
    );
  });

  it('returns empty string for null', () => {
    expect(escapeHtml(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(escapeHtml(undefined)).toBe('');
  });

  it('coerces numbers to string', () => {
    expect(escapeHtml(42)).toBe('42');
  });

  it('coerces zero to string', () => {
    expect(escapeHtml(0)).toBe('0');
  });

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('leaves safe strings unchanged', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });
});

describe('sanitizeUrl', () => {
  it('allows http URLs', () => {
    expect(sanitizeUrl('http://example.com')).toBe('http://example.com');
  });

  it('allows https URLs', () => {
    expect(sanitizeUrl('https://example.com/path?q=1')).toBe(
      'https://example.com/path?q=1'
    );
  });

  it('allows mailto URLs', () => {
    expect(sanitizeUrl('mailto:user@example.com')).toBe(
      'mailto:user@example.com'
    );
  });

  it('allows relative URLs starting with /', () => {
    expect(sanitizeUrl('/path/to/page')).toBe('/path/to/page');
  });

  it('allows fragment URLs starting with #', () => {
    expect(sanitizeUrl('#section')).toBe('#section');
  });

  it('allows query URLs starting with ?', () => {
    expect(sanitizeUrl('?foo=bar')).toBe('?foo=bar');
  });

  it('blocks javascript: protocol', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('');
  });

  it('blocks javascript: protocol with mixed case', () => {
    expect(sanitizeUrl('JavaScript:alert(1)')).toBe('');
    expect(sanitizeUrl('JAVASCRIPT:alert(1)')).toBe('');
  });

  it('blocks data: protocol', () => {
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
  });

  it('blocks vbscript: protocol', () => {
    expect(sanitizeUrl('vbscript:msgbox')).toBe('');
  });

  it('handles uppercase HTTP/HTTPS protocols', () => {
    expect(sanitizeUrl('HTTP://EXAMPLE.COM')).toBe('HTTP://EXAMPLE.COM');
    expect(sanitizeUrl('HTTPS://EXAMPLE.COM')).toBe('HTTPS://EXAMPLE.COM');
  });

  it('handles mixed case protocols', () => {
    expect(sanitizeUrl('Https://Example.com')).toBe('Https://Example.com');
  });

  it('returns empty string for null', () => {
    expect(sanitizeUrl(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(sanitizeUrl(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(sanitizeUrl('')).toBe('');
  });

  it('trims whitespace', () => {
    expect(sanitizeUrl('  https://example.com  ')).toBe('https://example.com');
  });

  it('escapes HTML entities in URLs', () => {
    expect(sanitizeUrl('https://example.com/a&b')).toBe(
      'https://example.com/a&amp;b'
    );
  });

  it('blocks unknown protocols', () => {
    expect(sanitizeUrl('ftp://example.com')).toBe('');
    expect(sanitizeUrl('file:///etc/passwd')).toBe('');
  });

  it('blocks javascript: disguised with tab/newline characters', () => {
    expect(sanitizeUrl('java\tscript:alert(1)')).toBe('');
    expect(sanitizeUrl('java\nscript:alert(1)')).toBe('');
  });

  it('blocks bare strings that are not valid URLs', () => {
    expect(sanitizeUrl('not-a-url')).toBe('');
  });
});
