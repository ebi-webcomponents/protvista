import type { AlphaFoldPayload } from '@nightingale-elements/nightingale-structure';

import type { AdapterFunction } from '../types';

type AlphafoldConfidencePayload = {
  residueNumber: Array<number>;
  confidenceScore: Array<number>;
  confidenceCategory: Array<string>;
};

const getConfidenceURLFromPayload = (af: AlphaFoldPayload[number]) =>
  af.cifUrl?.replace('-model', '-confidence').replace('.cif', '.json');

const loadConfidence = async (
  url: string
): Promise<AlphafoldConfidencePayload> => {
  try {
    const payload = await fetch(url);
    return payload.json();
  } catch (e) {
    console.error('Could not load AlphaFold confidence', e);
  }
};

type PartialProtein = {
  sequence: {
    sequence: string;
  };
};

export const alphafoldConfidenceAdapter: AdapterFunction = async (
  raw,
  proteinRaw
) => {
  const data = raw as AlphaFoldPayload;
  const protein = proteinRaw as PartialProtein;
  const alphaFoldSequenceMatch = data?.filter(
    ({ sequence }) => protein.sequence.sequence === sequence
  );
  if (alphaFoldSequenceMatch.length === 1) {
    const confidenceUrl = getConfidenceURLFromPayload(
      alphaFoldSequenceMatch[0]
    );
    if (!confidenceUrl) {
      return;
    }
    const confidenceData = await loadConfidence(confidenceUrl);
    return confidenceData?.confidenceCategory.join('');
  } else if (alphaFoldSequenceMatch.length > 1) {
    console.warn(
      `Found more than one matches (${alphaFoldSequenceMatch.length}) for AlphaFold confidence adapter against protein sequence: ${protein.sequence}`
    );
  }
};
