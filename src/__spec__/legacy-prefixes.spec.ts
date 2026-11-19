// @vitest-environment node

/**
 * Keeps out the obsolete vendor prefixes that the architecture audit's
 * "Legacy browser workarounds" section (#380) records as removed.
 *
 * Every browser target in `browserslist` (Chrome/Edge 92+, Firefox 90+,
 * Safari 15+) supports the unprefixed `transition`, and iOS has ignored
 * `-webkit-overflow-scrolling` since iOS 13. A copied stylesheet snippet can
 * bring any of them back without any visible effect, so this scans every
 * authored module under `src/` for them.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const OBSOLETE = [
  '-webkit-overflow-scrolling',
  '-webkit-transition',
  '-moz-transition',
  '-o-transition',
];

/** Every authored module under `src/`, excluding test-only trees. */
const sourceModules = () => {
  const skip = /(^|\/)(__spec__|__tests__|__mocks__|__browser__)(\/|$)/;
  return readdirSync(resolve(root, 'src'), {
    recursive: true,
    encoding: 'utf8',
  })
    .map((entry) => `src/${entry.split('\\').join('/')}`)
    .filter((rel) => /\.(ts|css)$/.test(rel) && !skip.test(rel));
};

describe('obsolete vendor prefixes (#380)', () => {
  it.each(OBSOLETE)('no source module uses %s', (prefix) => {
    const hits = sourceModules().filter((rel) =>
      readFileSync(resolve(root, rel), 'utf8').includes(prefix)
    );
    expect(hits).toEqual([]);
  });
});
