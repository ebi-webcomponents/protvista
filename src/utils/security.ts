/**
 * HTML escaping utilities to prevent XSS in tooltip HTML generation.
 *
 * All data from external API responses must be escaped before interpolation
 * into HTML template strings.
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const ESCAPE_RE = /[&<>"']/g;

/**
 * Escape a string for safe insertion into HTML content or attribute values.
 * Returns an empty string if the input is nullish.
 */
export const escapeHtml = (str: unknown): string => {
  if (str == null) return '';
  return String(str).replace(ESCAPE_RE, (ch) => ESCAPE_MAP[ch]);
};

/**
 * Sanitize a URL for safe use in href attributes.
 * Only allows http:, https:, and mailto: protocols.
 * Returns an empty string for dangerous protocols (javascript:, data:, etc).
 */
export const sanitizeUrl = (url: unknown): string => {
  if (url == null) return '';
  const str = String(url).trim();
  const lower = str.toLowerCase();
  // Allow only safe protocols
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('mailto:')
  ) {
    return escapeHtml(str);
  }
  // Relative URLs are allowed
  if (str.startsWith('/') || str.startsWith('#') || str.startsWith('?')) {
    return escapeHtml(str);
  }
  // Block everything else (javascript:, data:, vbscript:, etc.)
  return '';
};
