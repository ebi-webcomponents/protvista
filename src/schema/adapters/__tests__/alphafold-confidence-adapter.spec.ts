/**
 * Unit tests for `alphafold-prediction-json` (#383). The adapter picks the
 * AlphaFold prediction whose `sequence` is the protein's, fetches the
 * confidence file its `cifUrl` points at, and returns the pLDDT categories
 * as one string. `fetch` is stubbed, so no test touches the network.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { alphafoldConfidenceAdapter } from '../alphafold-confidence-adapter.js';

const SEQUENCE = 'MLPGLALLLL';

const MODEL_URL = 'https://alphafold.ebi.ac.uk/files/AF-P05067-F1-model_v4.cif';
const CONFIDENCE_URL =
  'https://alphafold.ebi.ac.uk/files/AF-P05067-F1-confidence_v4.json';

const prediction = (overrides: Record<string, unknown> = {}) => ({
  entryId: 'AF-P05067-F1',
  uniprotAccession: 'P05067',
  sequence: SEQUENCE,
  cifUrl: MODEL_URL,
  ...overrides,
});

const PROTEIN = { sequence: { sequence: SEQUENCE } };

const CONFIDENCE = {
  residueNumber: [1, 2, 3, 4],
  confidenceScore: [95.1, 81.3, 60.2, 32.5],
  confidenceCategory: ['H', 'M', 'L', 'D'],
};

/** Stub `fetch` with one response and return the mock. */
const stubFetch = (response: Partial<Response>) => {
  const fn = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fn);
  return fn;
};

const okJson = (body: unknown): Partial<Response> => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body),
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('alphafoldConfidenceAdapter', () => {
  it('returns the joined categories for the one prediction matching the sequence', async () => {
    const fetchFn = stubFetch(okJson(CONFIDENCE));
    const other = prediction({
      sequence: 'MKKK',
      cifUrl: 'https://alphafold.ebi.ac.uk/files/AF-OTHER-F1-model_v4.cif',
    });

    const result = await alphafoldConfidenceAdapter(
      [other, prediction()],
      PROTEIN
    );

    expect(result).toBe('HMLD');
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('derives the confidence URL by swapping -model for -confidence and .cif for .json', async () => {
    const fetchFn = stubFetch(okJson(CONFIDENCE));

    await alphafoldConfidenceAdapter([prediction()], PROTEIN);

    expect(fetchFn).toHaveBeenCalledWith(CONFIDENCE_URL);
  });

  it('returns undefined without fetching when no prediction matches', async () => {
    const fetchFn = stubFetch(okJson(CONFIDENCE));

    const result = await alphafoldConfidenceAdapter(
      [prediction({ sequence: 'MKKK' })],
      PROTEIN
    );

    expect(result).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns undefined without fetching for an empty prediction list', async () => {
    const fetchFn = stubFetch(okJson(CONFIDENCE));

    const result = await alphafoldConfidenceAdapter([], PROTEIN);

    expect(result).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('warns and returns undefined when more than one prediction matches', async () => {
    const fetchFn = stubFetch(okJson(CONFIDENCE));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await alphafoldConfidenceAdapter(
      [prediction(), prediction({ entryId: 'AF-P05067-F2' })],
      PROTEIN
    );

    expect(result).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('more than one matches (2)');
  });

  it('returns undefined without fetching when the match has no cifUrl', async () => {
    const fetchFn = stubFetch(okJson(CONFIDENCE));

    const result = await alphafoldConfidenceAdapter(
      [prediction({ cifUrl: undefined })],
      PROTEIN
    );

    expect(result).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws with the status and URL when the confidence fetch fails', async () => {
    stubFetch({ ok: false, status: 503 });

    await expect(
      alphafoldConfidenceAdapter([prediction()], PROTEIN)
    ).rejects.toThrow(
      `AlphaFold confidence data unavailable (HTTP 503) at ${CONFIDENCE_URL}`
    );
  });

  it('returns undefined for a 200 response whose body is null', async () => {
    stubFetch(okJson(null));

    const result = await alphafoldConfidenceAdapter([prediction()], PROTEIN);

    expect(result).toBeUndefined();
  });

  // Pins current behaviour: only the first hop of the body is guarded, so a
  // 200 response of the wrong shape throws a TypeError rather than a
  // descriptive error (failure mode F3 in
  // specs/alphafold-alphamissense-adapter-hardening.md). The loader's
  // per-track catch still turns it into a track error.
  it('throws a TypeError for a 200 response without confidenceCategory', async () => {
    stubFetch(okJson({ residueNumber: [1], confidenceScore: [90] }));

    await expect(
      alphafoldConfidenceAdapter([prediction()], PROTEIN)
    ).rejects.toThrow(TypeError);
  });

  // Pins current behaviour: a missing prediction payload is not guarded
  // (failure mode F1 in the hardening spec).
  it('throws a TypeError when the prediction payload is missing', async () => {
    await expect(
      alphafoldConfidenceAdapter(undefined, PROTEIN)
    ).rejects.toThrow(TypeError);
  });
});
