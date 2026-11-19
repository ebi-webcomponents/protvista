/**
 * The visitor's sentences and the strings around them. Visitor text is plain
 * language: it says what is missing, counts it, and names tracks by the label
 * the visitor can see — never a file, a URL, a field or a variable.
 */

import { describe, it, expect } from 'vitest';

import type { ValidationIssue } from '../../schema/errors.js';
import type { FailureReport } from '../router.js';
import {
  MAX_NOTES_PER_ANCHOR,
  NOTICE_TEXT,
  NOTE_UI,
  buildErrorDetail,
  mergeFacts,
  plural,
  stripTag,
  upsertNote,
  type Note,
  type NoticeCode,
} from '../notices.js';

describe('visitor sentences', () => {
  it('counts features outside the sequence, singular and plural', () => {
    const text = NOTICE_TEXT['coordinate-out-of-range'];
    expect(text({ count: 1 })).toBe(
      "1 feature extends beyond this sequence, so it isn't shown in full."
    );
    expect(text({ count: 2 })).toBe(
      "2 features extend beyond this sequence, so they aren't shown in full."
    );
  });

  it('says colours may be wrong without naming them', () => {
    expect(NOTICE_TEXT['unpaintable-color']({})).toBe(
      "Some colours in the data couldn't be shown, so some features may be in the wrong colour."
    );
  });

  it('names skipped tracks that show nothing', () => {
    const text = NOTICE_TEXT['url-variable-unresolved'];
    expect(text({ names: ['Partner data'] })).toBe(
      "“Partner data” isn't shown: its data couldn't be loaded."
    );
    expect(text({ names: ['A', 'B'] })).toBe(
      "2 tracks aren't shown: their data couldn't be loaded (“A”, “B”)."
    );
  });

  it('names skipped tracks that show only part of their data', () => {
    const text = NOTICE_TEXT['url-variable-unresolved'];
    expect(text({ partial: ['A'] })).toBe(
      "“A” is incomplete: some of its data couldn't be loaded."
    );
    expect(text({ partial: ['A', 'B'] })).toBe(
      "2 tracks are incomplete: some of their data couldn't be loaded (“A”, “B”)."
    );
  });

  it('puts the tracks not shown first, then the incomplete ones', () => {
    expect(
      NOTICE_TEXT['url-variable-unresolved']({ names: ['A'], partial: ['B'] })
    ).toBe(
      "“A” isn't shown: its data couldn't be loaded. “B” is incomplete: some of its data couldn't be loaded."
    );
  });

  it('names components that cannot be drawn, singular and plural', () => {
    const text = NOTICE_TEXT['unrendered-component'];
    expect(text({ names: ['Mine'] })).toBe(
      "“Mine” can't be displayed in this viewer."
    );
    expect(text({ names: ['A', 'B'] })).toBe(
      "2 tracks can't be displayed in this viewer: “A”, “B”."
    );
  });

  it('never names a URL, a file, a variable, or hedges a plural', () => {
    const facts = [
      {},
      { count: 1 },
      { count: 3 },
      { names: ['A'] },
      { names: ['A', 'B'] },
      { partial: ['A'] },
      { names: ['A'], partial: ['B', 'C'] },
    ];
    for (const code of Object.keys(NOTICE_TEXT) as NoticeCode[]) {
      for (const f of facts) {
        expect(NOTICE_TEXT[code](f)).not.toMatch(/https?:|\{|\.csv|\(s\)/);
      }
    }
  });
});

describe('mergeFacts', () => {
  it('sums counts', () => {
    expect(mergeFacts({ count: 2 }, { count: 3 })).toEqual({ count: 5 });
  });

  it('takes the union of names in first-seen order, without duplicates', () => {
    expect(mergeFacts({ names: ['A', 'B'] }, { names: ['B', 'C'] })).toEqual({
      names: ['A', 'B', 'C'],
    });
    expect(mergeFacts({ partial: ['A'] }, { partial: ['A', 'B'] })).toEqual({
      partial: ['A', 'B'],
    });
  });

  it('keeps a track in names when it is also partial — not shown beats incomplete', () => {
    expect(mergeFacts({ partial: ['A', 'B'] }, { names: ['A'] })).toEqual({
      names: ['A'],
      partial: ['B'],
    });
  });

  it('adds no fields the facts did not have', () => {
    expect(mergeFacts({}, {})).toEqual({});
  });
});

describe('controls and announcements', () => {
  it('pluralises every count in words', () => {
    expect(plural(1, 'authoring note')).toBe('1 authoring note');
    expect(plural(2, 'authoring note')).toBe('2 authoring notes');
    expect(NOTE_UI.trackLabel(1, 'Lab hits')).toBe('Note about Lab hits');
    expect(NOTE_UI.trackLabel(2, 'Lab hits')).toBe('2 notes about Lab hits');
    expect(NOTE_UI.authorLabel(1)).toBe('1 authoring note for this view');
    expect(NOTE_UI.authorLabel(3, 'Lab hits')).toBe(
      '3 authoring notes for Lab hits'
    );
    expect(NOTE_UI.errorLabel(2)).toBe(
      'Track failed to load — 2 authoring notes'
    );
    expect(NOTE_UI.announceAuthor(1)).toBe(
      '1 authoring note. Use the warning buttons to read it.'
    );
  });

  it('quotes the visitor sentence, single-quoting a track name inside it', () => {
    expect(NOTE_UI.visitorsSee('Some colours were not shown.')).toBe(
      'Visitors see: “Some colours were not shown.”'
    );
    const skipped = NOTICE_TEXT['url-variable-unresolved']({
      names: ['Partner data'],
    });
    expect(skipped).toBe(
      "“Partner data” isn't shown: its data couldn't be loaded."
    );
    expect(NOTE_UI.visitorsSee(skipped)).toBe(
      "Visitors see: “‘Partner data’ isn't shown: its data couldn't be loaded.”"
    );
  });

  it('drops the console tag, and nothing else', () => {
    expect(stripTag('[protvista] a')).toBe('a');
    expect(stripTag('[protvista-uniprot] b')).toBe('b');
    expect(stripTag('c [protvista] d')).toBe('c [protvista] d');
  });
});

describe('recording a warning as a note', () => {
  const warning = (over: Partial<FailureReport> = {}): FailureReport => ({
    severity: 'warning',
    phase: 'track-data',
    scope: { trackKey: 'row-track' },
    consoleLevel: 'warn',
    message: '[protvista-uniprot] 2 features out of range.',
    ...over,
  });

  it('adds a note anchored on the track, its text untagged', () => {
    const notes = upsertNote(
      [],
      warning({ code: 'coordinate-out-of-range', source: 'a.json' }),
      { noticeFacts: { count: 2 } },
      'track'
    );
    expect(notes).toEqual([
      {
        anchor: 'row-track',
        phase: 'track-data',
        code: 'coordinate-out-of-range',
        notice: 'track',
        texts: ['2 features out of range.'],
        source: 'a.json',
        facts: { count: 2 },
        lifecycle: 'load',
        repeat: 1,
      },
    ]);
  });

  it("anchors a viewer warning on the viewer, with each issue's text and path", () => {
    const issues: ValidationIssue[] = [
      { path: '/rows/0', message: 'one', code: 'schema' },
      { path: '', message: 'two', code: 'schema' },
    ];
    const [note] = upsertNote(
      [],
      warning({ phase: 'config', scope: 'viewer' }),
      { issues, noteKey: 'k', noticeKeys: { names: ['row-track'] } },
      null
    );
    expect(note).toEqual({
      anchor: 'viewer',
      phase: 'config',
      notice: null,
      texts: ['one', 'two'],
      paths: ['/rows/0', ''],
      factKeys: { names: ['row-track'] },
      key: 'k',
      lifecycle: 'config',
      repeat: 1,
    });
  });

  it('prefers the panel summary to the message as the text', () => {
    const [note] = upsertNote(
      [],
      warning(),
      { panelSummary: 'Shown to people' },
      null
    );
    expect(note.texts).toEqual(['Shown to people']);
    expect(note).not.toHaveProperty('paths');
  });

  it('counts a repeated setTrackData() misuse, without mutating', () => {
    const report = warning({ phase: 'set-track-data', scope: 'viewer' });
    const once = upsertNote([], report, {}, null);
    const twice = upsertNote(once, report, {}, null);
    expect(once[0].lifecycle).toBe('api');
    expect(once[0].repeat).toBe(1);
    expect(twice).toHaveLength(1);
    expect(twice[0].repeat).toBe(2);
  });

  it('counts a repeat in place, leaving the notes around it as they were', () => {
    const misuse = warning({ phase: 'set-track-data', scope: 'viewer' });
    let notes = upsertNote([], warning({ message: 'before' }), {}, null);
    notes = upsertNote(notes, misuse, {}, null);
    notes = upsertNote(notes, warning({ message: 'after' }), {}, null);
    const counted = upsertNote(notes, misuse, {}, null);
    expect(counted.map((n) => n.texts[0])).toEqual([
      'before',
      '2 features out of range.',
      'after',
    ]);
    expect(counted.map((n) => n.repeat)).toEqual([1, 2, 1]);
    expect(counted[0]).toBe(notes[0]);
    expect(counted[2]).toBe(notes[2]);
    expect(notes[1].repeat).toBe(1);
  });

  it('keeps a repeated load or config warning as one note', () => {
    const report = warning();
    const once = upsertNote([], report, {}, null);
    expect(upsertNote(once, report, {}, null)).toBe(once);
  });

  it('tells notes apart by text, or by noteKey when there is one', () => {
    const a = upsertNote([], warning({ message: 'a' }), {}, null);
    expect(upsertNote(a, warning({ message: 'b' }), {}, null)).toHaveLength(2);
    const keyed = upsertNote(
      [],
      warning({ message: 'a' }),
      { noteKey: 'k' },
      null
    );
    expect(
      upsertNote(keyed, warning({ message: 'b' }), { noteKey: 'k' }, null)
    ).toBe(keyed);
    expect(
      upsertNote(
        keyed,
        warning({ code: 'unpaintable-color' }),
        { noteKey: 'k' },
        null
      )
    ).toHaveLength(2);
  });

  it('stops adding notes to an anchor at the cap, but not to another', () => {
    let notes: Note[] = [];
    for (let i = 0; i < MAX_NOTES_PER_ANCHOR; i++) {
      notes = upsertNote(notes, warning({ message: `m${i}` }), {}, null);
    }
    expect(upsertNote(notes, warning({ message: 'over' }), {}, null)).toBe(
      notes
    );
    expect(
      upsertNote(notes, warning({ message: 'over', scope: 'viewer' }), {}, null)
    ).toHaveLength(MAX_NOTES_PER_ANCHOR + 1);
  });
});

describe('the protvista-error event detail', () => {
  const report: FailureReport = {
    severity: 'error',
    phase: 'track-fetch',
    scope: { trackKey: 'row-track' },
    consoleLevel: 'warn',
    message: '[protvista-uniprot] failed',
  };

  it('carries the untagged message, empty issues, and the accession', () => {
    expect(buildErrorDetail(report, {}, 'P05067')).toEqual({
      phase: 'track-fetch',
      severity: 'error',
      message: 'failed',
      issues: [],
      context: { accession: 'P05067' },
    });
  });

  it('adds the source, and merges the context over the accession', () => {
    const issues: ValidationIssue[] = [
      { path: 'p', message: 'm', code: 'schema' },
    ];
    expect(
      buildErrorDetail(
        { ...report, source: 'https://x/y' },
        { issues, context: { accession: 'Q1', url: 'https://x/y' } },
        'P05067'
      )
    ).toEqual({
      phase: 'track-fetch',
      severity: 'error',
      message: 'failed',
      source: 'https://x/y',
      issues,
      context: { accession: 'Q1', url: 'https://x/y' },
    });
  });

  it('says what the panel says, when it has its own summary', () => {
    expect(
      buildErrorDetail(report, { panelSummary: 'Could not load' }, 'P05067')
        .message
    ).toBe('Could not load');
  });
});
