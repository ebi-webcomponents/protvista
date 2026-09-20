/**
 * `variation-tsv` — the tab-separated sibling of `variation-csv`.
 *
 * Identical convention and behaviour, only the delimiter differs: header
 * `position<TAB>variant`. All parsing, validation, error reporting, and
 * payload construction is shared via `./dsv` and `./variation` so the two
 * adapters can never drift. Selected by the `.tsv` extension on a
 * kind-addressed track (see `KIND_ADAPTER_VARIANTS` in `../file-formats.ts`).
 */

import type { AdapterFunction } from '../types.js';
import { parseDelimited, rowsToVariationRecords } from './dsv.js';
import { toVariants } from './variation.js';

export const variationTsv: AdapterFunction = (raw) => {
  if (typeof raw !== 'string') {
    console.warn(
      '[protvista] variation-tsv adapter: expected a text body; got ' +
        typeof raw +
        '. Treating as empty.'
    );
    return { variants: [] };
  }
  return toVariants(
    rowsToVariationRecords(parseDelimited(raw, '\t'), {
      formatLabel: 'variation-tsv',
    })
  );
};
