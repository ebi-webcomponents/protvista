/**
 * `linegraph-tsv` — the tab-separated sibling of `linegraph-csv`.
 *
 * Identical convention and behaviour, only the delimiter differs: header
 * row `position<TAB>value`. All parsing, validation, error reporting, and
 * series construction is shared via `./dsv` and `./linegraph` so the two
 * adapters can never drift. Selected by the `.tsv` extension on a
 * kind-addressed track (see `KIND_ADAPTER_VARIANTS` in `../file-formats.ts`).
 */

import type { AdapterFunction } from '../types.js';
import { parseDelimited, rowsToPointRecords } from './dsv.js';
import { toSeries } from './linegraph.js';

export const linegraphTsv: AdapterFunction = (raw) => {
  if (typeof raw !== 'string') {
    console.warn(
      '[protvista] linegraph-tsv adapter: expected a text body; got ' +
        typeof raw +
        '. Treating as empty.'
    );
    return [];
  }
  return toSeries(
    rowsToPointRecords(parseDelimited(raw, '\t'), {
      formatLabel: 'linegraph-tsv',
    })
  );
};
