import { describe, it, expect, vi, afterEach } from 'vitest';
import { alphamissensePathogenicityAdapter } from '../alphamissense-pathogenicity-adapter.js';
import { alphamissenseHeatmapAdapter } from '../alphamissense-heatmap-adapter.js';

const SEQUENCE = 'MAK';
const AM_URL =
  'https://alphafold.example/files/AF-P00000-F1-aa-substitutions.csv';
const prediction = [{ sequence: SEQUENCE, amAnnotationsUrl: AM_URL }];
const protein = { sequence: { sequence: SEQUENCE } };

const HEADER = 'protein_variant,am_pathogenicity,am_class';

const stubCSV = (rows: string[]) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response([HEADER, ...rows].join('\n')))
  );

afterEach(() => vi.unstubAllGlobals());

describe('alphamissense-average-csv adapter', () => {
  it('averages each position into one pathogenicity code', async () => {
    stubCSV(['M1A,0.05,LBen', 'M1C,0.15,LBen', 'A2V,0.5,Amb', 'K3R,0.9,LPath']);
    expect(await alphamissensePathogenicityAdapter(prediction, protein)).toBe(
      'HlP'
    );
  });

  it('skips a malformed row instead of throwing', async () => {
    stubCSV([
      'M1A,0.05,LBen',
      'not a row',
      'A2',
      'A2V,0.5,Amb',
      'K3R,0.9,LPath',
    ]);
    expect(await alphamissensePathogenicityAdapter(prediction, protein)).toBe(
      'HlP'
    );
  });

  it('skips a row whose score is not a number, so it does not spoil the average', async () => {
    stubCSV([
      'M1A,0.05,LBen',
      'A2V,0.5,Amb',
      'A2C,abc,Amb',
      'A2D,NaN,Amb',
      'A2E,0.9,LPath,extra',
      'K3R,0.9,LPath',
    ]);
    expect(await alphamissensePathogenicityAdapter(prediction, protein)).toBe(
      'HlP'
    );
  });

  it('skips a position-0 row', async () => {
    stubCSV(['M0A,0.5,Amb', 'M1A,0.05,LBen', 'K3R,0.9,LPath']);
    expect(await alphamissensePathogenicityAdapter(prediction, protein)).toBe(
      'H-P'
    );
  });

  it('maps a score of exactly 1 to the top category', async () => {
    stubCSV(['M1A,1,LPath', 'A2V,1.0,LPath']);
    expect(await alphamissensePathogenicityAdapter(prediction, protein)).toBe(
      'PP'
    );
  });

  it('fills a position missing from the CSV, so the output is as long as the highest position', async () => {
    stubCSV(['M1A,0.05,LBen', 'K3R,0.9,LPath']);
    const out = await alphamissensePathogenicityAdapter(prediction, protein);
    expect(out).toBe('H-P');
    expect((out as string).length).toBe(3);
  });

  it('still throws on an HTTP failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 503 }))
    );
    await expect(
      alphamissensePathogenicityAdapter(prediction, protein)
    ).rejects.toThrow(
      `AlphaMissense pathogenicity data unavailable (HTTP 503) at ${AM_URL}`
    );
  });
});

describe('alphamissense-full-csv adapter', () => {
  it('returns one heatmap cell per row', async () => {
    stubCSV(['M1A,0.05,LBen', 'K3R,1,LPath']);
    expect(await alphamissenseHeatmapAdapter(prediction, protein)).toEqual([
      { xValue: 1, yValue: 'A', score: 0.05 },
      { xValue: 3, yValue: 'R', score: 1 },
    ]);
  });

  it('skips a malformed row instead of throwing', async () => {
    stubCSV(['M1A,0.05,LBen', 'not a row', 'A2', '', 'K3R,0.9,LPath']);
    expect(await alphamissenseHeatmapAdapter(prediction, protein)).toEqual([
      { xValue: 1, yValue: 'A', score: 0.05 },
      { xValue: 3, yValue: 'R', score: 0.9 },
    ]);
  });

  it('skips a row whose score is not a number', async () => {
    stubCSV([
      'M1A,0.05,LBen',
      'A2V,abc,Amb',
      'A2C,NaN,Amb',
      'A2D, ,Amb',
      'K3R,0.9,LPath',
    ]);
    expect(await alphamissenseHeatmapAdapter(prediction, protein)).toEqual([
      { xValue: 1, yValue: 'A', score: 0.05 },
      { xValue: 3, yValue: 'R', score: 0.9 },
    ]);
  });

  it('skips a row with an extra column', async () => {
    stubCSV(['M1A,0.05,LBen', 'A2V,0.5,LPath,extra', 'K3R,0.9,LPath']);
    expect(await alphamissenseHeatmapAdapter(prediction, protein)).toEqual([
      { xValue: 1, yValue: 'A', score: 0.05 },
      { xValue: 3, yValue: 'R', score: 0.9 },
    ]);
  });

  it('skips a position-0 row', async () => {
    stubCSV(['M0A,0.5,Amb', 'M1A,0.05,LBen', 'K3R,0.9,LPath']);
    expect(await alphamissenseHeatmapAdapter(prediction, protein)).toEqual([
      { xValue: 1, yValue: 'A', score: 0.05 },
      { xValue: 3, yValue: 'R', score: 0.9 },
    ]);
  });

  it('still throws on an HTTP failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 503 }))
    );
    await expect(
      alphamissenseHeatmapAdapter(prediction, protein)
    ).rejects.toThrow(
      `AlphaMissense pathogenicity data unavailable (HTTP 503) at ${AM_URL}`
    );
  });
});
