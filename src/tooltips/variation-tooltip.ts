import {
  Association,
  Description,
  PopulationFrequency,
  Variant,
  Prediction,
} from '@nightingale-elements/nightingale-variation';
import groupBy from 'lodash-es/groupBy';

import { escapeHtml } from '../utils/security';
import { formatXrefs, getEvidenceFromCodes } from './feature-tooltip';

const getDiseaseAssociations = (associations: Association[]): string =>
  associations
    ?.map(
      (association) => `
              <h4>Disease association</h4><p>${escapeHtml(association.name)}</p>
              ${
                association.description
                  ? `<p>${escapeHtml(association.description)}</p>`
                  : ''
              }
              ${
                association.dbReferences
                  ? `<h5>Cross-references</h5>${formatXrefs(
                      association.dbReferences
                    )}`
                  : ''
              }
              ${getEvidenceFromCodes(association.evidences)}
          `
    )
    .join('');

const getDescriptions = (descriptions: Description[]): string =>
  `<hr/><h5>Description</h5>${descriptions
    .map((description) => `<p>${escapeHtml(description.value)}</p>`)
    .join('')}
  `;

const getPopulationFrequencies = (
  popFrequencies: PopulationFrequency[]
): string =>
  `<hr/><h5>Population frequencies</h5>${popFrequencies
    .map(
      (freq) =>
        `<p>${escapeHtml(freq.frequency)} - ${escapeHtml(freq.populationName)} (${escapeHtml(freq.source)})</p>`
    )
    .join('')}`;

const getEnsemblCovidLinks = (variant: Variant): string => {
  const shouldGenerateLink = variant.locations.some(
    (location) => location.source === 'EnsemblViruses'
  );
  if (shouldGenerateLink) {
    const xref = variant.xrefs.find((xref) => xref.name === 'ENA');
    return xref?.id
      ? `<h5>Ensembl COVID-19</h5>
          <p>
          <a href="https://covid-19.ensembl.org/Sars_cov_2/Variation/Explore?v=${encodeURIComponent(xref.id)}" target="_blank" rel="noopener noreferrer">${escapeHtml(xref.id)}</a>
        </p>`
      : '';
  }
  return '';
};

const getPredictions = (predictions: Prediction[]): string => {
  const groupedPredictions = groupBy(predictions, 'predAlgorithmNameType');
  const counts = Object.keys(groupedPredictions).map((key) => {
    const valueGroups = groupBy(groupedPredictions[key], 'predictionValType');
    return {
      algorithm: key,
      values: Object.keys(valueGroups).map((valKey) => ({
        name: valKey,
        count: valueGroups[valKey].length,
      })),
    };
  });
  return counts
    .map(
      (countItem) =>
        `<h6>${escapeHtml(countItem.algorithm)}</h6><ul class="no-bullet">${countItem.values
          .map((countValue) => `<li>${escapeHtml(countValue.name)}</li>`)
          .join('')}</ul>`
    )
    .join('');
};

const formatTooltip = (variant: Variant): string =>
  `
  ${
    variant.type && variant.begin && variant.end
      ? `<h4>${escapeHtml(variant.type)} ${escapeHtml(variant.begin)}-${escapeHtml(variant.end)}</h4><hr />`
      : ''
  }
  <h5>Variant</h5><p>${escapeHtml(variant.wildType)} > ${
    escapeHtml(variant.alternativeSequence) || ''
  }</p>
  ${
    variant.populationFrequencies
      ? getPopulationFrequencies(variant.populationFrequencies)
      : ''
  }
  ${
    variant.consequenceType
      ? `<h5>Consequence</h5><p>${escapeHtml(variant.consequenceType)}</p>`
      : ``
  }
  ${
    variant.somaticStatus
      ? `<h5>Somatic</h5><p>${variant.somaticStatus === 0 ? 'No' : 'Yes'}</p>`
      : ``
  }
  ${
    variant.genomicLocation?.length
      ? `<h5>Location</h5><p>${variant.genomicLocation.map(escapeHtml).join(', ')}</p>`
      : ``
  }
  ${variant.ftId ? `<h5>Feature ID</h5><p>${escapeHtml(variant.ftId)}</p>` : ``}
  ${variant.descriptions ? getDescriptions(variant.descriptions) : ''}
  ${variant.association ? getDiseaseAssociations(variant.association) : ''}
  ${variant.predictions ? getPredictions(variant.predictions) : ''}
  ${getEnsemblCovidLinks(variant)}
`;

export default formatTooltip;
