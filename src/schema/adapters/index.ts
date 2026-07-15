/**
 * Built-in adapter table.
 *
 * The single aggregation point for adapters the library ships with.
 * `registerBuiltinAdapters()` in `../registry` walks this table and
 * registers every entry into each new registry, so consumers get them
 * without calling `registerAdapter()` themselves.
 *
 * To add a built-in adapter: write the adapter module in this
 * directory, add its name to `KnownAdapterName` in `../types`, and add
 * one line to the table below.
 *
 * The table is empty today. The generic-format adapters
 * (`features-json`, `features-csv`, `features-tsv`, `bed`) each land in
 * their own ticket and fill it in one line at a time.
 */

import type { AdapterFunction, KnownAdapterName } from '../types';

export const BUILTIN_ADAPTERS: ReadonlyArray<
  readonly [KnownAdapterName, AdapterFunction]
> = [
  // ['features-json', featuresJson],
];
