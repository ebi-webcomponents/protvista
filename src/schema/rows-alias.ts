/**
 * `groups:` → `rows:` alias resolution.
 *
 * The top-level entry list was originally called `groups:`. Since
 * standalone single-row tracks landed, that array holds two kinds of
 * entry — a `GroupConfig` (a collapsible cluster, has `tracks:`) and a
 * standalone `TrackConfig` (one row on its own, has `data:`) — so
 * `groups:` names it dishonestly. `rows:` is the canonical field:
 * every top-level entry is one vertical lane, and a group is simply an
 * expandable lane.
 *
 * `groups:` is kept as a deprecated alias for one cycle. This module is
 * the single place that knows about it, so the rest of the pipeline
 * (extends → validate → normalize → render) only ever sees `rows:`.
 *
 * Resolution runs once, early — immediately after parse in `load.ts` —
 * and defensively at every public entry point a config can reach
 * directly (`mergeExtends`, `validateConfig`, `normalizeConfig`), since
 * an embedder may call any of them without going through `loadConfig`.
 * Re-resolving an already-resolved config is a no-op, so the repeat
 * calls cost nothing and cannot double-fire the warning.
 */

import { ConfigValidationError, type ValidationIssue } from './errors';
import { isPlainObject, isSet } from './shape';

/**
 * Author-facing text for the both-fields-set case. Exported so the
 * throwing path (`resolveRowsAlias`) and the issue-collecting path
 * (`validateConfig`) cannot drift apart, and so tests assert against
 * one constant rather than a copied string literal.
 */
export const ROWS_ALIAS_CONFLICT_MESSAGE =
  "Use `rows:` — `groups:` is a deprecated alias; don't set both.";

const DEPRECATION_WARNING =
  "[protvista-uniprot] Config field 'groups:' is deprecated — rename it to 'rows:'. The 'groups:' alias will be removed before the v5 schema is published.";

/**
 * Fired at most once per process. A viewer that mounts twenty legacy
 * configs should nag the developer once, not twenty times — the
 * message is identical every time and the second copy carries no
 * information.
 */
let warned = false;

function warnOnce(): void {
  if (warned) return;
  warned = true;
  console.warn(DEPRECATION_WARNING);
}

/**
 * Non-throwing probe for the both-fields-set case, returning the issue
 * rather than raising it.
 *
 * `validateConfig` documents a no-throw contract — it always returns a
 * `ValidationResult` — so it cannot call `resolveRowsAlias` blind. It
 * probes with this first and pushes the issue onto its own list.
 */
export function rowsAliasConflict(config: unknown): ValidationIssue | undefined {
  if (!isPlainObject(config)) return undefined;
  if (!isSet(config.rows) || !isSet(config.groups)) return undefined;
  return {
    path: '/groups',
    message: ROWS_ALIAS_CONFLICT_MESSAGE,
    code: 'rows-alias-conflict',
  };
}

/**
 * Return `config` with a deprecated `groups:` folded into `rows:`.
 *
 * A config that already uses `rows:` (or carries no `groups:` key) is
 * returned as-is — same reference, no clone, no warning. Only a config
 * that actually carries `groups:` allocates.
 *
 * An empty `groups:` stub (`null`) carries nothing to fold: the key is
 * dropped so it can't trip the schema's one-of, and no warning fires —
 * there is no real alias use to migrate.
 *
 * @throws `ConfigValidationError` (`rows-alias-conflict`) when both
 *   fields are set. Silently preferring one would hide a real authoring
 *   mistake: the two lists would render very differently and the author
 *   has given no way to tell which they meant.
 */
export function resolveRowsAlias<T>(config: T): T {
  if (!isPlainObject(config)) return config;
  if (!('groups' in config)) return config;

  const conflict = rowsAliasConflict(config);
  if (conflict) throw new ConfigValidationError([conflict]);

  // `groups` is present but `rows` is not (the conflict above ruled out
  // both). The `as T` cast is sound for every real caller: they pass a
  // `ProtvistaViewerConfig`, where `rows` is the required field the
  // returned object now carries.
  const { groups, ...rest } = config;

  // Empty stub — drop the dangling key, don't warn, don't fold `null`
  // into `rows:` (which would later crash `rows.map(...)`).
  if (!isSet(groups)) return rest as T;

  warnOnce();
  return { ...rest, rows: groups } as T;
}
