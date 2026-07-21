# Generic-format adapters — design

Design for the four generic-format data adapters that let authors point a
ProtVista track at a CSV / TSV / JSON / BED file without writing
JavaScript. Not currently implemented; the schema, types, and inference
plumbing have all been deliberately left out of v1 so the library
doesn't promise authoring surfaces it can't honour. When built, this
doc is the implementation brief.

The four adapters under design:

- **`features-csv`** — CSV with a header row (`type,start,end,description[,score]`).
- **`features-tsv`** — TSV with the same column convention.
- **`features-json`** — JSON array of feature-shaped records, already in the expected payload shape.
- **`bed`** — standard BED (tab-separated, `chrom`/`start`/`end`/`name`/`score`/`strand` optional after BED3).

All four produce the same output shape (an array of feature-shaped
records the library's existing `nightingale-track-canvas` consumes
without per-track glue), differing only in *how* they parse the input.

---

## 1. Scope

What the feature adds:

- Four named adapter functions on the runtime registry: `features-csv`,
  `features-tsv`, `features-json`, `bed`. Each parses raw text from
  `from: file` or `from: url` and emits an array of
  `{ type, start, end, description?, score? }` records.
- A `registerBuiltinAdapters(registry)` helper that seeds these four
  alongside the existing UniProt-API adapters, so they are
  pre-registered on every fresh registry.
- `KnownAdapterName` union additions in `src/schema/types.ts`:
  `features-csv` | `features-tsv` | `features-json` | `bed`.
- File-extension shorthand resolution in `src/schema/normalize.ts`:
  `.csv → features-csv`, `.tsv → features-tsv`, `.json → features-json`,
  `.bed → bed` — applied when an author writes `data: ./hits.csv` and
  doesn't pin an `adapter:` explicitly.
- A `cannot-infer-adapter` validation issue code (in
  `src/schema/errors.ts`) for the case where the shorthand lands on an
  unknown extension. Helper functions `hasKnownExtension` and
  `extensionOf` in `src/schema/validate.ts` to back the check.
- The matching extension-shorthand bullets in the spec's
  `TrackConfig.data` JSDoc.

What stays out of scope:

- **Tabular data with arbitrary header schemas.** The four built-ins
  expect specific column conventions; an author with their own column
  layout writes a one-file custom adapter via `registerAdapter()` and
  declares it explicitly with `adapter: my-feed`. The four built-ins
  are not a generic CSV-parsing library.
- **Format auto-detection.** No content-sniffing; the file extension
  is the discriminator. A `.tsv`-named CSV file is treated as TSV;
  authors with a misnamed file must rename it or pin `adapter:`
  explicitly.
- **Streaming or chunked parsing.** All four read the whole response
  body in one pass. A 100 MB BED file is a known antipattern — adopters
  shipping that should write a streaming adapter.
- **Validation of the adapter's output shape.** The library trusts the
  parser; downstream `nightingale-track-canvas` will silently skip
  malformed rows. Per-row validation lives in the parser itself (with
  diagnostic `console.warn`s, not exceptions).

---

## 2. Motivation

The library ships eleven UniProt-API-specific adapters (`uniprot-features-json`,
`uniprot-variation-json`, `interpro-entries-json`, `alphafold-prediction-json`,
the AlphaMissense pair, etc.). These cover the EBI website's needs.

The generic-format adapters cover the second audience the spec
explicitly names: bench scientists and external labs with their own
data, hosting a CSV / TSV / JSON / BED file alongside their HTML page
or behind their own URL. The Quick-look example in the spec promises:

```yaml
extends: '<published-uniprot-default-config-url>'
rows:
  - id: MY_LAB
    label: My lab
    tracks:
      - id: hotspots
        kind: features
        data: ./hotspots.csv
```

Until these four adapters ship, that promise is the spec's most
visible misdirection: the YAML parses, the schema validates, but the
load fails because no `features-csv` is registered. Shipping the four
adapters closes that gap and unlocks the BYO-data authoring path the
spec was designed around.

---

## 3. Schema additions

### 3.1 TypeScript types (`src/schema/types.ts`)

`KnownAdapterName` gets four new entries (last four; the existing
UniProt-API entries are unchanged):

```ts
export type KnownAdapterName =
  // ── Source-specific (coupled to a particular API output) ──
  | 'uniprot-features-json'
  | 'uniprot-variation-json'
  | 'uniprot-variation-counts-json'
  | 'uniprot-proteomics-json'
  | 'uniprot-proteomics-ptm-json'
  | 'uniprot-rna-editing-json'
  | 'uniprot-rna-editing-counts-json'
  | 'uniprot-proteins-pdb-json'
  | 'interpro-entries-json'
  | 'alphafold-prediction-json'
  | 'alphamissense-average-csv'
  | 'alphamissense-full-csv'
  // ── Generic format adapters (bring your own data) ─────────
  /** Array of feature objects already in expected shape. */
  | 'features-json'
  /** CSV with columns: `type,start,end,description[,score]`. */
  | 'features-csv'
  /** TSV (tab-separated) with the same columns as `features-csv`. */
  | 'features-tsv'
  /** Standard BED (tab-separated). */
  | 'bed';
```

The `TrackConfig.data` JSDoc gains the four extension-shorthand bullets
in its resolution-order list:

```ts
/**
 * …existing prose…
 *
 * Shorthand resolution order:
 *
 *   - matches a key in root `sources`  → { from: url,  source: <value> }
 *   - starts with http:// or https://  → { from: url,  url: <value> }
 *   - starts with / or ./              → { from: file, url: <value> }
 *   - ends with .csv                   → { from: file, adapter: features-csv }
 *   - ends with .tsv                   → { from: file, adapter: features-tsv }
 *   - ends with .json                  → { from: file, adapter: features-json }
 *   - ends with .bed                   → { from: file, adapter: bed }
 */
data: string | DataSourceDescriptor | DataSourceDescriptor[];
```

### 3.2 JSON Schema (`src/schema/schema.json`)

`KnownAdapterName` is an open string union (`type: string, minLength: 1`)
in the schema today; no shape change is required there. The
descriptive prose on the `data` field can grow to mention the
extension shorthands but that's optional cosmetic work.

---

## 4. Runtime implementation

### 4.1 File layout

```
src/schema/
  adapters/
    features-json.ts            ← new (≈30 lines)
    features-csv.ts             ← new (≈80 lines incl. parser core)
    features-tsv.ts             ← new (re-exports csv parser with delimiter)
    bed.ts                      ← new (≈100 lines for BED3..BED6)
  registry.ts                   ← gains registerBuiltinAdapters(registry)
  normalize.ts                  ← regains inferAdapterFromExtension
  validate.ts                   ← regains hasKnownExtension / extensionOf,
                                  the cannot-infer-adapter check
  errors.ts                     ← regains 'cannot-infer-adapter' code
  __spec__/
    adapters/
      features-json.spec.ts
      features-csv.spec.ts
      features-tsv.spec.ts
      bed.spec.ts
    normalize.spec.ts           ← extension-inference cases re-added
    validate.spec.ts            ← cannot-infer-adapter cases re-added
```

### 4.2 Adapter contract

Each of the four adapters has the same outer signature — identical to
the existing UniProt-API adapters:

```ts
type AdapterFunction = (
  ...rawResponses: unknown[]
) => unknown | Promise<unknown>;
```

For these four, `rawResponses[0]` is the unparsed text of the file
(or, for `features-json`, the parsed JSON value). Output is an array
of feature-shaped records:

```ts
interface FeatureRecord {
  /** Required. Becomes the track's filterable "type" tag. */
  type: string;
  /** Required. 1-indexed inclusive start position. */
  start: number;
  /** Required. 1-indexed inclusive end position. */
  end: number;
  /** Optional. Per-feature label / hover description. */
  description?: string;
  /** Optional. 0-1 numeric quality / confidence. */
  score?: number;
}
```

The `nightingale-track-canvas` component reads exactly these fields
(plus `tooltipContent`, which the resolver usually writes unless an
adapter supplied a non-empty value). Adapters that produce additional
fields are fine — they pass through to the tooltip resolver and are
addressable from `dataTooltip` `path` values.

### 4.3 `features-json` (`src/schema/adapters/features-json.ts`) — shipped

The simplest of the four: the fetch already produced parsed JSON, so
there is no tokenizer — just structural validation. As shipped (issue
#189) it follows the same **strict, throw-with-index** convention as
`features-csv` / `features-tsv` rather than the lenient filter-and-warn
originally sketched here:

- A body that is not an array → `console.warn` + return `[]` (the
  defensive wrong-container guard, mirroring the delimited adapters'
  non-string guard).
- Each element is validated and pared down to the canonical
  `FeatureRecord` shape. The start coordinate is read from `start` **or**
  `begin` (UniProt convention) and normalised to `start`; `start` wins
  when both are present. `description` / `score` are optional.
- Any malformed record **throws** an `Error` naming the 0-based array
  index and the field, e.g.
  `features-json: record 2, field "start": expected a number, got "abc"`.
  Coordinates and score must be genuine finite JSON numbers — a string
  coordinate (`"10"`) is a type error and is rejected, not coerced. The
  loader's per-track try/catch turns the throw into an empty track plus a
  console warning, so one bad file never crashes the viewer.

```ts
import type { AdapterFunction } from '../types';
import type { FeatureRecord } from './dsv';

export const featuresJson: AdapterFunction = (raw) => {
  if (!Array.isArray(raw)) {
    console.warn(
      '[protvista] features-json adapter: expected an array; got ' +
        typeof raw +
        '. Treating as empty.'
    );
    return [];
  }
  const records: FeatureRecord[] = [];
  raw.forEach((item, i) => {
    // …validate item; throw `features-json: record ${i}, field "…": …`
    // on any violation; push a clean { type, start, end, description?,
    // score? } record. See the source for the full checks.
  });
  return records;
};
```

### 4.4 `features-csv` (`src/schema/adapters/features-csv.ts`)

Built on the existing in-tree `d3-dsv` dependency (no new dep —
`d3-dsv` ships with the AlphaMissense parsers already). Header row
required: `type,start,end,description[,score]`. Quoted values
supported per RFC 4180.

```ts
import { csvParse } from 'd3-dsv';
import type { AdapterFunction } from '../types';

export const featuresCsv: AdapterFunction = (raw) => {
  if (typeof raw !== 'string') {
    console.warn(
      '[protvista] features-csv adapter: expected text body; got ' +
        typeof raw +
        '. Treating as empty.'
    );
    return [];
  }
  const rows = csvParse(raw);
  return rows
    .map((row, i) => {
      const start = Number(row.start);
      const end = Number(row.end);
      if (!row.type || !Number.isFinite(start) || !Number.isFinite(end)) {
        console.warn(
          `[protvista] features-csv: row ${i + 1} skipped — ` +
            `missing or malformed type/start/end.`
        );
        return null;
      }
      return {
        type: String(row.type),
        start,
        end,
        ...(row.description ? { description: row.description } : {}),
        ...(Number.isFinite(Number(row.score))
          ? { score: Number(row.score) }
          : {}),
      };
    })
    .filter((r): r is FeatureRecord => r !== null);
};
```

### 4.5 `features-tsv` (`src/schema/adapters/features-tsv.ts`)

Same logic, swapping `csvParse` for `tsvParse`. Implementation is a
two-line re-export of the CSV core with a different delimiter — most
simply by extracting a shared `parseDelimited(raw, parser)` helper and
exporting `featuresCsv` / `featuresTsv` from the same module.

### 4.6 `bed` (`src/schema/adapters/bed.ts`)

> **Implemented** — the shipped adapter diverges from the illustrative
> sample below on two points, decided during implementation:
> 1. **Malformed lines throw** (fewer than 3 columns, or a non-numeric
>    coordinate/score) with a descriptive, line-named error — matching the
>    strict `features-csv` / `features-tsv` siblings — rather than the
>    warn-and-skip shown here. Blank lines and `track`/`browser`/`#`
>    comment lines are still skipped silently (they are legal BED, not
>    malformed).
> 2. **`score` is passed through verbatim** (no 0–1000 → 0–1 renormalise).
>    The BED spec nominally defines score as 0–1000, but real-world files
>    routinely carry out-of-range values (peak-caller `-10log10(q)`,
>    p-values, signal) and the standard tooling (`bedtools`, `pybedtools`)
>    preserves the column unchanged, so dividing by 1000 would silently
>    corrupt those files.
> 3. **Coordinate edge cases are handled**, which the naive `start = n+1,
>    end = m` shift is not: a zero-length feature (`chromStart == chromEnd`,
>    a legal insertion point) becomes a single-base point (`start == end`)
>    instead of an inverted range, and a genuinely inverted
>    `chromEnd < chromStart` line throws the standard malformed-row error.
>
> The code block below is retained as design context; `src/schema/adapters/bed.ts`
> is the source of truth.

Standard BED parser. BED is tab-delimited but **headerless** — columns
are positional. Spec: <https://samtools.github.io/hts-specs/BEDv1.pdf>.

Minimum: BED3 (`chrom`, `chromStart`, `chromEnd`).
Recommended: BED6 (`name`, `score`, `strand` follow).

ProtVista is single-sequence, so `chrom` is informational only. Map
fields:

| BED column | ProtVista output |
| --- | --- |
| `chromStart` | `start` (note: BED is 0-indexed half-open, ProtVista is 1-indexed inclusive — adapter shifts) |
| `chromEnd` | `end` (same shift) |
| `name` | `description` |
| `score` | `score` (passed through verbatim — see the note above) |
| `chrom`, `strand`, the rest | dropped |

The `type` field doesn't exist in BED. Synthesise it: every record
gets `type: 'BED'` so the track's `filter:` shortcut still works
predictably (`filter: BED` shows everything). Authors who need
finer-grained typing pin a custom adapter.

```ts
import type { AdapterFunction } from '../types';

interface FeatureRecord {
  type: string;
  start: number;
  end: number;
  description?: string;
  score?: number;
}

export const bed: AdapterFunction = (raw) => {
  if (typeof raw !== 'string') {
    console.warn(
      '[protvista] bed adapter: expected text body; got ' +
        typeof raw +
        '. Treating as empty.'
    );
    return [];
  }
  const out: FeatureRecord[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip blank lines, comments, and the optional `track`/`browser`
    // header lines per the BED spec.
    if (!line.trim()) continue;
    if (/^(?:track|browser|#)/i.test(line)) continue;
    const cols = line.split('\t');
    if (cols.length < 3) {
      console.warn(`[protvista] bed: line ${i + 1} skipped — fewer than 3 columns.`);
      continue;
    }
    const start0 = Number(cols[1]);
    const end0 = Number(cols[2]);
    if (!Number.isFinite(start0) || !Number.isFinite(end0)) {
      console.warn(`[protvista] bed: line ${i + 1} skipped — non-numeric coords.`);
      continue;
    }
    const rec: FeatureRecord = {
      type: 'BED',
      // BED is 0-indexed half-open; ProtVista is 1-indexed inclusive.
      start: start0 + 1,
      end: end0,
    };
    if (cols.length >= 4 && cols[3]) rec.description = cols[3];
    if (cols.length >= 5) {
      const s = Number(cols[4]);
      if (Number.isFinite(s)) rec.score = s / 1000; // BED 0-1000 → 0-1.
    }
    out.push(rec);
  }
  return out;
};
```

### 4.7 Registry wiring (`src/schema/registry.ts`)

**Already implemented** (issue #188) — this section is retained for
context; no registry work is left for the adapter tickets.

`registerBuiltinAdapters(registry)` lives alongside the `createRegistry()`
factory and walks a `BUILTIN_ADAPTERS` table in `src/schema/adapters/`:

```ts
export function registerBuiltinAdapters(registry: Registry): void {
  for (const [name, fn] of BUILTIN_ADAPTERS) {
    registry.registerAdapter(name, fn);
  }
}
```

`createRegistry()` calls it once at construction, so the built-ins are
present on every registry before any config loads — not at element
`_init()` as originally sketched here. Each adapter ticket therefore
adds its module plus **one line** to `BUILTIN_ADAPTERS`:

```ts
export const BUILTIN_ADAPTERS: ReadonlyArray<
  readonly [KnownAdapterName, AdapterFunction]
> = [
  ['features-json', featuresJson],  // ← one line per ticket
];
```

Precedence: built-ins register first through the same public
`registerAdapter()` path consumers use, and a consumer registering the
same name later overrides the built-in (once). So an adopter whose CSV
has a different column layout can replace `features-csv` with their own.

### 4.8 Normalizer (`src/schema/normalize.ts`)

Re-add the extension-inference helper and call sites. Original code
to bring back:

```ts
function inferAdapterFromExtension(path: string): AdapterName | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith('.csv')) return 'features-csv';
  if (lower.endsWith('.tsv')) return 'features-tsv';
  if (lower.endsWith('.json')) return 'features-json';
  if (lower.endsWith('.bed')) return 'bed';
  return undefined;
}
```

Three call sites in `expandData` / `expandDescriptor`:

1. The `./*.csv`-style file-path shorthand: `inferAdapterFromExtension(value)` → use the result if defined; fall back to `{ from: 'file', url: value }` with no adapter otherwise.
2. The bare-filename shorthand (no leading `./`): same pattern.
3. The descriptor with `url:` set but no `adapter:`: extension-infer
   from the URL.

### 4.9 Validator (`src/schema/validate.ts`)

Re-add `KNOWN_EXTENSIONS`, `hasKnownExtension`, `extensionOf`, and the
`cannot-infer-adapter` issue branch in `checkStringShorthand`:

```ts
const KNOWN_EXTENSIONS: readonly string[] = ['.csv', '.tsv', '.json', '.bed'];

function hasKnownExtension(value: string): boolean {
  const lower = value.toLowerCase();
  return KNOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function extensionOf(value: string): string | undefined {
  const idx = value.lastIndexOf('.');
  return idx === -1 ? undefined : value.slice(idx);
}

// In checkStringShorthand, when the value is an absolute or relative
// path that doesn't have a known extension:
if (value.startsWith('/') || value.startsWith('./')) {
  if (!hasKnownExtension(value)) {
    issues.push({
      path: trackPath,
      message:
        `Cannot infer adapter for '${value}' in track ${trackPath}. ` +
        `Use an object form with explicit 'adapter:' or register a handler ` +
        `for '${extensionOf(value) ?? 'this extension'}'.`,
      code: 'cannot-infer-adapter',
    });
  }
  return;
}
```

### 4.10 Errors (`src/schema/errors.ts`)

Re-add the issue code:

```ts
export type ValidationIssueCode =
  | 'schema'
  | 'unknown-source-key'
  | 'unknown-adapter'
  | 'unknown-semantic-kind'
  | 'unknown-component'
  | 'unknown-theme'
  | 'cannot-infer-adapter'   // ← back
  | 'missing-inline-data'
  // …
```

---

## 5. Tests

Five test files. The first four are new per-adapter parsing tests.
The fifth re-adds extension-inference cases that the strip removed.

### 5.1 `src/schema/__spec__/adapters/features-json.spec.ts`

- Happy path: an array of `{ type, start, end, description, score }` records passes through unchanged.
- Non-array input → `console.warn` + empty array.
- Rows missing `type` / `start` / `end` are filtered out (one `console.warn` per offending row).
- Extra fields on a row (e.g. `score`, `xrefs`) pass through to enable richer `dataTooltip` paths.

### 5.2 `src/schema/__spec__/adapters/features-csv.spec.ts`

- Happy path: a CSV with header `type,start,end,description,score` parses into the expected records.
- Quoted values containing commas (RFC 4180): `"Glu, Lys"` survives intact.
- Missing-required-field row → skip + `console.warn` with line number.
- Empty body → empty array, no warning.
- BOM at the start of the file: stripped (use `csvParse`'s built-in handling).

### 5.3 `src/schema/__spec__/adapters/features-tsv.spec.ts`

Same fixtures as CSV, with tabs as the delimiter. Confirms shared
parser core and the delimiter switch.

### 5.4 `src/schema/__spec__/bed.spec.ts`

(Lives in the flat `__spec__/` directory alongside `features-dsv.spec.ts`,
not a nested `__spec__/adapters/`.)

- BED3, BED4 (`name`), BED5 (`name`, `score`), BED6 (with `strand` — dropped).
- Coordinate shift: BED 0-indexed half-open → ProtVista 1-indexed inclusive. Pin both edges with explicit fixtures (`100 200` → `start: 101, end: 200`; `0` start → `1`).
- Zero-length feature (`chromStart == chromEnd`, a legal insertion point) → single-base point `start == end` (not an inverted range); a genuinely inverted `chromEnd < chromStart` line throws a line-named error.
- Score passed through verbatim: a BED `500` stays `500`.
- Skip lines: `track …`, `browser …`, `# comment`, blank lines.
- Sub-3-column rows throw a line-named error.
- Non-numeric coords / score throw a line-named error.

### 5.5 Re-add to existing files

- `src/schema/__spec__/normalize.spec.ts`: every test case that exercises `data: 'hits.csv'`, `data: 'hits.tsv'`, `data: 'hits.json'`, `data: 'hits.bed'` shorthand — both the bare-filename and `./` forms. Confirm the resolved `NormalizedDataSource` carries `from: file` + the right `adapter:`.
- `src/schema/__spec__/validate.spec.ts`: the `cannot-infer-adapter` issue case with `data: './x.gff'`. The accepts-a-known-extension counter-test (`./hits.csv` does not produce the error).
- `src/schema/__spec__/types.spec.ts`: the `features-tsv` BYO-data shorthand type-check (`data: './hotspots.tsv'` infers `features-tsv` end to end).

---

## 6. Spec updates (rolling back into `specs/config-approach.md`)

The strip pulled the following passages. Restore them on land:

- **Quick-look example** — return `data: ./hotspots.csv` to the YAML in §"Quick look", since that path now works.
- **Example 4 ("Extending the EBI default — one line, one new track")** — return `data: ./hotspots.csv`. The narrative paragraph below ("At load time the loader fetch()-es the URL in extends…") regains its mention of CSV/TSV/JSON/BED file paths.
- **Edge Cases & Error Handling table** — return the rows:
  - `data` string shorthand has an extension the resolver does not recognise (e.g. `./x.gff`) → Config validation fails: `Cannot infer adapter for './x.gff' in track <groupId>/<trackId>. Use an object form with explicit 'adapter:'.`
- **Acceptance Criteria** — return:
  - "Generic-format adapters `features-json` / `features-csv` / `features-tsv` / `bed` are pre-registered on every fresh registry. A track that points at `./x.csv` (or `https://example.org/x.csv`) loads end to end without consumer-side adapter registration."
  - "File-extension shorthand (`./hits.csv` → `features-csv`, etc.) maps to the matching pre-registered adapter."
- **README's API / Configuration section** — restore the BYO-CSV example mentions.

---

## 7. Implementation plan

One PR.

1. Create `src/schema/adapters/features-json.ts`, `features-csv.ts`, `features-tsv.ts`, `bed.ts` with the parsers in §4.3–§4.6.
2. ~~Add `registerBuiltinAdapters(registry)` to `src/schema/registry.ts`~~ — **done in issue #188**; it exists and `createRegistry()` calls it. Each adapter only adds one line to `BUILTIN_ADAPTERS` in `src/schema/adapters/index.ts`.
3. Restore the four `KnownAdapterName` entries in `src/schema/types.ts` (under the existing `Generic format adapters` comment block).
4. Restore `inferAdapterFromExtension` and its three call sites in `src/schema/normalize.ts`.
5. Restore `KNOWN_EXTENSIONS`, `hasKnownExtension`, `extensionOf`, and the `cannot-infer-adapter` branch in `src/schema/validate.ts`.
6. Restore `'cannot-infer-adapter'` in the `ValidationIssueCode` union in `src/schema/errors.ts`.
7. Restore the file-extension shorthand bullets in the `TrackConfig.data` JSDoc in `src/schema/types.ts`.
8. Write the four new adapter spec files (§5.1–§5.4). Each adapter has happy path + at least one malformed-input case.
9. Re-add the extension-inference test cases in `normalize.spec.ts`, `validate.spec.ts`, and `types.spec.ts` (§5.5).
10. Restore the spec passages in `specs/config-approach.md` (§6 above).
11. Restore the BYO-CSV example mentions in `README.md`.
12. Remove the planning comment in `src/schema/registry.ts` that points at this spec file (if added).
13. Run `tsc`, `eslint`, `vitest` to green. Update `load-data-baseline.spec.ts.snap` if the registry mock changes shape.

### Acceptance checklist

- [ ] An author writes `data: ./hotspots.csv` in YAML and the file loads end to end against the local origin without consumer-side adapter registration.
- [ ] Same for `.tsv`, `.json`, `.bed`.
- [ ] `data: ./x.gff` (unknown extension) fails validation with the `cannot-infer-adapter` issue and the spec-worded message.
- [ ] BED records have correctly-shifted 1-indexed inclusive coordinates (BED `100\t200` → `start: 101, end: 200`).
- [ ] Quoted CSV values containing commas survive the parse intact.
- [ ] Each adapter emits exactly one `console.warn` per malformed row, not per render pass.
- [ ] The Quick-look YAML and Example 4 in `specs/config-approach.md` round-trip through validate → normalize → load against a real `./hotspots.csv` fixture.
- [ ] No new runtime dependency: `d3-dsv` is already in the tree (used by the AlphaMissense parsers); BED uses native string ops.

---

## 8. Notes on the design

- **The four adapters are deliberately rigid.** Authors with their own column layouts write a custom adapter and pin it explicitly with `adapter: my-feed`. The four built-ins exist for the "I have a CSV in the canonical shape" case — anything more is custom-adapter territory.
- **Coordinate model.** ProtVista is 1-indexed inclusive throughout. CSV/TSV/JSON inputs are assumed to follow the same convention (the columns are named `start` / `end`, the assumption is documented). BED is 0-indexed half-open per spec; the adapter shifts so the user sees consistent 1-indexed inclusive coordinates everywhere.
- **No content sniffing.** The file extension is the discriminator. If we content-sniffed (`looks like JSON, treat as JSON`), authors with mismatched extensions would get unpredictable behaviour. Failing loud on extension is more debuggable.
- **`d3-dsv` choice over `papaparse`.** `d3-dsv` is already in the tree (the AlphaMissense parsers use it); adding `papaparse` would be a net new dep for marginal API ergonomics gain.
- **The `type: 'BED'` synthesis.** BED has no `type` column, so we synthesise one. Alternatives considered: leave `type` undefined (breaks the `filter:` shortcut); copy `name` into `type` (loses the "filter by feature category" UX); use `chrom` (always one value for ProtVista, useless as a filter axis). Synthesised constant `'BED'` is the least-surprising default.
