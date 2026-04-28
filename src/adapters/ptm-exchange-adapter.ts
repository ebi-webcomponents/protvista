import formatTooltip from '../tooltips/ptm-tooltip';

type ProteomicsPtm = {
  accession: string;
  entryName: string;
  sequence: string;
  sequenceChecksum: string;
  taxid: number;
  features: ProteomicsPtmFeature[];
};

type ProteomicsPtmFeature = {
  type: string;
  begin: string;
  end: string;
  xrefs: Xref[];
  evidences: Evidence[];
  peptide: string;
  unique: boolean;
  ptms: PTM[];
};

type Evidence = {
  code: string;
  source: Source;
};

type Source = {
  id: string;
  url: string;
};

type Xref = {
  name: string;
  id: string;
  url: string;
};

export type PTM = {
  name: string;
  position: number;
  sources: string[];
  dbReferences: DBReference[];
};

type DBReference = {
  id: string;
  properties: { [key: string]: string };
};

enum ConfidenceScoreColors {
  Gold = '#c39b00',
  Silver = '#8194a1',
  Bronze = '#a65708',
}

const convertPtmExchangePtms = (
  ptms: PTM[],
  aa: string,
  absolutePosition: number
) => {
  const groupPtmsByModification: Record<string, PTM[]> = {};
  for (const ptm of ptms) {
    if (groupPtmsByModification[ptm.name]) {
      groupPtmsByModification[ptm.name].push(ptm);
    } else {
      groupPtmsByModification[ptm.name] = [ptm];
    }
  }

  return Object.values(groupPtmsByModification).map((groupedPtms) => {
    const confidenceScores = new Set(
      groupedPtms.flatMap(({ dbReferences }) =>
        dbReferences?.map(({ properties }) => properties['Confidence score'])
      )
    );
    let confidenceScore: string | null = null;
    if (confidenceScores.size) {
      if (confidenceScores.size > 1) {
        console.error(
          `PTMeXchange PTM has a mixture of confidence scores: ${Array.from(
            confidenceScores
          )}`
        );
      } else {
        [confidenceScore] = confidenceScores;
      }
    }

    return {
      source: 'PTMeXchange',
      type: 'MOD_RES_LS',
      start: absolutePosition,
      end: absolutePosition,
      shape: 'triangle',
      tooltipContent: formatTooltip(
        `MOD_RES_LS ${absolutePosition}-${absolutePosition}`,
        groupedPtms,
        aa,
        confidenceScore
      ),
      color:
        (confidenceScore && ConfidenceScoreColors[confidenceScore]) || 'black',
    };
  });
};

const transformData = (data: ProteomicsPtm) => {
  if (data) {
    const { features } = data;

    const absolutePositionToPtms: Record<number, { ptms: PTM[]; aa: string }> =
      {};

    if (features) {
      for (const feature of features) {
        for (const ptm of feature.ptms) {
          const absolutePosition = +feature.begin + ptm.position - 1;
          if (!Number.isFinite(absolutePosition)) {
            console.error(
              `Encountered infinite number: +feature.begin + ptm.position - 1 = ${+feature.begin} + ${
                ptm.position
              } - 1`
            );
            continue;
          }
          const aa = feature.peptide[ptm.position - 1];
          if (absolutePosition in absolutePositionToPtms) {
            if (absolutePositionToPtms[absolutePosition].aa !== aa) {
              console.error(
                `One PTM has different amino acid values: [${absolutePositionToPtms[absolutePosition].aa}, ${aa}]`
              );
            } else {
              absolutePositionToPtms[absolutePosition].ptms.push(ptm);
            }
          } else {
            absolutePositionToPtms[absolutePosition] = { ptms: [ptm], aa };
          }
        }
      }

      return Object.entries(absolutePositionToPtms).map(
        ([absolutePosition, { ptms, aa }]) =>
          convertPtmExchangePtms(ptms, aa, +absolutePosition)
      ).flat();
    }
  }
  return [];
};

export default transformData;
