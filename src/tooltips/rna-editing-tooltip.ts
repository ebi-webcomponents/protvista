import { TransformedRnaEditing } from '../adapters/types/rna-editing';
import { escapeHtml } from '../utils/security';

const getREDIportalId = (feature: TransformedRnaEditing) =>
  feature.dbReferenceType.find((db) => db.type === 'rna_editing')?.id;

const getREDIportalLink = (id: string) =>
  `http://srv00.recas.ba.infn.it/cgi/atlas/getpage_dev.py?query9=hg&query10=hg38&acc=${encodeURIComponent(id)}`;

const getEnsemblLink = (id: string) => `https://www.ensembl.org/id/${encodeURIComponent(id)}`;

const getLinks = (feature: TransformedRnaEditing) => {
  const links = [];
  const rediPortalId = getREDIportalId(feature);
  if (rediPortalId) {
    links.push(
      `REDIportal <a href="${getREDIportalLink(
        rediPortalId
      )}" target="_blank">${escapeHtml(rediPortalId)}</a>`
    );
  }
  for (const variantLocation of feature.variantType.variantLocation) {
    if (variantLocation.source === 'Ensembl') {
      links.push(
        `Ensembl <a href="${getEnsemblLink(variantLocation.seqId)}" target="_blank">${
          escapeHtml(variantLocation.seqId)
        }</a>`
      );
    }
  }
  return links.length === 0
    ? ''
    : `<br><ul class="no-bullet">${links
        .map((link) => `<li>${link}</li>`)
        .join('')}</ul>`;
};

const formatTooltip = (feature: TransformedRnaEditing): string => `
  ${
    feature.start && feature.end
      ? `<h4>RNA Edit ${escapeHtml(feature.start)}-${escapeHtml(feature.end)}</h4><hr />`
      : ''
  }
  <h5>Variant</h5>
  <p>${escapeHtml(feature.variantType.wildType)} > ${escapeHtml(feature.variantType.mutatedType)}</p>
  <h5>Consequence</h5>
  <p>${escapeHtml(feature.consequenceType)}</p>
  <h5>Location</h5>
  <ul class="no-bullet">${feature.variantType.genomicLocation
    .map((l) => `<li>${escapeHtml(l)}</li>`)
    .join('')}
  ${getLinks(feature)}
  `;

export default formatTooltip;
