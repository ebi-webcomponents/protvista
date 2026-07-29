import type { AlphaFoldPayload } from '@nightingale-elements/nightingale-structure';

import type { AdapterFunction } from '../types.js';
import {
  cellSplitter,
  rowSplitter,
} from './alphamissense-pathogenicity-adapter.js';

const parseCSV = (rawText: string): Array<Record<string, string>> => {
  const data = [];

  for (const [i, row] of rawText.split(rowSplitter).entries()) {
    if (i === 0 || !row) {
      continue;
    }
    const [, , positionString, mutated, pathogenicityScore] =
      row.match(cellSplitter);

    data.push({
      xValue: +positionString,
      yValue: mutated,
      score: +pathogenicityScore,
    });
  }
  return data;
};

// Load and parse
const loadAndParseAnnotations = async (
  url: string
): Promise<Array<Record<string, string>>> => {
  try {
    const payload = await fetch(url);
    const rawCSV = await payload.text();
    return parseCSV(rawCSV);
  } catch (e) {
    console.error('Could not load AlphaMissense pathogenicity', e);
  }
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
