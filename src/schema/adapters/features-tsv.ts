/**
 * `features-tsv` — the tab-separated sibling of `features-csv`.
 *
 * Identical convention and behaviour, only the delimiter differs: header
 * row `type<TAB>start<TAB>end<TAB>description[<TAB>score]`. All parsing,
 * validation, and error reporting is shared via `./dsv` so the two
 * adapters can never drift.
 */

import type { AdapterFunction } from '../types.js';
import { parseDelimited, rowsToFeatureRecords } from './dsv.js';

export const featuresTsv: AdapterFunction = (raw) => {
  if (typeof raw !== 'string') {
    console.warn(
      '[protvista] features-tsv adapter: expected a text body; got ' +
        typeof raw +
        '. Treating as empty.'
    );
    return [];
  }
  return rowsToFeatureRecords(parseDelimited(raw, '\t'), {
    formatLabel: 'features-tsv',
  });
};
