/**
 * Single source of truth mapping a data file's extension to the built-in
 * adapter that parses it and how its HTTP body must be read.
 *
 * Three consumers share this table so they can never disagree about what
 * `./x.csv` means:
 *   - `normalize.ts` — infers the adapter for a file-path `data:` shorthand.
 *   - `validate.ts`  — recognises a file-path shorthand as valid (rather
 *     than reporting "Unknown source key").
 *   - `load-data.ts` — decides whether to read a track's response as text
 *     (delimited formats) or JSON.
 *
 * To add a format: add one row below and register the adapter in
 * `adapters/index.ts` and the runtime `adapters` map in
 * `protvista-uniprot.ts`. Nothing else here needs to change —
 * `body: 'json'` vs `'text'` already distinguishes a JSON payload
 * (`features-json`) from delimited text (`bed`).
 */

import type { KnownAdapterName } from './types.js';

export interface DataFileFormat {
  /** The lower-cased extension including the dot, e.g. `.csv`. */
  ext: string;
  /** The built-in adapter that parses this format. */
  adapter: KnownAdapterName;
  /** How the fetched response body must be read before the adapter runs. */
  body: 'text' | 'json';
}

/** Extension → format descriptor. Keys are lower-case, dot-prefixed. */
export const DATA_FILE_FORMATS: Record<string, DataFileFormat> = {
  '.csv': { ext: '.csv', adapter: 'features-csv', body: 'text' },
  '.tsv': { ext: '.tsv', adapter: 'features-tsv', body: 'text' },
  '.json': { ext: '.json', adapter: 'features-json', body: 'json' },
  '.bed': { ext: '.bed', adapter: 'bed', body: 'text' },
};

/**
 * The adapters whose response bodies must be fetched as raw text (rather
 * than parsed as JSON). Derived from {@link DATA_FILE_FORMATS} so the
 * table above stays the only thing a new format has to touch.
 */
export const TEXT_BODY_ADAPTERS: ReadonlySet<string> = new Set(
  Object.values(DATA_FILE_FORMATS)
    .filter((f) => f.body === 'text')
    .map((f) => f.adapter)
);

/**
 * Every built-in generic-format (bring-your-own-file) adapter, regardless
 * of body type. Derived from {@link DATA_FILE_FORMATS}. Unlike
 * {@link TEXT_BODY_ADAPTERS} — which drives the fetch-as-text decision and
 * so must exclude JSON — this set gates the viewer's `hasData` empty-state
 * check, which cares only that a track produced a non-empty feature array
 * (see `assignTrackData` in `load-data.ts`). It therefore includes the
 * JSON-body `features-json` too.
 */
export const GENERIC_FILE_ADAPTERS: ReadonlySet<string> = new Set(
  Object.values(DATA_FILE_FORMATS).map((f) => f.adapter)
);

/**
 * If `value` looks like a path to a known data file, return its format
 * descriptor; otherwise `undefined`. Query string and hash fragment are
 * stripped and the extension is matched case-insensitively, so
 * `./hits.CSV` and `https://host/x.csv?v=2` both resolve.
 */
export function dataFileFormatForPath(value: string): DataFileFormat | undefined {
  const path = value.split(/[?#]/, 1)[0];
  const dot = path.lastIndexOf('.');
  if (dot === -1) return undefined;
  return DATA_FILE_FORMATS[path.slice(dot).toLowerCase()];
}
