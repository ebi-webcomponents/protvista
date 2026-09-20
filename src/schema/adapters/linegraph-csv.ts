/**
 * `linegraph-csv` — the comma-separated form of the `linegraph` kind.
 *
 * Parses a CSV body with the header row `position,value` into the same
 * single line-graph series the JSON `linegraph` adapter emits, so an author
 * can point a `kind: linegraph` track at `./depth.csv` with no per-track
 * glue. Selected by the `.csv` extension on a kind-addressed track (see
 * `KIND_ADAPTER_VARIANTS` in `../file-formats.ts`).
 *
 * Everything but the delimiter is shared with `linegraph-tsv` via `./dsv`,
 * and the series shape with `linegraph` via `./linegraph`. Malformed input
 * throws a descriptive, row/column-named error (see `rowsToPointRecords`);
 * the loader turns that into the track's parse-failure surface rather than
 * crashing the viewer.
 */

import type { AdapterFunction } from '../types.js';
import { parseDelimited, rowsToPointRecords } from './dsv.js';
import { toSeries } from './linegraph.js';

export const linegraphCsv: AdapterFunction = (raw) => {
  if (typeof raw !== 'string') {
    console.warn(
      '[protvista] linegraph-csv adapter: expected a text body; got ' +
        typeof raw +
        '. Treating as empty.'
    );
    return [];
  }
  return toSeries(
    rowsToPointRecords(parseDelimited(raw, ','), {
      formatLabel: 'linegraph-csv',
    })
  );
};
