/**
 * Every string the viewer shows about a warning: the visitor notice, and the
 * controls and headings around it and around author mode.
 *
 * A visitor notice is plain language for someone looking at an embedded
 * viewer: what is missing or misleading, never a file, a URL, a field, a code
 * or a variable. Its facts (how many features, which tracks) come from the
 * report; the sentence is built here. Author mode shows the author-facing
 * text instead, which is the event's and the console's.
 *
 * Kept in one pure module (no lit, no DOM) so the strings can be localised
 * later without hunting through the element.
 */

import type { ValidationIssue } from '../schema/errors.js';
import type { ErrorContext, ErrorPhase } from './report.js';
import type { FailureChannels, FailureCode, FailureReport } from './router.js';

/** The codes whose routing row raises a visitor notice. */
export type NoticeCode = Extract<
  FailureCode,
  | 'coordinate-out-of-range'
  | 'unpaintable-color'
  | 'url-variable-unresolved'
  | 'unrendered-component'
>;

/**
 * What a notice needs to be specific. `partial` is only for skipped sources:
 * tracks that lost some of their URLs but still draw something.
 */
export interface NoticeFacts {
  count?: number;
  names?: string[];
  partial?: string[];
}

/** `1 track`, `2 tracks`. No rendered string contains `(s)`. */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/** A name the visitor will recognise, quoted. */
const quote = (name: string) => `“${name}”`;
const quoteAll = (names: string[]) => names.map(quote).join(', ');

/**
 * Two reports' facts as one: counts add up, and names are a union in
 * first-seen order. A track that is both not shown and incomplete is listed
 * as not shown, which is the stronger statement.
 */
export function mergeFacts(a: NoticeFacts, b: NoticeFacts): NoticeFacts {
  const union = (x: string[] = [], y: string[] = []) => [
    ...new Set([...x, ...y]),
  ];
  const names = union(a.names, b.names);
  const partial = union(a.partial, b.partial).filter((n) => !names.includes(n));
  const count =
    a.count === undefined && b.count === undefined
      ? undefined
      : (a.count ?? 0) + (b.count ?? 0);
  return {
    ...(count !== undefined ? { count } : {}),
    ...(names.length ? { names } : {}),
    ...(partial.length ? { partial } : {}),
  };
}

/** The visitor's sentence for each notice code, from its merged facts. */
export const NOTICE_TEXT: Record<NoticeCode, (facts: NoticeFacts) => string> = {
  // "Features", not "rows": to a visitor the rows are the tracks. "This
  // sequence", not "this protein": it reads right in sequence mode too. "In
  // full", because one partly outside is drawn clipped.
  'coordinate-out-of-range': ({ count = 1 }) =>
    count === 1
      ? "1 feature extends beyond this sequence, so it isn't shown in full."
      : `${count} features extend beyond this sequence, so they aren't shown in full.`,
  'unpaintable-color': () =>
    "Some colours in the data couldn't be shown, so some features may be in the wrong colour.",
  'url-variable-unresolved': ({ names = [], partial = [] }) => {
    const out: string[] = [];
    if (names.length === 1) {
      out.push(`${quote(names[0])} isn't shown: its data couldn't be loaded.`);
    } else if (names.length > 1) {
      out.push(
        `${names.length} tracks aren't shown: their data couldn't be loaded (${quoteAll(names)}).`
      );
    }
    if (partial.length === 1) {
      out.push(
        `${quote(partial[0])} is incomplete: some of its data couldn't be loaded.`
      );
    } else if (partial.length > 1) {
      out.push(
        `${partial.length} tracks are incomplete: some of their data couldn't be loaded (${quoteAll(partial)}).`
      );
    }
    return out.length ? out.join(' ') : "Some data couldn't be loaded.";
  },
  // "Can't be displayed": the cause is permanent, not a failed attempt.
  'unrendered-component': ({ names = [] }) =>
    names.length === 1
      ? `${quote(names[0])} can't be displayed in this viewer.`
      : names.length > 1
        ? `${names.length} tracks can't be displayed in this viewer: ${quoteAll(names)}.`
        : "A track can't be displayed in this viewer.",
};

/** Buttons, headings and announcements. */
export const NOTE_UI = {
  /** The track ⓘ's accessible name. */
  trackLabel: (n: number, label: string) =>
    n === 1 ? `Note about ${label}` : `${n} notes about ${label}`,
  /** The top-bar ⓘ's accessible name. */
  viewerLabel: (n: number) => `Notes about this view (${n})`,
  viewerHeading: 'About this view',
  /** A note about a track that is not on screen, in the top-bar list. */
  offscreen: (label: string, text: string) => `${label}: ${text}`,
  /** The author ⚠'s visible text and accessible name. */
  authorText: (n: number) => `⚠ ${n}`,
  authorLabel: (n: number, label?: string) =>
    `${plural(n, 'authoring note')} for ${label ?? 'this view'}`,
  /** The author-mode error badge's accessible name. */
  errorLabel: (n: number) =>
    `Track failed to load — ${plural(n, 'authoring note')}`,
  authorFooter:
    "Shown because author mode (show-warnings) is on. Visitors don't see this list.",
  source: (url: string) => `Source: ${url}`,
  repeat: (n: number) => `×${n}`,
  /**
   * The visitor's sentence, quoted. A track name quoted inside it becomes
   * single-quoted, so the two never run together as `““`.
   */
  visitorsSee: (text: string) =>
    `Visitors see: “${text.replace(/“/g, '‘').replace(/”/g, '’')}”`,
  /** Sent once to the polite live region. */
  announceOne: (where: string | undefined, text: string) =>
    `Note about ${where ?? 'this view'}: ${text}`,
  announceMany: (n: number) =>
    `${n} notes about what's shown. Use the information buttons beside the track names and the Customize button to read them.`,
  /** The no-results view: one control, in its message, and nothing else. */
  announceManyHere: (n: number) =>
    `${n} notes about what's shown. Use the information button after this message to read them.`,
  announceAuthor: (n: number) =>
    `${plural(n, 'authoring note')}. Use the warning buttons to read ${n === 1 ? 'it' : 'them'}.`,
} as const;

/** The console's `[protvista…]` tag, which no person-facing surface shows. */
export const stripTag = (message: string): string =>
  message.replace(/^\[protvista(?:-uniprot)?\] /, '');

/** At most this many notes per anchor; a runaway caller can't grow it. */
export const MAX_NOTES_PER_ANCHOR = 200;

/**
 * One warning, kept for the visitor notice and author mode. Every routed
 * warning is recorded, whatever the display switches say, so turning either
 * on at runtime shows what already happened.
 *
 * `lifecycle` says what clears it: a new config (`config`), a new load of its
 * track (`load`), or a new config as well (`api` — `setTrackData()` misuse,
 * which no load repeats).
 */
export interface Note {
  /** `'viewer'`, or the `${rowId}-${trackId}` key of the track it is about. */
  anchor: string;
  phase: ErrorPhase;
  code?: FailureCode;
  /** The routed visitor notice, if any. */
  notice: 'track' | 'viewer' | null;
  /** The author text: each issue's message, or the event's message. */
  texts: string[];
  /** Each issue's config path, where it has one. */
  paths?: string[];
  source?: string;
  facts?: NoticeFacts;
  /**
   * The track (or row) key behind each name in `facts`, in the same order,
   * so a name can be left out while the layout hides its track.
   */
  factKeys?: { names?: string[]; partial?: string[] };
  /** What identifies it when its text does not (see `NoteOptions.noteKey`). */
  key?: string;
  lifecycle: 'config' | 'load' | 'api';
  /** How many identical `api` notes this one stands for. */
  repeat: number;
}

/** The parts of a `_report` call's options a note is built from. */
export interface NoteOptions {
  /** Each issue's message becomes one of the note's texts. */
  issues?: ValidationIssue[];
  /** What a person reads, when it should differ from the report's message. */
  panelSummary?: string;
  /** What the visitor notice counts or names, for a warning that has one. */
  noticeFacts?: NoticeFacts;
  /** The track or row key behind each of `noticeFacts`' names. */
  noticeKeys?: { names?: string[]; partial?: string[] };
  /**
   * What makes two reports the same note, when their text can differ: a
   * skipped template's message names whichever track met it first.
   */
  noteKey?: string;
}

/** A warning's first note, before any repeat. */
function newNote(
  anchor: string,
  report: FailureReport,
  texts: string[],
  issues: ValidationIssue[],
  opts: NoteOptions,
  channel: FailureChannels['notice']
): Note {
  return {
    anchor,
    phase: report.phase,
    ...(report.code !== undefined ? { code: report.code } : {}),
    notice: channel,
    texts,
    ...(issues.some((i) => i.path) ? { paths: issues.map((i) => i.path) } : {}),
    ...(report.source !== undefined ? { source: report.source } : {}),
    ...(opts.noticeFacts ? { facts: opts.noticeFacts } : {}),
    ...(opts.noticeKeys ? { factKeys: opts.noticeKeys } : {}),
    ...(opts.noteKey !== undefined ? { key: opts.noteKey } : {}),
    // What clears it (see {@link Note}'s `lifecycle`).
    lifecycle:
      report.phase === 'config'
        ? 'config'
        : report.phase === 'set-track-data'
          ? 'api'
          : 'load',
    repeat: 1,
  };
}

/**
 * The notes once a warning is recorded: one more note, the same note counted
 * again, or — at {@link MAX_NOTES_PER_ANCHOR} for its anchor — no change.
 *
 * Two reports are the same note when they share anchor, phase and code, and
 * either their `noteKey` or, without one, their texts. Never mutates `notes`;
 * returns it as is when nothing changes.
 */
export function upsertNote(
  notes: Note[],
  report: FailureReport,
  opts: NoteOptions,
  channel: FailureChannels['notice']
): Note[] {
  const anchor = report.scope === 'viewer' ? 'viewer' : report.scope.trackKey;
  const issues = opts.issues ?? [];
  const texts = issues.length
    ? issues.map((i) => i.message)
    : [stripTag(opts.panelSummary ?? report.message)];
  const at = notes.findIndex(
    (n) =>
      n.anchor === anchor &&
      n.phase === report.phase &&
      n.code === report.code &&
      (opts.noteKey !== undefined
        ? n.key === opts.noteKey
        : n.texts.join('\n') === texts.join('\n'))
  );
  if (at !== -1) {
    // Three identical `setTrackData()` misuses are three calls. A load or
    // config warning reported again — a targeted Retry re-reporting a
    // skipped template it shares — is the same fact, not a second one.
    const same = notes[at];
    return same.lifecycle === 'api'
      ? [
          ...notes.slice(0, at),
          { ...same, repeat: same.repeat + 1 },
          ...notes.slice(at + 1),
        ]
      : notes;
  }
  if (notes.filter((n) => n.anchor === anchor).length >= MAX_NOTES_PER_ANCHOR) {
    return notes;
  }
  return [...notes, newNote(anchor, report, texts, issues, opts, channel)];
}

/** The `detail` of a `protvista-error` event. */
export interface ErrorDetail {
  phase: ErrorPhase;
  severity: FailureReport['severity'];
  message: string;
  source?: string;
  issues: ValidationIssue[];
  context: ErrorContext;
}

/**
 * A `protvista-error` event's `detail`: `message` is what a person reads —
 * the panel's summary when there is one, and never the console's
 * `[protvista…]` tag — and `context` is the caller's merged over
 * `{ accession }`.
 */
export function buildErrorDetail(
  report: FailureReport,
  opts: {
    issues?: ValidationIssue[];
    context?: ErrorContext;
    panelSummary?: string;
  },
  accession: string | undefined
): ErrorDetail {
  return {
    phase: report.phase,
    // How bad it is, so a listener can tell a warning from a failure
    // without inferring it. A viewer-scoped warning (a theme colour
    // that did not resolve, a component with no renderer) carries no
    // `issues`, so the `issue.severity` check that works for config
    // warnings has nothing to read.
    severity: report.severity,
    // What the visible surface says. Without it the event was the one
    // channel that could not say *what* went wrong: a malformed file
    // reported `errorKind: 'adapter'` and a URL, while the text naming
    // the file and the offending row — the whole reason the failure is
    // worth surfacing — reached only the badge. A failure that raises
    // the panel carries the panel's own summary rather than the
    // developer line, and the console's `[protvista…]` tag is dropped:
    // the documented use is putting this text in front of a user.
    message: stripTag(opts.panelSummary ?? report.message),
    ...(report.source !== undefined ? { source: report.source } : {}),
    issues: opts.issues ?? [],
    context: { accession, ...opts.context },
  };
}
