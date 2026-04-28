import ColorHash from 'color-hash';

import formatTooltip from '../tooltips/interpro-tooltip';

import { InterProProteinSearch, TransformedInterPro } from './types/interpro';

// Copied from InterPro to replicate the same colours for the representative domains
const colorHash = new ColorHash({
  hash: 'bkdr',
  saturation: [0.65, 0.35, 0.5],
  lightness: [0.65, 0.35, 0.5],
});

const transformData = (data: InterProProteinSearch): TransformedInterPro => {
  try {
    return data?.results?.map(({ metadata, proteins }) => {
      const start = proteins[0].entry_protein_locations
        ? Math.min(
            ...proteins[0].entry_protein_locations.map((location) =>
              Math.min(...location.fragments.map((fragment) => fragment.start))
            )
          )
        : '';

      const end = proteins[0].entry_protein_locations
        ? Math.max(
            ...(proteins[0].entry_protein_locations?.map((location) =>
              Math.max(...location.fragments.map((fragment) => fragment.end))
            ) || [])
          )
        : '';

      return {
        ...metadata,
        locations: proteins[0].entry_protein_locations,
        start,
        end,
        color: colorHash.hex(
          metadata.accession.toLowerCase().split('').reverse().join('')
        ),
        tooltipContent: formatTooltip(start, end, metadata),
        length: proteins[0].protein_length,
      };
    });
  } catch (error) {
    const err = new Error(`Failed transforming the data: ${error}`);
    throw err;
  }
};

export default transformData;
