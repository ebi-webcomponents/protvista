/**
 * `variation-csv` — the comma-separated form of the `variation` family.
 *
 * Parses a CSV body whose header contains `position,variant` (with optional
 * `wildType`, `description`, `consequence` columns) into the same
 * `{ variants }` payload the JSON `variation` adapter emits, so an author can
 * point a `kind: variants` track at `./my-variants.csv` with no per-track
 * glue. Selected by the `.csv` extension on a kind-addressed track (see
 * `KIND_ADAPTER_VARIANTS` in `../file-formats.ts`).
 *
 * Everything but the delimiter is shared with `variation-tsv` via `./dsv`,
 * and the payload shape with `variation` via `./variation`. Malformed input
 * throws a descriptive, row/column-named error (see `rowsToVariationRecords`).
 */

import type { AdapterFunction } from '../types.js';
import { parseDelimited, rowsToVariationRecords } from './dsv.js';
import { toVariants } from './variation.js';

export const variationCsv: AdapterFunction = (raw) => {
  if (typeof raw !== 'string') {
    console.warn(
      '[protvista] variation-csv adapter: expected a text body; got ' +
        typeof raw +
        '. Treating as empty.'
    );
    return { variants: [] };
  }
  return toVariants(
    rowsToVariationRecords(parseDelimited(raw, ','), {
      formatLabel: 'variation-csv',
    })
  );
};
