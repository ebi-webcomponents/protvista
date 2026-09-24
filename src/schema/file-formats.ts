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
 *
 * Not every bring-your-own-data adapter is reached by a file extension: a
 * semantic `kind` can resolve to one directly (`kind: linegraph`). Those are
 * listed separately in {@link BYO_DATA_ADAPTERS} rather than given a spurious
 * extension row here, which would also enrol them in adapter inference.
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
 * The delimited forms of a kind-selected adapter, keyed by base adapter and
 * then by file extension.
 *
 * A kind's canonical adapter reads a JSON body, but the same records are just
 * as natural in a spreadsheet export — so each kind may offer per-extension
 * siblings parsing the identical columns (`linegraph` ← `position,value` →
 * `linegraph-csv` / `linegraph-tsv`). They belong here rather than in
 * {@link DATA_FILE_FORMATS} because they are *not* what a bare `./x.csv`
 * shorthand means: `.csv` still infers `features-csv` on a track with no
 * `kind`. Only a kind-addressed track reaches these, via `expandDescriptor`.
 *
 * Every extension used as a key must have a {@link DATA_FILE_FORMATS} row —
 * that row is where the variant's body type comes from, so a delimited
 * variant can never disagree with the format it parses.
 */
export const BYO_ADAPTER_VARIANTS: Record<
  string,
  Readonly<Record<string, KnownAdapterName>>
> = {
  linegraph: { '.csv': 'linegraph-csv', '.tsv': 'linegraph-tsv' },
};

/**
 * The adapters whose response bodies must be fetched as raw text (rather
 * than parsed as JSON). Derived from {@link DATA_FILE_FORMATS} so the
 * table above stays the only thing a new format has to touch.
 */
export const TEXT_BODY_ADAPTERS: ReadonlySet<string> = new Set([
  ...Object.values(DATA_FILE_FORMATS)
    .filter((f) => f.body === 'text')
    .map((f) => f.adapter),
  // The delimited siblings of the kind-selected adapters parse the very same
  // bodies, so they take their body type from the extension's row above
  // rather than declaring one of their own.
  ...Object.values(BYO_ADAPTER_VARIANTS).flatMap((byExt) =>
    Object.entries(byExt)
      .filter(([ext]) => DATA_FILE_FORMATS[ext]?.body === 'text')
      .map(([, adapter]) => adapter)
  ),
]);

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

/** The canonical (JSON / inline) adapter of each kind-selected BYO family. */
const KIND_SELECTED_BASE_ADAPTERS: readonly KnownAdapterName[] = ['linegraph'];

/**
 * Bring-your-own-data adapters that no file extension selects on its own — a
 * `kind:` resolves to them directly (`kind: linegraph` → `adapter: linegraph`,
 * or `linegraph-csv` for a `.csv` path), so they cannot live in
 * {@link DATA_FILE_FORMATS} above without hijacking the bare `./x.csv`
 * shorthand from the feature adapters.
 *
 * Because no extension names them, the kind's family also *outranks* extension
 * inference in `expandDescriptor`: each consumes a payload shape no feature
 * adapter can produce, so letting `./depth.json` infer `features-json` over an
 * explicit `kind: linegraph` would guarantee a parse failure rather than
 * resolve an ambiguity. An explicit `adapter:` still wins over both.
 */
export const KIND_SELECTED_BYO_DATA_ADAPTERS: ReadonlySet<string> =
  new Set<KnownAdapterName>([
    ...KIND_SELECTED_BASE_ADAPTERS,
    ...Object.values(BYO_ADAPTER_VARIANTS).flatMap((v) => Object.values(v)),
  ]);

/**
 * Every bring-your-own-data adapter, however it was selected: the
 * extension-inferred ones in {@link GENERIC_FILE_ADAPTERS} plus the
 * kind-selected ones above.
 *
 * This — not the narrower extension-derived set — is what gates the viewer's
 * `hasData` empty-state check (see `assignTrackData` in `load-data.ts`). What
 * that check cares about is provenance, not file type: an author-supplied
 * payload arrives as a bare array with no UniProt `.features` wrapper, so the
 * legacy raw-shape heuristic never sees it and a viewer built solely from such
 * tracks would parse correctly yet blank out.
 */
export const BYO_DATA_ADAPTERS: ReadonlySet<string> = new Set([
  ...GENERIC_FILE_ADAPTERS,
  ...KIND_SELECTED_BYO_DATA_ADAPTERS,
]);

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
