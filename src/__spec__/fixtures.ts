/**
 * Shared test fixtures used by more than one spec file.
 *
 * Keep this module minimal and type-only-plus-pure-data where possible.
 * Spec-local fixtures (renderings keyed to a specific test's scenario,
 * hand-crafted `NormalizedConfig` slices with many groups) stay in the
 * spec file that owns them — extracting them here just splits the
 * mental model.
 */

import type { NormalizedConfig, NormalizedTrack } from '../schema/normalize.js';

/**
 * Canonical accession used across loader and setTrackData tests. Kept
 * here so a future test-wide change (say, switching to a different
 * reference protein) lands in one place.
 */
export const ACCESSION = 'P05067';

/**
 * Minimal single-group `NormalizedConfig` wrapping a single track.
 * Useful for any loader-level or data-plumbing test that doesn't need
 * the 15-group real-world config.
 *
 * Group id is the deliberately unremarkable `'GROUP'` — spec files
 * grep for this string to assert data-keying behaviour (e.g.
 * `data['GROUP-trackId']` after loader pipeline).
 */
export function makeConfig(track: NormalizedTrack): NormalizedConfig {
  return {
    version: '1.0',
    sources: {},
    defaults: { rendering: {} },
    rows: [
      {
        id: 'GROUP',
        label: 'group',
        component: track.component,
        rendering: {},
        tracks: [track],
      },
    ],
  };
}
