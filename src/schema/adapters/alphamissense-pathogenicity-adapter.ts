import type { AlphaFoldPayload } from '@nightingale-elements/nightingale-structure';

import type { AdapterFunction } from '../types.js';

// from color scale B:0,H:0.1132,V:0.2264,L:0.3395,A:0.4527,l:0.5895,h:0.7264,p:0.8632,P:1
const certainlyBenign = 0;
const benign = 0.1132;
const veryLikelyBenign = 0.2264;
const likelyBenign = 0.3395;
const ambiguous = 0.4527;
const likelyAmbiguous = 0.5895;
const likelyPathogenic = 0.7264;
const pathogenic = 0.8632;
const certainlyPathogenic = 1;

export const rowSplitter = /\s*\n\s*/;
export const cellSplitter = /^(.)(\d+)(.),(.+),(\w+)$/;

const pathogenicityCategories = [
  { min: certainlyBenign, max: benign, code: 'H' },
  { min: benign, max: veryLikelyBenign, code: 'V' },
  { min: veryLikelyBenign, max: likelyBenign, code: 'L' },
  { min: likelyBenign, max: ambiguous, code: 'A' },
  { min: ambiguous, max: likelyAmbiguous, code: 'l' },
  { min: likelyAmbiguous, max: likelyPathogenic, code: 'h' },
  { min: likelyPathogenic, max: pathogenic, code: 'p' },
  { min: pathogenic, max: certainlyPathogenic, code: 'P' },
];

// The top bucket's `max` is inclusive, so an average of exactly 1 is `P`
// rather than matching nothing.
const getPathogenicityCode = (score: number): string | undefined => {
  for (const { min, max, code } of pathogenicityCategories) {
    if (
      score >= min &&
      (score < max || (max === certainlyPathogenic && score === max))
    ) {
      return code;
    }
  }
};

// Stands in for a position the CSV has no (usable) score for, so every later
// residue stays at its own position instead of shifting left by one. The
// `alphamissense-ramp` theme (src/renderer/render-helpers.ts) gives it a
// transparent stop of its own: nightingale-colored-sequence draws a character
// missing from its scale at the scale's 0 end, which here is the
// certainly-benign colour.
export const NO_SCORE = '-';

export type AlphaMissenseRow = {
  wildType: string;
  position: number;
  mutated: string;
  pathogenicityScore: number;
  pathogenicityLabel: string;
};

/**
 * Parse an AlphaMissense annotations CSV into rows, shared by this adapter
 * and `alphamissense-full-csv`. The header and any row that doesn't match
 * `cellSplitter` (blank, short or stray lines), names a position below 1, or
 * whose score isn't a number (text, or an extra column the greedy score group
 * swallowed) is skipped rather than thrown on or passed on as `NaN`.
 */
export const parseRows = (rawText: string): Array<AlphaMissenseRow> => {
  const rows: Array<AlphaMissenseRow> = [];
  for (const [i, row] of rawText.split(rowSplitter).entries()) {
    if (i === 0 || !row) {
      continue;
    }
    const match = row.match(cellSplitter);
    if (!match) {
      continue;
    }
    const [
      ,
      wildType,
      positionString,
      mutated,
      pathogenicityScore,
      pathogenicityLabel,
    ] = match;
    const position = +positionString;
    if (position < 1) {
      continue;
    }
    const score = +pathogenicityScore;
    if (!pathogenicityScore.trim() || !Number.isFinite(score)) {
      continue;
    }
    rows.push({
      wildType,
      position,
      mutated,
      pathogenicityScore: score,
      pathogenicityLabel,
    });
  }
  return rows;
};

const parseCSV = (rawText: string): string => {
  const positions: Array<Array<AlphaMissenseRow>> = [];
  for (const row of parseRows(rawText)) {
    const index = row.position - 1;
    if (!positions[index]) {
      positions[index] = [];
    }
    positions[index].push(row);
  }

  // `Array.from` visits the holes a position missing from the CSV leaves, so
  // the output is as long as the highest position.
  return Array.from(positions, (position) => {
    if (!position) {
      return NO_SCORE;
    }
    // maximum
    // const value = Math.max(
    //   ...position.map((variation) => variation.pathogenicityScore)
    // );
    // average
    const value =
      position.reduce(
        (acc, variation) => acc + variation.pathogenicityScore,
        0
      ) / position.length;
    return getPathogenicityCode(value) ?? NO_SCORE;
  }).join('');
};

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
const loadAndParseAnnotations = async (url: string): Promise<string> => {
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

export const alphamissensePathogenicityAdapter: AdapterFunction = async (
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
      `Found more than one matches (${alphaFoldSequenceMatch.length}) for AlphaMissense pathogenicity score against protein sequence: ${protein.sequence}`
    );
  }
};
