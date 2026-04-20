/**
 * Vitest setup: filter benign jsdom CSS-parse noise.
 *
 * jsdom's CSS parser (cssom) is CSS2-era and cannot parse modern syntax
 * such as native nesting, `:has()`, `@layer`, `@container`, etc. When
 * `<protvista-uniprot>` attaches its stylesheet (see src/protvista-styles.ts),
 * jsdom logs `Error: Could not parse CSS stylesheet` for every rule it
 * doesn't understand. The stylesheet still attaches and the tests still
 * pass — it's pure log noise that drowns out real errors.
 *
 * We filter ONLY that specific message. Every other console.error passes
 * through untouched, so genuine failures stay visible.
 *
 * If jsdom ever learns modern CSS (or we switch to happy-dom), this file
 * can be removed.
 */

const originalError = console.error;

// jsdom's VirtualConsole forwards `jsdomError` events by calling
// `console.error(error.stack, error.detail)` (see jsdom/lib/jsdom/virtual-console.js).
// For a CSS-parse failure, `error.stack` is the string
//   "Error: Could not parse CSS stylesheet\n    at ..."
// and `error.detail` is the raw stylesheet text. We match against the stack
// string. Error objects (directly constructed) are handled too for defence
// in depth.
const CSS_PARSE_SIGNATURE = 'Could not parse CSS stylesheet';

const matchesCssParseNoise = (arg: unknown): boolean => {
  if (typeof arg === 'string') return arg.includes(CSS_PARSE_SIGNATURE);
  if (arg instanceof Error) return arg.message.includes(CSS_PARSE_SIGNATURE);
  return false;
};

console.error = (...args: unknown[]) => {
  if (matchesCssParseNoise(args[0])) return;
  originalError(...args);
};
