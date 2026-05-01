import { PTM } from '../adapters/ptm-exchange-adapter';
import { escapeHtml } from '../utils/security';

type Modification =
  | 'Phosphorylation'
  | 'SUMOylation'
  | 'Ubiquitinylation'
  | 'Acetylation';

const aaToPhosphorylated = {
  R: 'Phosphoarginine',
  C: 'Phosphocysteine',
  H: 'Phosphohistidine',
  S: 'Phosphoserine',
  T: 'Phosphothreonine',
  Y: 'Phosphotyrosine',
};

const aaToSumoylated = {
  K: 'Sumoylated lysine',
};

const aaToUbiquitinated = {
  K: 'Ubiquitinated lysine',
  S: 'Ubiquitinated serine',
  T: 'Ubiquitinated threonine',
  C: 'Ubiquitinated cysteine',
};

const aaToAcetylated = {
  S: 'Acetylserine',
  A: 'Acetylalanine',
  G: 'Acetylglycine',
  T: 'Acetylthreonine',
  V: 'Acetylvaline',
  C: 'Acetylcysteine',
  E: 'Acetylglutamin acid',
  D: 'Acetylaspartic acid',
  N: 'Acetylasparagine',
  Q: 'Acetylglutamine',
  L: 'Acetyllucine',
  I: 'Acetlyisolucine',
  W: 'Acetyltryptophan',
  F: 'Acetylphenylalanine',
  K: 'Acetyllysine',
};

export const phosphorylate = (aa: string) => {
  const AA = aa.toUpperCase();
  if (AA in aaToPhosphorylated) {
    return aaToPhosphorylated[AA as keyof typeof aaToPhosphorylated];
  }
  console.error(`${AA} not a valid amino acid for phosphorylation`);
  return '';
};

export const sumoylate = (aa: string) => {
  const AA = aa.toUpperCase();
  if (AA in aaToSumoylated) {
    return aaToSumoylated[AA as keyof typeof aaToSumoylated];
  }
  console.error(`${AA} not a valid amino acid for SUMOylation`);
  return '';
};

export const ubiquitinate = (aa: string) => {
  const AA = aa.toUpperCase();
  if (AA in aaToUbiquitinated) {
    return aaToUbiquitinated[AA as keyof typeof aaToUbiquitinated];
  }
  console.error(`${AA} not a valid amino acid for Ubiquitinylation`);
  return '';
};

export const acetylate = (aa: string) => {
  const AA = aa.toUpperCase();
  if (AA in aaToAcetylated) {
    return aaToAcetylated[AA as keyof typeof aaToAcetylated];
  }
  console.error(`${AA} not a valid amino acid for Acetylation`);
  return '';
};

const getDescription = (modification: Modification, aa: string) => {
  switch (modification) {
    case 'Phosphorylation':
      return phosphorylate(aa);
    case 'SUMOylation':
      return sumoylate(aa);
    case 'Ubiquitinylation':
      return ubiquitinate(aa);
    case 'Acetylation':
      return acetylate(aa);
    default:
      return '';
  }
};

const formatTooltip = (
  title: string,
  ptms: PTM[],
  aa: string,
  confidenceScore: string
): string => {
  const evidences = [
    ...ptms.flatMap(({ dbReferences }) =>
      dbReferences?.flatMap(({ id }) => [id])
    ),
  ];

  let modification: Modification | undefined;
  const modifications = new Set(
    ptms.flatMap(({ name }) => name as Modification)
  );
  if (modifications.size) {
    if (modifications.size > 1) {
      console.error(
        `The ptms are grouped by modification, but more than one type detected: ${Array.from(
          modifications
        )}`
      );
    } else {
      [modification] = modifications;
    }
  }

  return `
  ${title ? `<h4>${escapeHtml(title)}</h4><hr />` : ''}
  ${modification ? `<h5>Description</h5><p>${escapeHtml(getDescription(modification, aa))}</p>` : ''}
  ${
    confidenceScore
      ? `<h5 data-article-id="mod_res_large_scale#confidence-score">Confidence Score</h5><p>${escapeHtml(confidenceScore)}</p>`
      : ''
  }
  ${
    evidences
      ? `<h5>Evidence</h5><ul class="no-bullet">${evidences
          .map((id) => {
            const datasetID = id === 'Glue project' ? 'PXD012174' : id;
            const safeDatasetID = escapeHtml(datasetID);
            return `<li title='${safeDatasetID}'>${safeDatasetID}&nbsp;
              (<a href="https://proteomecentral.proteomexchange.org/dataset/${encodeURIComponent(datasetID)}" target="_blank">ProteomeXchange</a>)
              </li>
              ${
                id === 'Glue project'
                  ? `<li title="publication">Publication:&nbsp;31819260&nbsp;(<a href="https://pubmed.ncbi.nlm.nih.gov/31819260" target="_blank">PubMed</a>)</li>`
                  : ''
              }
              `;
          })
          .join('')}</ul>`
      : ''
  }`;
};

export default formatTooltip;
