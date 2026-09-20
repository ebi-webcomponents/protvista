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
 * This table is consulted only for a track with no `kind:`. A kind-addressed
 * track resolves its adapter through the kind's own family — see
 * {@link KIND_ADAPTER_VARIANTS} — so a `kind:` and a file extension can never
 * name two different adapters and need no precedence rule between them.
 */

import type { KnownAdapterName, DataFormat } from './types.js';
import type { ShapeName } from './shapes.js';

export interface DataFileFormat {
  /** The lower-cased extension including the dot, e.g. `.csv`. */
  ext: string;
  /** The built-in adapter that parses this format. */
  adapter: KnownAdapterName;
  /** How the fetched response body must be read before the adapter runs. */
  body: 'text' | 'json';
}

/**
 * Formats — *how* a source's bytes are encoded. The other half of the pair
 * that replaces the `<shape>-<format>` adapter grid (see "Shape and format
 * (normative)" in `specs/config-approach.md`).
 *
 * A format says nothing about what the records mean. `bed` is the exception,
 * and declares it: the format carries feature semantics (0-based half-open,
 * converted on read), so it can only produce feature records. That is
 * expressed as `emitsShape` rather than special-cased, so GFF/GTF/VCF slot in
 * the same way later.
 *
 * `FormatDefinition` is shaped to become a registry entry for the reserved
 * `registerFormat()` extension point.
 */
export interface FormatDefinition {
  name: DataFormat;
  /** The file extension that implies this format, lower-case, dot-prefixed. */
  ext: string;
  /** How the body must be read before decoding. */
  body: 'text' | 'json';
  /**
   * Set when the format itself determines the records it can produce. A kind
   * whose shape differs is a config error naming both sides.
   */
  emitsShape?: ShapeName;
}

export const DATA_FORMATS: Readonly<Record<DataFormat, FormatDefinition>> = {
  csv: { name: 'csv', ext: '.csv', body: 'text' },
  tsv: { name: 'tsv', ext: '.tsv', body: 'text' },
  json: { name: 'json', ext: '.json', body: 'json' },
  bed: { name: 'bed', ext: '.bed', body: 'text', emitsShape: 'feature' },
};

export const DATA_FORMAT_NAMES = Object.keys(DATA_FORMATS) as DataFormat[];

export function isDataFormat(value: string): value is DataFormat {
  return Object.prototype.hasOwnProperty.call(DATA_FORMATS, value);
}

/** The format a path's extension implies, or `undefined`. */
export function formatForPath(value: string): FormatDefinition | undefined {
  const fmt = dataFileFormatForPath(value);
  return fmt === undefined ? undefined : DATA_FORMATS[extFormatName(fmt.ext)];
}

function extFormatName(ext: string): DataFormat {
  return (DATA_FORMAT_NAMES.find((n) => DATA_FORMATS[n].ext === ext) ??
    'json') as DataFormat;
}

/** Extension → format descriptor. Keys are lower-case, dot-prefixed. */
export const DATA_FILE_FORMATS: Record<string, DataFileFormat> = {
  '.csv': { ext: '.csv', adapter: 'features-csv', body: 'text' },
  '.tsv': { ext: '.tsv', adapter: 'features-tsv', body: 'text' },
  '.json': { ext: '.json', adapter: 'features-json', body: 'json' },
  '.bed': { ext: '.bed', adapter: 'bed', body: 'text' },
};

/**
 * Each semantic kind's adapter *family*: the kind's canonical adapter → the
 * sibling that parses each file format that kind also accepts.
 *
 * A `kind:` owns adapter selection end to end. Its canonical adapter is the
 * default — what an API URL or an inline payload is read with — and this
 * table names the sibling for each extension the kind can additionally read:
 *
 *   `kind: features`  + `./hits.csv`  → `features-csv`
 *   `kind: linegraph` + `./depth.csv` → `linegraph-csv`
 *   `kind: linegraph` + `./depth.json`→ no `.json` sibling → `linegraph`
 *
 * This is what removes the precedence question between `kind:` and the file
 * extension: on a kind-addressed track the extension chooses *within* the
 * kind's family, never away from it, so the two can't name conflicting
 * adapters. {@link DATA_FILE_FORMATS} then applies only where there is no
 * family to consult — a track with no `kind` at all.
 *
 * Every extension used as a key must have a {@link DATA_FILE_FORMATS} row —
 * that row is where the member's body type comes from, so a family member can
 * never disagree with the format it parses.
 */
/**
 * The file formats every kind that draws *feature intervals* accepts. One
 * object, shared by each such kind, because the question "what does a CSV
 * mean on this track" has one answer for all of them: the canonical feature
 * record (`type`, `start`, `end`, …) their component already renders.
 */
const FEATURE_FILE_FORMATS: Readonly<Record<string, KnownAdapterName>> = {
  '.csv': 'features-csv',
  '.tsv': 'features-tsv',
  '.json': 'features-json',
  '.bed': 'bed',
};

/** The same, for the kinds that draw a *series of points* on a line graph. */
const POINT_FILE_FORMATS: Readonly<Record<string, KnownAdapterName>> = {
  '.csv': 'linegraph-csv',
  '.tsv': 'linegraph-tsv',
  '.json': 'linegraph',
};

/** And for the kinds that draw *per-position residue changes*. */
const VARIATION_FILE_FORMATS: Readonly<Record<string, KnownAdapterName>> = {
  '.csv': 'variation-csv',
  '.tsv': 'variation-tsv',
  '.json': 'variation',
};

export const KIND_ADAPTER_VARIANTS: Record<
  string,
  Readonly<Record<string, KnownAdapterName>>
> = {
  // Every kind here reads a provider API response by default, and the same
  // records are just as often a file the author exported. Declaring the file
  // formats is what lets the kind keep its plain domain name honestly: the
  // name says what the track *is*, and it means the same thing whether the
  // records come from the provider or from you.
  //
  // A kind absent from this table has no bring-your-own-data path at all —
  // the AlphaFold / AlphaMissense kinds need two inputs and a secondary
  // fetch, which no single file can satisfy. Their names say so.
  'uniprot-features-json': FEATURE_FILE_FORMATS,
  'interpro-entries-json': FEATURE_FILE_FORMATS,
  'uniprot-proteomics-json': FEATURE_FILE_FORMATS,
  'uniprot-proteomics-ptm-json': FEATURE_FILE_FORMATS,
  'uniprot-proteins-pdb-json': FEATURE_FILE_FORMATS,
  'uniprot-variation-counts-json': POINT_FILE_FORMATS,
  'uniprot-rna-editing-counts-json': POINT_FILE_FORMATS,
  'uniprot-variation-json': VARIATION_FILE_FORMATS,
  'uniprot-rna-editing-json': VARIATION_FILE_FORMATS,
  linegraph: { '.csv': 'linegraph-csv', '.tsv': 'linegraph-tsv' },
};

/**
 * The adapter a kind uses for a given source: its family member for the
 * source's file format when it has one, otherwise its own canonical adapter.
 *
 * A hosted file and a local one resolve identically — `./hits.csv` and
 * `https://lab.example/hits.csv` are the same file with a different transport,
 * and the docs promise a track keeps working when you swap one for the other.
 * A *provider endpoint* whose URL happens to end in a known extension is the
 * one thing this misreads; pin `adapter:` there. That failure is loud (the
 * generic adapters shape-validate and throw a named error) where the inverse
 * default would be silent — a provider adapter handed an author's array reads
 * no records and draws an empty track.
 *
 * The single rule `expandDescriptor` and `validateConfig` share, so the
 * validator can never disagree with the resolver about what a config means.
 */
export function kindAdapterForFormat(
  kindAdapter: string,
  format: DataFileFormat | undefined
): string {
  if (format === undefined) return kindAdapter;
  return KIND_ADAPTER_VARIANTS[kindAdapter]?.[format.ext] ?? kindAdapter;
}

/**
 * The adapters whose response bodies must be fetched as raw text (rather
 * than parsed as JSON). Derived from {@link DATA_FILE_FORMATS} so the
 * table above stays the only thing a new format has to touch.
 */
export const TEXT_BODY_ADAPTERS: ReadonlySet<string> = new Set([
  ...Object.values(DATA_FILE_FORMATS)
    .filter((f) => f.body === 'text')
    .map((f) => f.adapter),
  // Every kind's family members parse the very same bodies, so they take
  // their body type from the extension's row above rather than declaring one
  // of their own.
  ...Object.values(KIND_ADAPTER_VARIANTS).flatMap((byExt) =>
    Object.entries(byExt)
      .filter(([ext]) => DATA_FILE_FORMATS[ext]?.body === 'text')
      .map(([, adapter]) => adapter)
  ),
]);

/**
 * The bring-your-own-data adapters whose output is a *wrapper* around the
 * author's records rather than the records themselves — `linegraph` builds
 * `[{ name, color, range, values }]`, `variation` builds `{ variants }`.
 *
 * This is the property that decides whether authored records need adapting at
 * all. For the feature family the record contract and the renderer's
 * representation are the same bare array, so running `features-json` over an
 * inline list would only subtract: it keeps exactly `type`/`start`/`end`/
 * `description`/`score` and drops every other field, including ones a
 * `dataTooltip` template may reference by path. For the wrapping families the
 * opposite holds — hand the component raw records and it reads `d.range` or
 * `.variants` off them, finds nothing, and either throws or draws nothing.
 *
 * Pinned by `load-data-authored-records.spec.ts`, which runs each BYO JSON
 * adapter over a record array and asserts membership here matches whether the
 * output actually wrapped. Under the shape/format split this becomes a
 * declared property of a shape rather than a list of adapter names.
 */
export const WRAPPING_RECORD_ADAPTERS: ReadonlySet<string> = new Set<string>([
  'linegraph',
  'variation',
]);

/**
 * The adapter that consumes the *author-facing record contract* for a kind —
 * what `from: inline` and `setTrackData()` payloads are written against — or
 * `undefined` when the kind has no such contract (a provider-only kind) or
 * when its records need no adapting (the feature family, above).
 *
 * Derived from the same family table that resolves file sources, so the
 * records an author writes inline are the records they could equally have put
 * in a `.json` file.
 */
export function recordAdapterForKind(
  kindAdapter: string | undefined
): string | undefined {
  if (kindAdapter === undefined) return undefined;
  const candidate = BYO_KIND_BASE_ADAPTERS.includes(
    kindAdapter as KnownAdapterName
  )
    ? kindAdapter
    : KIND_ADAPTER_VARIANTS[kindAdapter]?.['.json'];
  return candidate !== undefined && WRAPPING_RECORD_ADAPTERS.has(candidate)
    ? candidate
    : undefined;
}

/**
 * How a fetched body must be read for `adapter` when nothing more specific is
 * known: raw text for the delimited parsers, JSON for everything else.
 * Mirrors the `wantsText` decision in `load-data.ts`.
 */
export function adapterBodyType(adapter: string): 'text' | 'json' {
  return TEXT_BODY_ADAPTERS.has(adapter) ? 'text' : 'json';
}

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
 * The canonical adapter of each kind whose payload the *author* supplies
 * rather than a provider API (`kind: linegraph`). Unlike the domain kinds,
 * these consume a shape documented for authors to produce, and no file
 * extension names them on its own: `.json` on a track with no `kind` still
 * means `features-json`.
 *
 * Membership drives two author-facing behaviours — the viewer's `hasData`
 * empty-state gate (`protvista-uniprot.ts`) and running the adapter on
 * `from: inline` payloads (`load-data.ts`). It no longer affects adapter
 * resolution: every kind owns its own family, so there is nothing to outrank.
 */
export const BYO_KIND_BASE_ADAPTERS: readonly KnownAdapterName[] = [
  'linegraph',
];

/**
 * {@link BYO_KIND_BASE_ADAPTERS} together with every member of their families
 * (`linegraph` → also `linegraph-csv` / `linegraph-tsv`) — derived, so a base
 * and its delimited siblings can't drift apart.
 */
export const KIND_SELECTED_BYO_DATA_ADAPTERS: ReadonlySet<string> =
  new Set<string>([
    ...BYO_KIND_BASE_ADAPTERS,
    ...BYO_KIND_BASE_ADAPTERS.flatMap((base) =>
      Object.values(KIND_ADAPTER_VARIANTS[base] ?? {})
    ),
  ]);

/**
 * Every bring-your-own-data adapter, however it was selected: the
 * extension-inferred ones in {@link GENERIC_FILE_ADAPTERS}, the kind-selected
 * ones above, and every member of every kind's family — each of those parses
 * a file the author wrote, whichever kind reached it.
 *
 * This — not the narrower extension-derived set — is what gates the viewer's
 * `hasData` empty-state check (see `assignTrackData` in `load-data.ts`). What
 * that check cares about is provenance, not file type: an author-supplied
 * payload arrives with no UniProt `.features` wrapper, so the legacy
 * raw-shape heuristic never sees it and a viewer built solely from such
 * tracks would parse correctly yet blank out.
 *
 * Derived from the family table so adding a family can't leave a new adapter
 * out of the gate — the failure that would cause (a correctly parsed viewer
 * showing its empty state) gives no clue where to look.
 */
export const BYO_DATA_ADAPTERS: ReadonlySet<string> = new Set([
  ...GENERIC_FILE_ADAPTERS,
  ...KIND_SELECTED_BYO_DATA_ADAPTERS,
  ...Object.values(KIND_ADAPTER_VARIANTS).flatMap((byExt) =>
    Object.values(byExt)
  ),
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
