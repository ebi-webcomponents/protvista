/**
 * Round-trip contract for shareable-link (de)serialisation.
 *
 * The guarantee the playground relies on: `decodeState(encodeState(s))`
 * reproduces `s` for every representable state — preset reference,
 * custom (edited) config with non-ASCII content, and accession-only.
 */
import { describe, it, expect } from 'vitest';
import {
  encodeState,
  decodeState,
  accessionFromSearch,
  DEFAULT_ACCESSION,
  type PlaygroundState,
} from '../url-state';

const roundTrip = (state: PlaygroundState) =>
  decodeState(`#${encodeState(state)}`);

describe('url-state round-trip', () => {
  it('preserves a preset reference', () => {
    const state: PlaygroundState = {
      preset: 'uniprot-default',
      accession: 'P05067',
    };
    expect(roundTrip(state)).toEqual(state);
  });

  it('preserves a custom config with unicode and special characters', () => {
    const state: PlaygroundState = {
      config: 'rows:\n  - id: Ω\n    label: "α/β hydrolase — 50%"\n',
      accession: 'Q9BXU3',
    };
    expect(roundTrip(state)).toEqual(state);
  });

  it('config supersedes preset when both are set', () => {
    const decoded = roundTrip({
      preset: 'byo-inline',
      config: 'accession: P05067\n',
      accession: 'P05067',
    });
    expect(decoded).toEqual({ config: 'accession: P05067\n', accession: 'P05067' });
  });

  it('preserves an accession-only state', () => {
    expect(roundTrip({ accession: 'P38398' })).toEqual({ accession: 'P38398' });
  });
});

describe('decodeState edge cases', () => {
  it('returns null for an empty or unrelated hash', () => {
    expect(decodeState('#')).toBeNull();
    expect(decodeState('')).toBeNull();
    expect(decodeState('#section-heading')).toBeNull();
  });

  it('defaults the accession when a link carries a config but no accession', () => {
    const encoded = new URLSearchParams({
      config: btoa('accession: P05067\n'),
    }).toString();
    expect(decodeState(`#${encoded}`)).toEqual({
      config: 'accession: P05067\n',
      accession: DEFAULT_ACCESSION,
    });
  });

  it('returns null for a malformed config payload', () => {
    expect(decodeState('#accession=P05067&config=@@not-base64@@')).toBeNull();
  });
});

describe('accessionFromSearch', () => {
  it('reads an accession from a query string', () => {
    expect(accessionFromSearch('?accession=P12345')).toBe('P12345');
  });

  it('trims surrounding whitespace', () => {
    expect(accessionFromSearch('?accession=%20P1%20')).toBe('P1');
  });

  it('returns null when absent, empty, or unrelated', () => {
    expect(accessionFromSearch('')).toBeNull();
    expect(accessionFromSearch('?accession=')).toBeNull();
    expect(accessionFromSearch('?foo=bar')).toBeNull();
  });
});
