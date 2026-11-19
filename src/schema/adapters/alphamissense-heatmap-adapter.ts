import type { AlphaFoldPayload } from '@nightingale-elements/nightingale-structure';

import type { AdapterFunction } from '../types.js';
import { parseRows } from './alphamissense-pathogenicity-adapter.js';

type HeatmapCell = {
  xValue: number;
  yValue: string;
  score: number;
};

const parseCSV = (rawText: string): Array<HeatmapCell> =>
  parseRows(rawText).map(({ position, mutated, pathogenicityScore }) => ({
    xValue: position,
    yValue: mutated,
    score: pathogenicityScore,
  }));

/**
 * Fetch and parse the AlphaMissense annotations the prediction payload points
 * at.
 *
 * Throws on failure rather than logging and returning nothing. This is a
 * second request the loader cannot see, so its outcome has to leave through
 * the adapter: a throw reaches the loader's per-track catch and is routed
 * like any other track failure — a badge, the event, and (this being a
 * provider source) a Retry, since an outage here is usually transient.
 * Unchecked, an error page's body went on to `parseCSV` as if it were data.
 */
const loadAndParseAnnotations = async (
  url: string
): Promise<Array<HeatmapCell>> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `AlphaMissense pathogenicity data unavailable (HTTP ${response.status}) at ${url}`
    );
  }
  return parseCSV(await response.text());
};

type PartialProtein = {
  sequence: {
    sequence: string;
  };
};

export const alphamissenseHeatmapAdapter: AdapterFunction = async (
  raw,
  proteinRaw
) => {
  const data = raw as AlphaFoldPayload;
  const protein = proteinRaw as PartialProtein;
  const alphaFoldSequenceMatch = data?.filter(
    ({ sequence, amAnnotationsUrl }) =>
      protein.sequence.sequence === sequence && amAnnotationsUrl
  );
  if (alphaFoldSequenceMatch.length === 1) {
    const heatmapData = await loadAndParseAnnotations(
      alphaFoldSequenceMatch[0].amAnnotationsUrl
    );
    return heatmapData;
  } else if (alphaFoldSequenceMatch.length > 1) {
    console.warn(
      `Found more than one matches (${alphaFoldSequenceMatch.length}) for AlphaMissense pathogenicity against protein sequence: ${protein.sequence}`
    );
  }
};
