/**
 * The correlation of one load batch's outcomes back to the tracks that own
 * them: which are *broken* (a badge, an event, perhaps the panel) and which
 * are *expected absences* that only reach the console. Previously reachable
 * only through a mounted element, so each branch is pinned here directly.
 */

import { describe, it, expect } from 'vitest';

import type { TrackProcessingFailure } from '../../load-data.js';
import type {
  NormalizedDataSource,
  NormalizedRow,
  NormalizedTrack,
} from '../../schema/normalize.js';
import {
  classifyTrackOutcomes,
  ownsLocation,
  whollyFailedGroups,
  type UrlFetchError,
} from '../track-outcomes.js';

const track = (
  id: string,
  data: Partial<NormalizedDataSource> = { from: 'url' }
): NormalizedTrack => ({ id, data: [data] }) as unknown as NormalizedTrack;

const row = (id: string, tracks: NormalizedTrack[]): NormalizedRow =>
  ({ id, tracks }) as unknown as NormalizedRow;

const http = (url: string, status: number): UrlFetchError => ({
  url,
  kind: 'http',
  status,
});

const classify = ({
  rows,
  trackUrls = {},
  fetchErrors = [],
  trackFailures = {},
  only,
}: {
  rows: NormalizedRow[];
  trackUrls?: Record<string, string[]>;
  fetchErrors?: UrlFetchError[];
  trackFailures?: Record<string, TrackProcessingFailure>;
  only?: Set<string>;
}) =>
  classifyTrackOutcomes(
    { rows },
    trackUrls,
    new Map(fetchErrors.map((e) => [e.url, e])),
    trackFailures,
    only
  );

describe('ownsLocation', () => {
  it('is true for a source with a format, or written as from: file', () => {
    expect(ownsLocation(track('t', { from: 'url', format: 'csv' }))).toBe(true);
    expect(ownsLocation(track('t', { from: 'file', adapter: 'x' }))).toBe(true);
  });

  it('is false for a provider endpoint and for a track with no data', () => {
    expect(ownsLocation(track('t', { from: 'url' }))).toBe(false);
    expect(
      ownsLocation({ id: 't', data: [] } as unknown as NormalizedTrack)
    ).toBe(false);
  });
});

describe('classifyTrackOutcomes', () => {
  it('records a 5xx from a provider endpoint as broken', () => {
    const { errors, absences } = classify({
      rows: [row('g', [track('a')])],
      trackUrls: { 'g-a': ['u1'] },
      fetchErrors: [http('u1', 503)],
    });
    expect([...errors]).toEqual([
      [
        'g-a',
        { url: 'u1', kind: 'http', status: 503, groupId: 'g', trackId: 'a' },
      ],
    ]);
    expect(absences).toEqual([]);
  });

  it('treats a provider 4xx as an expected absence, one per URL', () => {
    const { errors, absences } = classify({
      rows: [row('g', [track('a')])],
      trackUrls: { 'g-a': ['u1', 'u2'] },
      fetchErrors: [http('u1', 404), http('u2', 400)],
    });
    expect(errors.size).toBe(0);
    expect(absences).toEqual([
      {
        key: 'g-a',
        groupId: 'g',
        trackId: 'a',
        source: 'u1',
        message: '[protvista-uniprot] track g/a: no data (HTTP 404) at u1.',
      },
      {
        key: 'g-a',
        groupId: 'g',
        trackId: 'a',
        source: 'u2',
        message: '[protvista-uniprot] track g/a: no data (HTTP 400) at u2.',
      },
    ]);
  });

  it('does not let a provider 4xx hide a 5xx on another of its URLs', () => {
    const { errors, absences } = classify({
      rows: [row('g', [track('a')])],
      trackUrls: { 'g-a': ['u1', 'u2'] },
      fetchErrors: [http('u1', 404), http('u2', 503)],
    });
    expect(errors.get('g-a')).toMatchObject({ url: 'u2', status: 503 });
    expect(absences).toEqual([]);
  });

  it('records a 4xx at an authored location as broken, tagged authored', () => {
    const { errors } = classify({
      rows: [row('g', [track('a', { from: 'url', format: 'csv' })])],
      trackUrls: { 'g-a': ['u1'] },
      fetchErrors: [http('u1', 404)],
    });
    expect(errors.get('g-a')).toEqual({
      url: 'u1',
      kind: 'http',
      status: 404,
      authored: true,
      groupId: 'g',
      trackId: 'a',
    });
  });

  it('tags a from: file failure with fromFile as well as authored', () => {
    const { errors } = classify({
      rows: [row('g', [track('a', { from: 'file' })])],
      trackUrls: { 'g-a': ['./hits.csv'] },
      fetchErrors: [http('./hits.csv', 404)],
    });
    expect(errors.get('g-a')).toMatchObject({ authored: true, fromFile: true });
  });

  it('records a processing error when no fetch failed', () => {
    const { errors } = classify({
      rows: [
        row('g', [
          track('a', { from: 'url', format: 'csv' }),
          track('b'),
          track('c', { from: 'inline' }),
        ]),
      ],
      trackUrls: { 'g-a': ['u1'], 'g-b': ['u2'] },
      trackFailures: {
        'g-a': { severity: 'error', message: 'bad row 3' },
        'g-b': { severity: 'error', message: 'threw', retryable: true },
        'g-c': { severity: 'error', message: 'bad inline' },
      },
    });
    expect([...errors.values()]).toEqual([
      {
        url: 'u1',
        kind: 'adapter',
        message: 'bad row 3',
        authored: true,
        groupId: 'g',
        trackId: 'a',
      },
      {
        url: 'u2',
        kind: 'adapter',
        message: 'threw',
        retryable: true,
        groupId: 'g',
        trackId: 'b',
      },
      {
        url: '',
        kind: 'adapter',
        message: 'bad inline',
        groupId: 'g',
        trackId: 'c',
      },
    ]);
  });

  it('does not mark a from:file adapter failure without a format as authored', () => {
    // Unlike a fetch failure, an adapter failure is authored only when the
    // source names a format, so the badge keeps the file it came from.
    const { errors } = classify({
      rows: [row('g', [track('a', { from: 'file', adapter: 'x' })])],
      trackUrls: { 'g-a': ['./hits.txt'] },
      trackFailures: { 'g-a': { severity: 'error', message: 'bad' } },
    });
    expect(errors.get('g-a')).toEqual({
      url: './hits.txt',
      kind: 'adapter',
      message: 'bad',
      groupId: 'g',
      trackId: 'a',
    });
  });
  it('does not let a processing error resurrect a silent provider 4xx', () => {
    const { errors, absences } = classify({
      rows: [row('g', [track('a')])],
      trackUrls: { 'g-a': ['u1'] },
      fetchErrors: [http('u1', 404)],
      trackFailures: { 'g-a': { severity: 'error', message: 'empty body' } },
    });
    expect(errors.size).toBe(0);
    expect(absences.map((a) => a.source)).toEqual(['u1']);
  });

  it('reports an info outcome as an absence with no source', () => {
    const { errors, absences } = classify({
      rows: [row('g', [track('a', { from: 'custom' })])],
      trackFailures: { 'g-a': { severity: 'info', message: 'no data set' } },
    });
    expect(errors.size).toBe(0);
    expect(absences).toEqual([
      { key: 'g-a', groupId: 'g', trackId: 'a', message: 'no data set' },
    ]);
  });

  it('reports nothing for a track with no failure at all', () => {
    const { errors, absences } = classify({
      rows: [row('g', [track('a')])],
      trackUrls: { 'g-a': ['u1'] },
    });
    expect(errors.size).toBe(0);
    expect(absences).toEqual([]);
  });

  it('limits absences, not errors, to the reloaded tracks', () => {
    const { errors, absences } = classify({
      rows: [row('g', [track('a'), track('b')])],
      trackUrls: { 'g-a': ['u1'], 'g-b': ['u2'] },
      fetchErrors: [http('u1', 404), http('u2', 503)],
      only: new Set(['g-x']),
    });
    expect([...errors.keys()]).toEqual(['g-b']);
    expect(absences).toEqual([]);
  });

  it('still reports absences for the reloaded tracks', () => {
    const { errors, absences } = classify({
      rows: [row('g', [track('a'), track('b')])],
      trackUrls: { 'g-a': ['u1'], 'g-b': ['u2'] },
      fetchErrors: [http('u1', 404), http('u2', 404)],
      only: new Set(['g-a']),
    });
    expect(errors.size).toBe(0);
    expect(absences.map((a) => a.key)).toEqual(['g-a']);
  });

  it('keeps config order across groups', () => {
    const { errors, absences } = classify({
      rows: [row('g1', [track('a'), track('b')]), row('g2', [track('c')])],
      trackUrls: { 'g1-a': ['u1'], 'g1-b': ['u2'], 'g2-c': ['u3'] },
      fetchErrors: [http('u3', 500), http('u2', 404), http('u1', 502)],
    });
    expect([...errors.keys()]).toEqual(['g1-a', 'g2-c']);
    expect(absences.map((a) => a.key)).toEqual(['g1-b']);
  });
});

describe('whollyFailedGroups', () => {
  it('names the groups every one of whose tracks has an error', () => {
    const rows = [
      row('all', [track('a'), track('b')]),
      row('some', [track('a'), track('b')]),
      row('empty', []),
    ];
    const errors = new Map([
      ['all-a', 1],
      ['all-b', 1],
      ['some-a', 1],
    ]);
    expect([...whollyFailedGroups(rows, errors)]).toEqual(['all']);
  });
});
