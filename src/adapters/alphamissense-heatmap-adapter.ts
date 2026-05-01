import { AlphaFoldPayload } from '@nightingale-elements/nightingale-structure';

import {
  cellSplitter,
  rowSplitter,
} from './alphamissense-pathogenicity-adapter';

type HeatmapRow = {
  xValue: number;
  yValue: string;
  score: number;
};

const parseCSV = (rawText: string): HeatmapRow[] => {
  const data: HeatmapRow[] = [];

  for (const [i, row] of rawText.split(rowSplitter).entries()) {
    if (i === 0 || !row) {
      continue;
    }
    const match = row.match(cellSplitter);
    if (!match) continue;
    const [, , positionString, mutated, pathogenicityScore] = match;

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
): Promise<HeatmapRow[] | undefined> => {
  try {
    const payload = await fetch(url);
    const rawCSV = await payload.text();
    return parseCSV(rawCSV);
  } catch (e) {
    console.error('Could not load AlphaMissense pathogenicity', e);
    return undefined;
  }
};

type PartialProtein = {
  sequence: {
    sequence: string;
  };
};

const transformData = async (
  data: AlphaFoldPayload,
  protein: PartialProtein
) => {
  const alphaFoldSequenceMatch = data?.filter(
    ({ sequence, amAnnotationsUrl }) =>
      protein.sequence.sequence === sequence && amAnnotationsUrl
  );
  if (alphaFoldSequenceMatch.length === 1) {
    const url = alphaFoldSequenceMatch[0].amAnnotationsUrl;
    if (!url) return undefined;
    const heatmapData = await loadAndParseAnnotations(url);
    return heatmapData;
  } else if (alphaFoldSequenceMatch.length > 1) {
    console.warn(
      `Found more than one matches (${alphaFoldSequenceMatch.length}) for AlphaMissense pathogenicity against protein sequence: ${protein.sequence}`
    );
  }
};

export default transformData;
