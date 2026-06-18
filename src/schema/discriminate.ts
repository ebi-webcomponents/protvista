/**
 * Top-level-entry discriminator.
 *
 * Each entry under the config's `groups:` array is a discriminated
 * union of `GroupConfig` and `TrackConfig` (a "standalone track"):
 *
 *   - presence of `tracks:` → group
 *   - absence of `tracks:`  → standalone track
 *
 * This single predicate is the source of truth for the discrimination.
 * The JSON Schema (`schema.json`) expresses the same rule via a
 * `oneOf` whose two branches have disjoint `required` sets
 * (`GroupConfig` requires `tracks`; `TrackConfig` requires `data` and,
 * via `additionalProperties: false`, forbids `tracks`) — so a structurally
 * valid entry matches exactly one branch. validate / normalize / extends
 * all funnel their shape check through here so the discrimination can
 * never drift between the three stages.
 */

import type { GroupConfig, TopLevelEntry } from './types';

/**
 * True iff `entry` is a `GroupConfig` (has a `tracks` array) rather than
 * a standalone `TrackConfig`. Narrows the union for callers.
 */
export function isGroupConfig(entry: TopLevelEntry): entry is GroupConfig {
  return Array.isArray((entry as GroupConfig).tracks);
}
