/**
 * The routing table every failure in the viewer passes through.
 *
 * Before this module, each failure site decided for itself where it should
 * show up, and the decision was made again from scratch every time a new
 * failure class was added. The results drifted, in the direction you would
 * expect from a decision made eight separate times: a config error raised a
 * panel, a sequence failure raised a panel, a track fetch raised a badge but
 * only on grouped rows, a 4xx raised nothing at all, and an adapter throw
 * reached nothing but `console.warn`. What a user saw depended on which code
 * path had failed rather than on how bad the failure was, and the best
 * diagnostics — the ones naming the file and the row — were the ones only a
 * developer with the console open could read.
 *
 * So the decision is made once, here, from facts the failure site already
 * knows: how severe it is, whether it is scoped to the whole viewer or to one
 * track, and whether `strict` is on. Sites report; they do not route, log, or
 * render. Adding a failure class means picking a severity and a scope, and the
 * surfaces follow.
 *
 * Pure module — no lit, no DOM, no `console`. The table is data, which is what
 * lets `src/errors/__spec__/router.spec.ts` drift-test it against the
 * published documentation and walk every row of it directly.
 */

import type { ErrorPhase } from './report.js';

/**
 * How bad a failure is — the primary routing axis.
 *
 *   - `error`   — something the author or user asked for cannot happen.
 *   - `warning` — it happened, but not as intended, or not completely.
 *   - `info`    — an expected absence worth a line in the console and nothing
 *                 more (a provider endpoint answering 404 for an entity that
 *                 simply has no data of this kind).
 */
export type FailureSeverity = 'error' | 'warning' | 'info';

/**
 * How much of the viewer a failure takes down. `viewer` means there is
 * nothing to render past it (no config, no sequence); a track scope names the
 * one row that failed, by its `${rowId}-${trackId}` key, and leaves the rest
 * of the viewer working.
 */
export type FailureScope = 'viewer' | { trackKey: string };

/** A failure, as the site that hit it describes itself. */
export interface FailureReport {
  severity: FailureSeverity;
  /** The stable event vocabulary — see `ErrorPhase`. */
  phase: ErrorPhase;
  scope: FailureScope;
  /** Where it came from, when that isn't implied by the phase (a URL, a path). */
  source?: string;
  /** One line, in the terms the person reading it thinks in. */
  message: string;
  /**
   * Whether retrying could plausibly change the outcome: connectivity may
   * return, a 5xx may be transient, and a `from: file` path the author can
   * correct is retryable in place once they have. A failure with no action
   * available in between (a malformed file, an adapter or component that threw)
   * is not, and offering a Retry for one is worse than offering none.
   */
  recoverable?: boolean;
  /**
   * The developer-channel level. Carried on the report rather than derived
   * from `severity` because the two answer different questions: a per-track
   * `error` is a `console.warn` for the page as a whole, which is still
   * working. The router makes the only `console` call either way.
   */
  consoleLevel: 'error' | 'warn' | 'info';
}

/** Which output channels a report reaches. */
export interface FailureChannels {
  /** The developer channel — the router's own `console[level]` call. */
  console: 'error' | 'warn' | 'info' | null;
  /** The bubbling `protvista-error` CustomEvent an embedder listens for. */
  event: boolean;
  /** The mount-level alert panel, which replaces the viewer. */
  panel: boolean;
  /** The in-row `⚠` badge. Only ever for a track-scoped report. */
  badge: boolean;
  /** A Retry affordance on whichever surface carries the failure. */
  retry: boolean;
}

/**
 * One row of the routing table: the surfaces a (severity, scope) pair reaches.
 *
 * `panel` is three-valued because `strict` is a *routing* input, not a
 * per-site conditional — which is the whole point of having it in one place.
 * `always` is a failure there is no viewer to return to from; `strict` is one
 * the author asked to be told about loudly; `never` is one that would hide a
 * working viewer behind a notice about something legal.
 */
export interface RoutingRule {
  severity: FailureSeverity;
  /** `'track'` matches any `{ trackKey }` scope. */
  scope: 'viewer' | 'track';
  /**
   * When set, the rule governs only this phase and is matched ahead of the
   * unqualified row for the same (severity, scope).
   *
   * Two phases need this. Two viewer-scoped warnings disagree about `strict`
   * for a reason severity and scope cannot express: a config warning names
   * something legal that *loaded as written*, so promoting it would hide a
   * working viewer, while a rejected `setTrackData()` call names something the
   * caller asked for that *did not happen*, which is exactly what `strict` is
   * for. Qualifying the narrower case keeps that distinction in the table
   * instead of back in a conditional at the call site. A `track-data` warning
   * is the track-scoped counterpart of a config warning: the row's data loaded
   * and renders as written, so it takes neither the badge nor the panel.
   */
  phase?: ErrorPhase;
  event: boolean;
  panel: 'always' | 'strict' | 'never';
  badge: boolean;
  /** Prose for the published table. Kept beside the rule so the two can't drift. */
  rationale: string;
}

/**
 * The routing table, in the order the documentation publishes it.
 *
 * Every (severity, scope) combination has exactly one unqualified row, so
 * routing is total — there is no fallthrough, and no failure class can be
 * added without landing on a row. A row may additionally name a `phase`, in
 * which case it governs that phase ahead of the unqualified one. `retry` is not a column: it follows `report.recoverable`
 * on whichever surface the failure reached, so a transient failure is
 * retryable from the badge and the panel alike.
 *
 * Mirrored in `docs/src/content/docs/troubleshooting.md` under "Where a
 * failure shows up", and drift-tested against it.
 */
export const ROUTING_TABLE: readonly RoutingRule[] = [
  {
    severity: 'error',
    scope: 'viewer',
    event: true,
    panel: 'always',
    badge: false,
    rationale:
      'Nothing to render past it, so the panel replaces the viewer whether or not strict is on.',
  },
  {
    severity: 'error',
    scope: 'track',
    event: true,
    panel: 'strict',
    badge: true,
    rationale:
      'One row is broken and the rest of the viewer works, so the badge carries it; strict promotes it.',
  },
  {
    severity: 'warning',
    scope: 'viewer',
    phase: 'set-track-data',
    event: true,
    panel: 'strict',
    badge: false,
    rationale:
      'A rejected API call did not do what the caller asked, so strict promotes it.',
  },
  {
    severity: 'warning',
    scope: 'viewer',
    event: true,
    panel: 'never',
    badge: false,
    rationale:
      'Names something legal that loaded as written — a panel would hide a working viewer.',
  },
  {
    severity: 'warning',
    scope: 'track',
    phase: 'track-data',
    event: true,
    panel: 'never',
    badge: false,
    rationale:
      'Coordinates outside the sequence still render as authored — a badge or panel would mark a working row as broken.',
  },
  {
    severity: 'warning',
    scope: 'track',
    event: true,
    panel: 'strict',
    badge: true,
    rationale:
      'Same surface as a track error: the row says so, and strict promotes it.',
  },
  {
    severity: 'info',
    scope: 'viewer',
    event: false,
    panel: 'never',
    badge: false,
    rationale: 'An expected absence. The console records it; no user surface.',
  },
  {
    severity: 'info',
    scope: 'track',
    event: false,
    panel: 'never',
    badge: false,
    rationale:
      'An entity with no data of this kind is not a failure — the row is simply empty.',
  },
] as const;

/** Narrow a `FailureScope` to the routing table's two-valued axis. */
export function scopeAxis(scope: FailureScope): 'viewer' | 'track' {
  return scope === 'viewer' ? 'viewer' : 'track';
}

/**
 * The row governing a report: the phase-qualified one if there is one for this
 * (severity, scope), otherwise the unqualified one. Total over the table —
 * never `undefined`, because every (severity, scope) pair has an unqualified
 * row and a drift test pins that.
 */
export function ruleFor(report: FailureReport): RoutingRule {
  const axis = scopeAxis(report.scope);
  const matches = (r: RoutingRule) =>
    r.severity === report.severity && r.scope === axis;
  const rule =
    ROUTING_TABLE.find((r) => matches(r) && r.phase === report.phase) ??
    ROUTING_TABLE.find((r) => matches(r) && r.phase === undefined);
  // Unreachable: the table covers all six combinations, and a drift test
  // pins that. Throwing beats silently swallowing a failure if it ever is.
  if (!rule) {
    throw new Error(
      `No routing rule for severity '${report.severity}' scope '${axis}'.`
    );
  }
  return rule;
}

/**
 * Resolve a report to the channels it reaches. The single place `strict` is
 * read: every failure site hands its report here and honours the answer.
 */
export function routeFailure(
  report: FailureReport,
  opts: { strict: boolean }
): FailureChannels {
  const rule = ruleFor(report);
  const panel =
    rule.panel === 'always' || (rule.panel === 'strict' && opts.strict);
  return {
    console: report.consoleLevel,
    event: rule.event,
    panel,
    badge: rule.badge,
    // A Retry is offered only where the failure is actually surfaced, and
    // only when retrying could change the outcome.
    retry: !!report.recoverable && (panel || rule.badge),
  };
}
