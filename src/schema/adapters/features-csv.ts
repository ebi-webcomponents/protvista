/**
 * `features-csv` — a generic-format adapter for bring-your-own-data.
 *
 * Parses a CSV body with the header row
 * `type,start,end,description[,score]` into feature records the
 * Nightingale track components render directly, so an author can point a
 * track at `./features.csv` with no per-track glue.
 *
 * Everything but the delimiter is shared with `features-tsv` via
 * `./dsv`. Malformed input throws a descriptive, row/column-named error
 * (see `rowsToFeatureRecords`); the loader turns that into the track's
 * parse-failure surface rather than crashing the viewer.
 */

import type { AdapterFunction } from '../types';
import { parseDelimited, rowsToFeatureRecords } from './dsv';

export const featuresCsv: AdapterFunction = (raw) => {
  if (typeof raw !== 'string') {
    console.warn(
      '[protvista] features-csv adapter: expected a text body; got ' +
        typeof raw +
        '. Treating as empty.'
    );
    return [];
  }
  return rowsToFeatureRecords(parseDelimited(raw, ','), {
    formatLabel: 'features-csv',
  });
};
