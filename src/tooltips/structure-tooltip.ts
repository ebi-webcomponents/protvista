import { escapeHtml, sanitizeUrl } from '../utils/security';
import type { StructureFeature } from '../adapters/structure-adapter';

type StructureItem = {
  source: { url: string; id: string };
  start: number;
  end: number;
};

const getStructuresHTML = (structureList: StructureItem[]) => {
  return `<ul>
              ${structureList
                .map(
                  (
                    structure
                  ) => `<li><a href='${sanitizeUrl(structure.source.url)}' target='_blank'>
              ${escapeHtml(structure.source.id)}
          </a> (${escapeHtml(structure.start)}-${escapeHtml(structure.end)})</li>`
                )
                .join('')}
          </ul>`;
};

const formatTooltip = (feature: StructureFeature) => {
  const structuresHTML = getStructuresHTML(feature.structures);
  return !structuresHTML
    ? ''
    : `
    ${
      feature.type && feature.start && feature.end
        ? `<h4>${escapeHtml(feature.type)} ${escapeHtml(feature.start)}-${escapeHtml(feature.end)}</h4><hr />`
        : ''
    }
    <h5>Structures</h5>${structuresHTML}`;
};

export default formatTooltip;
