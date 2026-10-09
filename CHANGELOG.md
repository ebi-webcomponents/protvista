# Changelog

## Unreleased

- Added `uniprot-isoforms-json` adapter and "APP isoforms" community view. The adapter is opt-in and makes no new requests unless named in a config.

### Fixed: `rendering.height` and `rendering.layout` take effect

The config schema accepted `rendering.height` and `rendering.layout`, but the
viewer ignored both: every track kept a fixed height, and feature tracks always
stacked overlapping features in rows. `height` now sets a track's height in
pixels on every built-in track; set on a group, it also sizes the group's
collapsed row. `layout: default` draws a feature track's overlapping features
on one row. Configs that leave these fields out look the same as before; a
config that already set them will now render the way it asked to.

### Added: a warning for rendering settings that have no effect

Some `rendering` settings only work on certain tracks: `colorScale` on coloured
sequence tracks (`alphafold-confidence`, `alphamissense-pathogenicity`), and
`layout`, `color` and `shape` on feature tracks. Setting one where it can't
take effect now gives a `rendering-field-ignored` validation warning instead of
being silently ignored. The config still loads. The Configure page's
`rendering` section lists each field, where it works, and the order in which a
track, its kind, its group and `defaults:` take precedence.

### Added: an "Edit page" link on every docs page

Each page of the documentation site now links to its source on GitHub's `next`
branch, so a reader who spots a mistake can propose a fix in a couple of
clicks. The adapter reference and the feature type and shape vocabulary pages
have no link, because they are generated from code.

## 5.0.0-beta.5 — 2026-10-06

### Fixed: the 3D structure viewer works when loaded from a CDN

Loaded straight from jsDelivr, as the Starter Kit and any plain
`<script type="module">` page do, the structure panel failed with
"process is not defined" and showed no 3D view. A library inside Mol* read
`process.env.NODE_ENV`, which only a bundler provides; the build now
replaces it. Pages that bundle ProtVista themselves were not affected.

## 5.0.0-beta.4 — 2026-10-06

### Fixed: contributing from Windows, and docs that disagreed with the code

Cloning and testing ProtVista on Windows now works the same as on macOS and
Linux. Every text file checks out with LF line endings whatever Git's
`core.autocrlf` says, `package.json` scripts run in pnpm's POSIX-style shell
instead of `cmd.exe`, and `pnpm test` no longer fails on Windows at the lint
step or in specs that assumed `/` path separators. A Windows CI job now checks
lint, types and unit tests on every pull request.

The Starter Kit no longer says it "does not work yet", and gives Windows users
commands that work in Command Prompt. CONTRIBUTING.md now explains how to
contribute through a fork (fork with `next`, and open pull requests against
`next`, not the default `main`) and has notes for hackathon participants and
Windows users.

The docs now say that a CSV or TSV feature file needs a `description` column
(cells may be empty). The custom-adapter example on Escape hatches now works:
a custom adapter is handed the response parsed as JSON, never as text. The
page also documents `setTrackData()` and the current limit on
`registerComponent`.

### Changed: the ⚠ error badge opens a note, like the ⓘ

A track or group's red `⚠` badge is now a button that behaves like the
visitor ⓘ: it has the same hover, and selecting it opens a note, titled with
the track or group, with the same text as before: what failed and, for your
own file, how to fix it. Before, that text was only in a hover tooltip, which
touch screens never show. Escape, a click elsewhere or moving focus closes the
note. Screen readers still hear the error when the badge is focused. Retry is
unchanged, and stays on the same line as its badge.

Every note — ⓘ, ⚠ and author mode — shows a single message as plain text and
uses a bulleted list only for two or more.

Inside a group's label, Enter on a link, or Enter or Space on a badge or
Retry, now activates that control instead of collapsing the group.

### Added: tell visitors when the view is incomplete

A warning that changes what is on screen now tells the person looking at the
viewer, not only the console and the `protvista-error` event. Features that
fall outside the sequence, colours in the data the canvas cannot paint, a
track whose data URL has an undefined `{variable}` (so its data never loads),
and a component with no renderer each put a quiet ⓘ on the track's label, or
beside **Customize** for a viewer-level note or a track whose label isn't on
screen (a collapsed group, an empty track). It opens one plain-language line
— "2 features extend beyond this sequence, so they aren't shown in full." —
and the notes are announced once to screen readers. Warnings that change
nothing a visitor sees (an ignored column, a tooltip field no record has, a
`theme:` colour that didn't resolve) stay off it. The `quiet-notices`
attribute turns the notices off; the event is unchanged. The routing table in
[Where a failure shows up](https://ebi-webcomponents.github.io/protvista/troubleshooting#where-a-failure-shows-up)
gains Code, Visitor notice and Author mode columns. See
[What visitors and authors see](https://ebi-webcomponents.github.io/protvista/troubleshooting#what-visitors-and-authors-see).

### Added: author mode (`show-warnings` / `showWarnings`)

The `show-warnings` attribute, or `showWarnings: true` in the config, lists
every warning on its track or beside Customize, with the text the console and
the playground show (file, row and field), its phase, code and source, and
what visitors see for it. Error badges become buttons that list their full
text, an error on a track inside a collapsed group is listed beside
Customize, and the alert panel adds the console's text under its summary.
Off by default; with it off, errors look exactly as before. Both attributes
take effect on a live element with no reload, and the JSX types in
`protvista-uniprot/react` declare both.

### Changed: a tooltip whose fields are all missing shows the default tooltip

A record that has none of the fields an authored `dataTooltip` names, and for
which the template renders no letter or digit (only the `·` of
`{% $gene %} · {% link href=$url /%}`, or nothing), now shows the track's
default tooltip instead: its kind's built-in one, or the automatic tooltip,
as with no `dataTooltip`. Before, such a record showed a tooltip with only
punctuation in it, or, in the `fields` form, none at all. A record with any
of the fields, and a template with its own wording for the case (an
`{% else %}` branch, fixed text), are unchanged. The
[data-tooltip guide](https://ebi-webcomponents.github.io/protvista/data-tooltip#guard-a-field-some-records-lack)
now shows the `{% if $field %}` pattern for a field only some records have,
and the guard that also leaves out blank cells.

### Added: playground examples for your own sequence, small proteins and conservation

The playground's picker has four new presets. Three load a new CI-validated
example under `examples/`, and `small-protein` loads the shipped default
config. **Your own sequence** (`own-sequence`, from
[`examples/sequence-inline/`](https://github.com/ebi-webcomponents/protvista/tree/next/examples/sequence-inline))
shows a 240-residue construct from inline FASTA with a features track and makes
no request at all; paste your own FASTA over it, or load a `.fasta` file.
**Small protein** (`small-protein`) is the default UniProt viewer on crambin
(P01542, 46 residues). **Small peptide** (`small-peptide`, from
[`examples/small-peptide/`](https://github.com/ebi-webcomponents/protvista/tree/next/examples/small-peptide))
is Trp-cage TC5b (20 residues, PDB 1L2Y) from its own sequence, with its
secondary structure from a CSV. **Conservation** (`conservation`, from
[`examples/conservation/`](https://github.com/ebi-webcomponents/protvista/tree/next/examples/conservation))
draws real per-residue conservation for rubredoxin (P24297) as a line graph,
beside its most conserved residues and UniProt's iron-binding sites, which
score highest. The scores come from the Pfam PF00301 full alignment (Pfam
38.2), computed as Jensen–Shannon divergence with Henikoff weights and a gap
penalty by a committed generator, `scripts/conservation/`, and ship with their
provenance. The served sample data are copies under
`docs/public/sample-data/`, checked byte for byte against `examples/`. See
[Per-residue conservation](https://ebi-webcomponents.github.io/protvista/your-data#per-residue-conservation).

### Fixed: a playground `#preset=` link without an accession opens the preset's own protein

A link such as `/protvista/playground/#preset=dev-multimer` used to show the
preset's config against P05067, the default accession, instead of the
preset's own protein. A link that names an accession (as every shared link
does) still uses it.

### Added: per-feature colour, shape and custom tooltip fields from your own files

Feature records from your own CSV, TSV or JSON file now keep every column
(or key) beyond `type`, `start`, `end`, `description` and `score`, just as
records written inline always did. A file and the same records written
inline now render the same way.

- A `color`, `shape`, `fill` or `opacity` column styles that one feature,
  ahead of the track's `rendering:`, so `DOMAIN` rows can be blue and
  `BINDING` rows red in one track. A blank cell falls back to the track's
  setting. `opacity` must be a number from 0 to 1. A `shape` that names a
  JavaScript built-in (`valueOf`, `constructor`, …) is dropped with a
  `data-field-ignored` warning, because the canvas would otherwise stop
  drawing the track at that feature.
- Any other column (`pmid`, `gene`, `url`, …) is kept as written, so a
  `dataTooltip` can show it as `{% $pmid %}` or `path: pmid`.
  A JSON value that is an object or array is kept on the record, but a
  tooltip never renders it as markup, whatever its shape.
- A new Markdoc tag, `{% link href=$url %}text{% /link %}` (or
  `{% link href=$url /%}`), turns a URL field into a tooltip link. Only
  `http(s):` and `mailto:` URLs and values starting with `/`, `#` or `?`
  become links (a protocol-relative `//host/…` value links to that host);
  anything else renders as plain text.
- `tooltipContent`, `locations`, `residuesToHighlight` and names JavaScript
  reserves (`toString`, `__proto__`, …) cannot come from a file (or from
  inline text read with `format:`) and are dropped. Structured inline
  records and `setTrackData()` arrays may still set them.
- Two new `track-data` warnings on the `protvista-error` event, with
  `detail.issues[0].code` `data-field-ignored` (a dropped column or
  `shape` value) or
  `unpaintable-color` (a `color` / `fill` the canvas cannot paint, which
  would otherwise draw that feature in the previous feature's colour). Like
  the coordinate warning, they reach the event, the console and the
  playground, never the row's `⚠` badge or the panel.
- BED files are unchanged: their columns are positional.

Behaviour changes for tracks with no `kind` (which use the automatic
tooltip): extra scalar columns from a file now appear in it, as they already
did for inline records; and `fill` / `opacity` no longer appear as tooltip
rows for any source, joining `color` / `shape`.

See [Load your own data](https://ebi-webcomponents.github.io/protvista/your-data#style-and-annotate-each-feature-from-your-file)
and [`examples/csv-styled/`](https://github.com/ebi-webcomponents/protvista/tree/next/examples/csv-styled).

### Added: a warning for `dataTooltip` fields no record carries

A field a tooltip names that a record lacks still renders as nothing, but
when **no** record on a track carries it — usually a typo or a column your
file names differently — the viewer now says so, once per track each time
the data loads:

```
[protvista-uniprot] Track domains/hits: dataTooltip references unknown fields: pvalue, Gene
```

The same finding fires a `protvista-error` event with
`phase: 'tooltip-field-miss'` (no longer reserved), `severity: 'warning'`,
one issue with `code: 'tooltip-field-miss'`, and the names in
`context.fields`; the playground lists it as a warning. It never puts a `⚠`
badge on the row or raises the alert panel, even under `strict`: the track
renders as written. Only a `dataTooltip` you author is checked — per-kind
defaults, the automatic tooltip and graph tracks never warn — and a field
that is present but empty is not missing. Correctly authored configs see no
change, and tooltip HTML is unchanged. See
[When a field is missing](https://ebi-webcomponents.github.io/protvista/data-tooltip#when-a-field-is-missing).

### Added: delimiter hints for CSV/TSV header errors

A CSV or TSV file whose header uses a different separator from the one its
format implies — a semicolon "CSV" from Excel in many European locales, a
tab file named `.csv`, a comma file named `.tsv` — used to fail with only
`missing required header column "type"`, which sent authors hunting for a
typo. The message now names the separator the header seems to use and the
fix:

```
./hits.csv (parsed as CSV): missing required header column "type". Header must contain type, start, end, description[, score]. The header looks tab-separated — read it as TSV: set `format: tsv` (or rename the file to .tsv).
```

A semicolon header is pointed at Excel's "Text (Tab delimited)" export read
as TSV, since no `format:` reads semicolons. The hint is part of the
decoder's message, so it appears wherever that message already does: the
track's `⚠` badge, the `protvista-error` event's `message` and the console.
Parsing is unchanged — the format alone still picks the delimiter — and a
column that is genuinely missing keeps its message exactly as before.

### Added: open a local data file in the playground

The playground has a **Load data file…** button, and takes a file dropped on
the config editor. Pick a CSV, TSV, JSON or BED file and attach it to a new or
existing track, and it renders against the current accession. The file is
read in your browser and never uploaded: the config names it
(`data: ./hits.csv`), so a shared link carries only the name. A file with any
other extension asks how to read it and writes `format:` into the config (a
tab-separated `.csv` is offered as `tsv`), and a config that already names the
file (`data: ./data/hits.csv`) just needs the file loaded. Parse errors (with
the delimiter hint) and coordinate warnings are listed in the playground's
diagnostics, naming your file. Dropping a file on the editor no longer pastes
its text into the config, and dropping one elsewhere on the page no longer
navigates away.

The same button (and drop) also takes a FASTA file — `.fasta`, `.fa`, `.faa`,
`.fas`, or any other file whose first non-blank line starts with `>` (a `.csv`,
`.tsv`, `.json` or `.bed` is read as data, unless the config's `sequence:` names
it) — as the config's
`sequence:`. It is parsed as a hosted viewer would parse it before anything
changes, so a file with two records or a stray character is refused with the
viewer's own `invalid-sequence` message, and one over 2 MB (the most a hosted
viewer fetches) is refused too. The config again names only the file
(`sequence: ./my-protein.fasta`), never its residues or header. If the config's
`sequence:` already names it, it just loads — whatever its name, so a
headerless `seq.txt` works too — and `examples/sequence-only/` renders from its
own two files; otherwise you choose between setting this config's `sequence:`
(which removes `accession:`) and a new sequence-only config, undoable with
Ctrl/Cmd+Z. A shared link whose `sequence:` names a file you haven't loaded
lists `local-file-missing` and shows no preview, rather than requesting the
file from the docs site; the preview pane says which file to load. A binary
file's refusal now names every format the button reads.

### Added: view a protein that isn't in UniProt (`sequence:`)

A config can set `sequence:` instead of `accession:` to show a predicted
protein, a construct or any other protein with no UniProt entry. It takes raw
residues, inline FASTA (a YAML `sequence: |` block) or a path or URL to a
one-record FASTA file, fetched relative to the page when the config loads:

```yaml
sequence: ./my-protein.fasta
rows:
  - id: hotspots
    kind: features
    data: ./hotspots.csv
```

The viewer then draws the navigation, the sequence and every track that reads
your own data (file, inline or `from: custom`), and makes no request of its
own — no UniProt entry, no structure panel — so it also works offline. The
FASTA header, or "your sequence", appears wherever the accession did, and the
authored-coordinate check names it. A track that needs UniProt — an
`{accession}` data URL, an AlphaFold or AlphaMissense kind, an `{accession}`
label link — fails validation by name (`needs-accession`), as do both or
neither of `accession:` / `sequence:` (`accession-and-sequence`,
`missing-protein`), a multi-record or malformed sequence (`invalid-sequence`)
and a FASTA file that can't be fetched (`cannot-resolve-sequence`). Each is a
`phase: 'config'` error in the panel and on the `protvista-error` event. The
playground disables its accession box for such a config, including one whose
`extends:` base sets `sequence:`. `setConfig()` switches between the modes: a
`sequence:` config replaces an accession the previous config set, while a
config that names no protein keeps showing it, as before. Accession-mode
configs are unchanged. See
[Proteins outside UniProt](https://ebi-webcomponents.github.io/protvista/sequence-only).

### Fixed: a config with no accession now reports `missing-protein` instead of mounting blank

An element with neither an accession (attribute or config) nor a `sequence:`
used to render nothing at all, with no message, unless its config happened to
use `{accession}` (then it reported `missing-accession`). It now shows the
config panel with one issue, `missing-protein`, and fires a `phase: 'config'`
error; `missing-protein` replaces `missing-accession` in that case. An
embedder that sets the `accession` attribute only after the element has
mounted should hold the load with `suspend` until then, which was already the
supported path.

### Fixed: the playground no longer scrolls sideways on a phone

The preset picker is as wide as its longest preset name, which pushed the
playground page about 60px sideways at 390px wide. It now shrinks to fit.

### Added: template variables in data URLs

Any `{token}` in a `sources` URL or a descriptor `url:` now resolves, not only
`{accession}`. Values come from a new top-level `variables:` block (baseline
defaults), then the element's `data-*` attributes (`data-species="mouse"` fills
`{species}`; `data-dataset-id` fills `{datasetId}`), then the `accession`
attribute, which also wins over `data-accession`. Changing a `data-*` attribute
that a URL uses re-runs the data load once per animation frame. `variables:`
merges by key across `extends`.

A token that nothing defines is reported as a `missing-variable` validation
warning (the config still loads). At fetch time that URL is skipped with a
console warning rather than requested half-built.

Substituted values are now URL-encoded, so a value can't add a path segment,
query string or fragment. A value of exactly `.` or `..` (which would climb out
of the URL's path) or one containing malformed Unicode is refused: that URL is
skipped with a console warning, and other tracks load normally. `{accession}`
keeps its existing `[A-Za-z0-9_-]{1,32}` gate. `data-accession` has no effect
on the element, because `{accession}` always comes from the `accession`
attribute or the config's `accession:`. Every occurrence of a token is replaced; previously
only the first `{accession}` in a URL was.

### Fixed: Retry during a full reload no longer leaves mixed data

Clicking a track's Retry badge while a full reload was in flight (after an
accession or `data-*` change) aborted that reload and refetched only the
retried track, so every other track kept the previous accession's or
variables' data. The retry now runs as a full load.

## 5.0.0-beta.3 — 2026-10-02

### Changed: Nightingale 5.11, and `BINDING` features get their own colour

All `@nightingale-elements/*` dependencies now require `^5.11` (`^5.11.1`
for the track and variation canvases). nightingale-track 5.11.1 fixes the
default colour of the `BINDING` type, which was the invalid string
`#catFace`
([upstream fix](https://github.com/ebi-webcomponents/nightingale/commit/ef8f74d7dc95bcf252e0ed3a05ff697de3d3ed70)).
Binding sites without a `rendering.color` used to be drawn in whatever
colour the previous feature used (often the lavender of a neighbouring
`DOMAIN`); they are now `#009999`.

### Added: feature type and shape vocabulary page

The docs site gains
[Feature type and shape vocabulary](https://ebi-webcomponents.github.io/protvista/type-and-shape-vocabulary),
generated from Nightingale: every recognised feature `type` with its default
colour and shape, what an unrecognised type looks like (a black rectangle)
and how to style one, and each of the 22 `rendering.shape` values as the
canvas track draws it.

### Changed: four provider-only kinds are renamed

**Breaking.** A kind keeps a plain domain word only if you can bring your own
data to it. Kinds that read one provider's feed now say which provider:

| Old kind | New kind |
| --- | --- |
| `confidence-score` | `alphafold-confidence` |
| `pathogenicity-score` | `alphamissense-pathogenicity` |
| `pathogenicity-heatmap` | `alphamissense-heatmap` |
| `features-interpro` | `interpro-features` |

A config that uses an old name fails validation with a message giving the
new one. The default config, examples and starter kit are updated.

### Added: bring your own data to most track kinds

A track's `kind` now decides what records it reads, and the file decides
only how they are encoded. Three record shapes cover every kind that can
take your data:

- **Feature records** (`type`, `start`, `end`): `features`,
  `interpro-features`, `peptides`, `peptides-ptm`, `structure-coverage`.
- **Point records** (`position`, `value`): the new generic `kind: linegraph`,
  plus `variant-counts` and `rna-editing-counts`, so a count you computed
  renders on the same track the UniProt counts would.
- **Variation records** (`position`, `variant`, optionally `wildType`,
  `description`, `consequence`): `variants` and `rna-editing`. The viewer
  supplies the protein sequence these tracks need, so your file doesn't have
  to carry it.

Each shape can be read from CSV, TSV or JSON (and feature records from BED),
from a URL, a file, or `from: inline`. A track's `kind` used to be able to
send a file to the wrong parser (for example `confidence-score` with
`./plddt.json` was read as generic features); the extension now only picks
an encoding within the kind's own shape. See
[Load your own data](https://ebi-webcomponents.github.io/protvista/your-data).

### Changed: `format:` replaces the file-format adapter names

**Breaking.** A data descriptor declares how its source is encoded with
`format: csv | tsv | json | bed`, and the track's kind supplies the record
shape. The adapter names `features-csv`, `features-tsv`, `features-json` and
`bed` are removed; a config that still names one is told what to write
instead (`use format: csv`). `adapter:` is now only for provider transforms
and adapters you register yourself; when a descriptor names one, its
`format:` is not consulted.

`format:` is read everywhere a source is: URLs, `sources:` entries (whose
extension is now also used), `from: inline` and `setTrackData()`. You only
need it where there's no extension to go on, or to override a misnamed
file. Other rules:

- A kind paired with a format it can't read is a config error
  (`kind-format-mismatch`) that names the kinds that can, rather than a
  silently empty track.
- `alphafold-confidence`, `alphamissense-pathogenicity` and
  `alphamissense-heatmap` need two API responses and a further fetch, so
  they reject a file of any format.
- Inline text with no `format:` is rejected; the viewer doesn't guess.
- A `format:` that disagrees with the file's extension is allowed, and
  reported as a warning saying which reading won.

### Changed: parser errors name your file

A malformed row used to be reported against the adapter that read it
(`features-csv: row 3, …`). It now names the source and how it was read:

```
./depth.csv (parsed as CSV): row 3, column "value": expected a number, got "abc".
```

### Changed: config warnings are marked as warnings

Validation issues now carry `severity`. A config that is valid but has
warnings still fires the `config` error event, with each issue marked
`severity: 'warning'`, and logs with `console.warn` rather than
`console.error`. Warnings never open the error panel, even under `strict`.

### Fixed: bring-your-own-data loading

- CSV and TSV files saved from a spreadsheet load. A trailing blank line, or
  rows of empty cells left by cleared cells, used to reject the whole file
  as ragged.
- A header column named after an `Object.prototype` member (`toString`,
  `__proto__`) is ignored like any other extra column instead of being
  rejected or misread.
- `setTrackData()` with the published record shape drew nothing or threw,
  and the throw stopped every later track from receiving its data. It now
  draws the records, and a component that can't render its payload fails
  only its own track.

### Added: `detailOnly` keeps a track out of its group's collapsed view

Set `detailOnly: true` on the detail half of a summary-and-detail pair (for
example a variants track beside its counts graph) and the group's collapsed
view is drawn from the other tracks, both for choosing the component and
for the data. The expanded track is unaffected. The default config uses it
for VARIATION, RNA editing and AlphaMissense, replacing the explicit
`component:` those groups needed. Marking every track in a group, or a
standalone track, is a config warning.

### Changed: the structure table links to every PDB provider again

PDB rows link to PDBe, RCSB PDB and PDBj, as they did in 4.x, and PDB
structures are listed in descending id order.

### Fixed: a collapsed group no longer draws its hidden tracks

Hiding a track in customize mode (or authoring it `hidden: true`) removed it
from the expanded group but left its data in the group's collapsed summary.
The summary is now built from the visible tracks only, and rebuilt from the
already-loaded data whenever a track is hidden, shown or moved. A line-graph or
coloured-sequence group draws its first visible track, and its `change` events
name that track as their source.

### Added: `detail.track` on the `change` event

Every `change` event from a track now says where it came from before any
other listener sees it: `detail.track.rowId`, `trackId` (`null` for a
collapsed group's aggregate) and `kind`, the track's semantic kind after
`extends` merging. A host building its own tooltips no longer has to parse
element ids (whose format and `pv-<hash>` prefix are not a compatibility
contract) or walk `getConfig()`, which returns the authored config and is
`undefined` until the config loads. The detail type is exported as
`ProtvistaChangeEventDetail`.

### Fixed: zoom and pan update the viewer's display range

The viewer read a zoom or pan from `detail.displaystart` / `displayend`, but
Nightingale sends `display-start` / `display-end`, so the range it re-rendered
with never followed the user's zoom. It now reads the hyphenated keys, which
is also how `ProtvistaChangeEventDetail` types them.

### Added: collapsed groups remember where each feature came from

Every item the viewer loads is tagged with its source track and kind, so a
click in a collapsed group that mixes tracks reports
`detail.track.sourceTrackId` / `sourceKind` — for example
`'interpro-features'` for an InterPro item in DOMAINS and `'features'` for a
UniProt one. A collapsed graph group (line graph, coloured sequence) draws a
single track, so its clicks and hovers name that track — for example the
variant-count line graph in VARIATION. The tag is a non-enumerable property
under the exported `PV_SOURCE` symbol, read with
`getFeatureSource(feature)`; it does not appear in `Object.keys`,
`JSON.stringify`, object spread or snapshots.
Items are now always copied before tagging, so adapter output and
`setTrackData()` input are never mutated.

### Added: an `adapters` property, and idempotent registration

`adapters` is the declarative form of `registerAdapter()`: a map of name to
function, registered as soon as it is set. It may be set before the element
is defined — the value is applied on upgrade, before loading starts — so a
host no longer needs to render with `suspend`, register, then clear it.
Each value set replaces the last one atomically: a name may take a new
function, so an inline object re-created on every React render is fine, and
a name the new value drops is unregistered, falling back to the built-in it
overrode. A name already registered some other way (for example with
`registerAdapter()`) throws `RegistryCollisionError` and leaves the element
unchanged.

Registering the same value under the same name again with
`registerAdapter()` (or any other `register*` method) is now a no-op instead
of a `RegistryCollisionError`, which makes React StrictMode's double-invoked
ref callbacks safe when the values are defined once at module scope. A
different value under a taken name still throws, and "the same" means the
same reference.

If React 19 renders the element before it is defined, it turns `adapters`,
`viewerConfig` or the structure element's `data` into an attribute such as
`adapters="[object Object]"`, and the value is lost. The element now logs a
warning naming the prop instead of loading silently without it.

### Added: public typings and subpaths

`suspend`, `notooltip`, `nostructure`, `noPersistLayout`, `configSrc`,
`accession`, `sequence` and `viewerConfig` are now public properties, and
both elements are in `HTMLElementTagNameMap`. The package root exports the
types `ProcessedStructureData`, `AdapterFunction`, `ProtvistaViewerConfig`,
`TooltipSpec`, `ProtvistaChangeEvent`, `ProtvistaChangeEventDetail`,
`ProtvistaTrackOrigin` and `FeatureSource`. Two new subpaths:
`protvista-uniprot/react` (types only — JSX declarations for both elements
using attribute spellings; needs React 19 and `@types/react` 19 or later,
declared as an optional peer dependency) and `protvista-uniprot/structure`
(`<protvista-uniprot-structure>` without the track viewer).

### Changed: proteomics adapters keep what tooltips need

`uniprot-proteomics-json` passes every field of the API's peptide feature
through under its own name (`ptms` included), copies the response's `taxid`
onto each feature, and still rewrites `type` to `unique` / `non_unique` for
the `filter:` sugar — keeping the API's own type as `sourceType`
(`PROTEOMICS` or `PROTEOMICS_PTM`). It also no longer mutates the raw
response, which the default config shares with the PTM track.
`uniprot-proteomics-ptm-json` markers now carry the API's `ptms` entries for
their modification and residue, unchanged, and the `confidenceScore` their
colour is computed from (`null` when the evidence is missing or mixed). Its
data-quality messages are `console.warn` rather than `console.error`. Both
outputs are documented in the adapter reference as each adapter's output
contract.

### Changed: `<protvista-uniprot-structure>`'s colour theme attribute is `color-theme`

`colorTheme` had no explicit attribute mapping, so its attribute was the
lowercased `colortheme`, unlike `selected-id` and `no-table`. It is now
`color-theme`; a page setting `colortheme="…"` should switch.

### Fixed: line-graph clicks

`nightingale-linegraph-track` spells the event-type field `eventtype`, so
the built-in popover (which checks `eventType === 'click'`) never opened for
line graphs, and its click carries no `feature` or `coords`. The viewer now
copies `eventtype` to `eventType` for every listener, and fills a line-graph
click's `feature` with each series' point at the clicked position (the shape
its hover already sends) plus a `tooltipContent` listing them, and `coords`
from the pointer event. Clicking a line graph now opens the popover.

### Fixed: the host `change` listener no longer piles up on reconnect

The listener tracking zoom/pan was added in `connectedCallback` and never
removed, so each disconnect/reconnect added another. It is now registered
once, in the constructor.

### Changed: `theme.labelColor` now keeps the group/track hierarchy

A config `theme.labelColor` used to paint group and track labels the same
colour, flattening the distinction the default palette draws (grey group
headers over white track labels). It now applies the colour to group labels
and derives the track-label background as a light tint of it (25% over
white): the shipped hierarchy, in the author's hue. Existing configs using
`labelColor` render with the new two-tone pair automatically.

The navigation label cell and the credits cell no longer take the
track-label background at all. They are neutral chrome, not rows, so a
theme tint no longer bleeds above and below the rows it describes. They
now sit on their own tokens, `--protvista-chrome-cell-bg` (defaulting to
`--protvista-color-surface`, white) and `--protvista-chrome-cell-color`.
This also affects consumers who set `--protvista-track-label-bg` in their
own CSS: to keep the whole label column one colour, set
`--protvista-chrome-cell-bg` (and `--protvista-chrome-cell-color` if the
text needs to change) to match.

### Added: explicit `theme.groupLabelColor` / `theme.trackLabelColor`

For authors who want to pin either surface exactly, the `theme:` block
accepts `groupLabelColor` and `trackLabelColor`, which override the pair
`labelColor` would derive and map one-to-one onto
`--protvista-group-label-bg` / `--protvista-track-label-bg`.

### Fixed: a themed label now brings a text colour that reads on it

Label text kept the page's own colour whatever `theme.labelColor` painted
behind it, so a dark label colour on an ordinary light page gave
near-black text on a near-black fill. The collapse caret and the
near-white hover background failed the same way. For each label surface
the theme paints, the viewer now derives text, muted text, caret and hover
colours from the background, picking whichever of the default body colour
(`#222222`) and white contrasts better. New tokens expose the results:
`--protvista-group-label-color`, `--protvista-track-label-color`, their
`-muted` variants, and `--protvista-group-label-hover-bg`.

Without a theme nothing changes: the label text tokens are unset by
default, so label text still takes the page's colour. The derivation runs
only for the config `theme:`. If you set a label background in your own
CSS, set the matching text tokens too (see the theming guide).

Label colours (`labelColor`, `groupLabelColor`, `trackLabelColor`) are now
resolved to `rgb()` before they reach the stylesheet, since the text colour
is calculated from them. Hex, keywords, `rgb()`, `hsl()`, `oklch()`,
`oklab()`, `lab()`, `lch()` and `color()` in the `srgb`, `srgb-linear` and
`display-p3` spaces all work across the documented support matrix
(Chrome/Edge 92+, Firefox 90+, Safari 15+). **Breaking:** `var()`,
`currentcolor` and `light-dark()` are no longer accepted for these three
fields, because they can't be turned into a fixed colour. A label colour
that can't be resolved is ignored with a `console.warn` instead of being
passed through.

`accentColor` is still handed to CSS as written, so `var()`,
`light-dark()`, alpha and any colour space the browser supports keep
working. A value the browser doesn't accept as a colour is now ignored with
a `console.warn`.

### Changed: tokens that default from another token are no longer declared on `:root`

Component tokens whose default is another token (for example
`--protvista-tooltip-bg`, which defaults to `--protvista-color-surface`)
used to be declared in the viewer's `:root` default block. That resolved
the global token at the root, so overriding it on the host or an ancestor
never reached them. They are now left undeclared, and the viewer's own
rules carry the fallback chain, so a global override works wherever you
declare it. **Breaking** for CSS or scripts that read one of these tokens
directly, such as `var(--protvista-tooltip-bg)` or
`getComputedStyle(el).getPropertyValue('--protvista-tooltip-bg')`: it now
has no value unless you set it, so give it a fallback or read the global
token instead.

The datatable works the same way: its tokens are no longer declared on its
`:host`, so they can now be set on any ancestor like every other token
(previously only an inline style or `!important` reached them). If both a
`--protvista-datatable-*` token and its older `--protvista-dt-*` alias are
set, the `--protvista-datatable-*` one now wins.

## 5.0.0-beta.2 — 2026-07-31

The second v5 beta, still on the `beta` dist-tag: `npm install
protvista-uniprot` continues to resolve stable 4.9.x, and this release is opt-in
via `npm install protvista-uniprot@beta`. Schemas and APIs may still change
before 5.0.0.

The whole of this release is the 3D structure viewer catching up. The
`protvista-uniprot-structure` element was rewritten for v5 and, in doing so,
lost capabilities the 4.x viewer had. Those are now reapplied on top of the
rewrite, together with a small public API for driving the viewer from the
outside. With thanks to **Swaathik**, who ported the 4.x work.

### Added — the 3D structure viewer regains its 4.x capabilities

`protvista-uniprot-structure` now loads and describes structures the way 4.x
did, on top of the v5 rewrite:

- **AlphaFold complexes.** Predictions are fetched with
  `include_complexes=true`, so complexes appear alongside monomers. Each row
  carries its oligomeric state (e.g. `Homodimer`) and the UniProt chains it
  covers, and monomers sort ahead of complexes.
- **`.cif` downloads and cleaner links.** Experimental structures expose a
  PDBe `…_updated.cif` download URL; AlphaFold rows link to the model's `.cif`
  and to the AlphaFold search page. PDBe links are simplified.
- **Empty data is handled.** An accession with no structures renders cleanly
  instead of failing.

### Added — attributes and an event to drive the viewer

The element can now be controlled and observed from the page:

- **`selected-id`** — pre-select a structure by id; the viewer honours it once
  the structure list has loaded, without waiting for a click.
- **`no-table`** — render the 3D view on its own, without the accompanying
  structures table.
- **`structures-loaded`** — a `CustomEvent` fired once structures resolve,
  carrying the processed list so a host page can react to what is available.

## 5.0.0-beta.1 — 2026-07-30

First public beta of v5, published on the `beta` dist-tag. The stable 4.x line
stays on `latest`: `npm install protvista-uniprot` still resolves 4.9.x, and
this release is opt-in via `npm install protvista-uniprot@beta`. Schemas and
APIs may still change before 5.0.0.

The theme of the release is removing hardcoded assumptions. A viewer used to be
whatever `src/config.ts` said it was, against data sources fixed at EBI. It is
now driven by a configuration document you supply, over sources you choose,
arranged by whoever is looking at it.

With thanks to the contributors from outside the core team:
[**Jishanahmed AR Shaikh**](https://github.com/jishanahmed-shaikh), whose
[#137](https://github.com/ebi-webcomponents/protvista/pull/137) forbade `any`
across the codebase and turned on `noImplicitAny` and `strictNullChecks`
(closing [#133](https://github.com/ebi-webcomponents/protvista/issues/133)),
through two rounds of review; and [**Epi-Lo**](https://github.com/Epi-Lo), who
took on the same problem in parallel.

### Added — configuration-driven loading

A viewer is now described by a YAML or JSON configuration document rather than
compiled-in TypeScript. Point the element at one:

```html
<protvista-uniprot config-src="./my-config.yaml"></protvista-uniprot>
```

or assign an already-parsed object to the `viewerConfig` property. The document
declares its own data sources, the rows to draw, and how each is rendered:

```yaml
accession: P05067
sources:
  features: https://www.ebi.ac.uk/proteins/api/features/{accession}
rows:
  - id: DOMAINS
    tracks:
      - id: domain
        kind: features
        filter: DOMAIN
        data: features
```

This replaces a 912-line hand-written `src/config.ts` that enumerated 15 groups
and roughly 40 tracks with four EBI web addresses baked into it (deleted in
`945ca9f`). Consequences worth knowing:

- **The data sources are yours.** Nothing in the loader assumes EBI. A
  deployment can point every row at its own endpoints.
- **`extends:`** pulls in another config — including the canonical UniProt one,
  published at
  `https://cdn.jsdelivr.net/npm/protvista-uniprot@<version>/dist/default-config.yaml` —
  so "the default viewer plus my track" is a few lines, not a fork.
- **No build step.** Changing what a viewer shows no longer means editing source
  and rebuilding.

### Added — a published JSON Schema for viewer configurations

Configs are validated against a schema published at a stable URL, so a config
can be checked before it ever reaches a browser:

- `https://ebi-webcomponents.github.io/protvista/schema/v1/config.schema.json`
- `https://ebi-webcomponents.github.io/protvista/schema/v1/feature-record.schema.json`

Validation runs at load time and reports failures through the error surfaces
below rather than rendering a blank viewer. The schema is versioned under
`/v1/`, and the copy under `public/schema/v1/` is pinned byte-identical to the
authored source by a test, so the hosted document cannot drift from the code.

### Added — load your own data from CSV, TSV, JSON, or BED

A `features` row can read a data file directly. The extension picks the parser,
so there is no adapter to configure:

```yaml
rows:
  - id: hotspots
    label: Hotspots
    kind: features
    data: ./hotspots.csv
```

`.csv`, `.tsv`, `.json`, and `.bed` are recognised (`src/schema/file-formats.ts`).
A feature record's required columns are `type`, `start`, `end`, and
`description`; `score` is optional. Paths resolve against the hosting **page**,
not the config file.

The built-in adapters for UniProt's own payload shapes — variation, proteomics,
PTM-Exchange, InterPro, RNA editing, structure coverage, AlphaFold confidence,
AlphaMissense — are now selected by name from the config rather than wired in
code, and are listed in the published adapter reference.

### Added — Customize mode: reorder, show, and hide without code

Every viewer now carries a **Customize** control. In that mode each row grows
move-up / move-down buttons and a show/hide toggle: rows can be reordered and
hidden, and tracks reordered within their group or hidden individually. There is
no drag gesture — every control is operable by mouse, touch, and keyboard alike.

The same arrangement is available programmatically, and a layout edit rewrites
the viewer's config, so `getConfig()` exports exactly what the user arranged:

- `setRowOrder(order)`, `setTrackOrder(rowId, order)`
- `setRowVisibility(rowId, visible)`, `setTrackVisibility(groupId, trackId, visible)`
- `resetLayout()`, `getConfig()`, `getLayout()`

Each emits a `protvista-layout-change` event.

A layout **persists per configuration** — keyed on a hash of the config's row and
track ids, not on the accession — so it applies to every protein viewed with the
same config. It is stored in `localStorage` and encoded in a shareable `?layout=`
URL parameter. Set `no-persist-layout` to opt out of all of it.

### Added — declarative tooltips

Per-datapoint tooltips are authored as Markdoc templates in the config
(`dataTooltip`) instead of assembled as HTML strings in code:

```yaml
dataTooltip: "### {% $name %}\n\n**Score:** `{% $score %}`"
```

This replaces five files of hand-built markup that carried UniProt-specific
lookup tables into every consumer's bundle, and it means a tooltip for your own
data needs no JavaScript.

### Added — extension points for cases the config cannot express

The configuration covers the common ground; these escape hatches cover the rest,
without forking. Each registers against the element before it loads:

- `registerAdapter(name, fn)` — transform a payload shape the built-ins don't know.
- `registerComponent(name, ctor)` — render with your own custom element.
- `registerSemanticKind(name, def)` — define a new `kind:` for configs to use.
- `registerTheme(name, stops)` — add a named colour scale.

### Changed — dense tracks render on canvas

Feature and variant tracks, which can carry thousands of annotations on one
protein, now draw on HTML canvas rather than SVG
(`nightingale-track-canvas`, `nightingale-variation-canvas`,
`nightingale-colored-sequence`, `nightingale-sequence-heatmap`). This keeps
interaction responsive on densely annotated proteins and on modest hardware.

### Added — accessibility work and an automated baseline

The Customize controls are buttons rather than a drag interaction, carry 24×24px
targets, never signal state by colour alone, and announce each move through a
polite live region (for example "Domains moved to position 2 of 12"). A
browser-mode test layer drives real Chromium with axe-core assertions, and
reports no violations with Customize mode active.

This is a baseline, not a conformance claim: the manual WCAG audit is a later
deliverable, and `docs/accessibility-baseline.md` records both what is covered
and the residual gaps.

### Added — side-effect-free `protvista-uniprot/config` subpath

The variant `filterConfig` and `colorConfig` now have a dedicated,
side-effect-free entry point:

```js
import { filterConfig, colorConfig } from 'protvista-uniprot/config';
```

Importing them from the package root still works but pulls the whole viewer:
the root self-registers `<protvista-uniprot>` on load, so a bundler must keep
it (and Lit, every Nightingale track, Mol*) whenever the module is reached.
The `./config` subpath is built as its own output (`dist/config.mjs`) that
reaches none of that, so a consumer importing only the filter data can
tree-shake the element away. The element bundle imports the same chunk, so
the config is not duplicated.

`filter-config.ts` reaches nothing at runtime for this to hold — its
`@nightingale-elements/nightingale-variation-canvas` imports are now
type-only — and a spec walks the subpath's import graph and fails if it ever
reaches a custom-element registration.

The subpath's declarations are also mapped through `typesVersions` so the
classic (node10) resolver — which predates `exports` and would otherwise not
find them — resolves the types; modern resolvers ignore it and use `exports`.

### Fixed — packaging: `import 'protvista-uniprot'` survives bundling

The package declared `"sideEffects": false`, promising bundlers that no
module here does anything on load. That was untrue: `<protvista-uniprot>` is
registered by a `@customElement` decorator, so evaluating the entry module
*is* the registration. The promise let production bundlers delete the
documented binding-less `import 'protvista-uniprot';`, after which the tag
silently stayed undefined and the element rendered as an empty box. Dev
servers evaluate eagerly, so it only ever surfaced in a shipped build. The
field is now removed, restoring the default assumption that a module may
act on load.

Consequence worth knowing: importing only the named exports
(`filterConfig`, `colorConfig`, `ProtvistaUniprotStructure`) from the package
root can no longer shake the component out, so those consumers now pay the
full bundle. For `filterConfig` / `colorConfig`, the new side-effect-free
`protvista-uniprot/config` subpath (above) restores tree-shaking.

Also in this release:

- Removed the `main` field. It pointed at `dist/protvista-uniprot.js`, which
  no build has emitted since the move to Vite (ES output only) — any
  resolver falling through to it got a missing file. `module` and `exports`
  cover every live resolver.
- Added `types` and `default` conditions to `exports`. With only an `import`
  condition, TypeScript on `moduleResolution: "bundler"` or `"node16"`
  resolved *through* `exports` and never found `dist/types/index.d.ts`, so
  consumers got no declarations.
- Added `"type": "module"`. Everything shipped is ESM, but without the field
  two things read as CommonJS: the lazy `import()` chunks Vite emits as
  `dist/*.js`, which Node had to sniff and reparse (`MODULE_TYPELESS_PACKAGE_JSON`),
  and `dist/types/*.d.ts`, which TypeScript treated as a CJS declaration
  describing an ESM file — reported by `attw` as "masquerading as CJS" on
  both `node16` resolution modes.
- The built element entry is code-split: `dist/protvista-uniprot.mjs` loads
  sibling chunks — `errors.js` and the shared `filter-config.js` statically,
  `format.js` / `js-yaml.js` lazily — from the same directory. Bundlers and
  CDNs (jsDelivr, unpkg) resolve these automatically, so the npm and CDN paths
  need no change; a consumer copying the build to serve it directly must copy
  the whole `dist/` folder, not the `.mjs` alone.
- This package's own declarations now resolve under `node16`/`nodenext`.
  `moduleResolution: "bundler"` permits extensionless relative imports, the
  emitted `.d.ts` reproduced them faithfully, and they then failed to resolve
  for consumers using Node's ESM rules — degrading their types to errors.
  Relative specifiers in `src` now carry explicit `.js` extensions, so what
  is emitted is resolvable. No API change; imports of this package are
  unaffected. Types re-exported from `@nightingale-elements` packages may
  still degrade under Node ESM resolution — those ship the same defect
  upstream; see the `moduleResolution` note in `tsconfig.json`.
- The published `dist/` no longer carries two copies of the declarations.
  `tsc` and `vite-plugin-dts` were both emitting them, into different trees
  because the plugin's output directory was misconfigured, so `dist/` shipped
  both — and `yarn test` after `yarn build` changed what a subsequent
  `npm publish` would ship. `tsc` is now `noEmit` (`yarn test:types` is a
  check, not a build step) and the plugin owns `dist/types`. Declarations for
  test files are no longer shipped.
- `files` is now `["dist"]`. The tarball previously carried 139 source files
  — the entire test suite included — that no consumer could import, because
  `exports` gates every subpath. The sourcemap already embeds the sources for
  debugging. Unpacked size drops from ~1.15 MB to the build output alone.
- Added `prepack` so `npm pack`/`npm publish` build first. `dist/` is
  gitignored, so publishing without a prior `yarn build` shipped a package
  whose every declared entry point was missing.
- Dropped `core-js` and `lodash-es` from `dependencies` (and `@types/lodash-es`
  from dev) — nothing in the codebase has referenced them since the move off
  the Babel build.
- Runtime dependencies now use caret ranges instead of exact pins. Exact pins
  stop a consumer's resolver deduplicating, which for `lit` means a second
  copy of `ReactiveElement` in the same page.
- Added `repository`, `bugs`, `homepage` and `keywords`, and set
  `publishConfig.tag` to `beta` so a v5 publish cannot take the `latest` tag
  from the 4.x production line.
- `src/playground/**` is excluded from the emitted declarations. It is a
  docs-site page rather than public API, and its types referenced `codemirror`
  and `@codemirror/lint` — devDependencies a consumer cannot resolve.
- `scripts/clearCDNcaches.sh` purged `dist/protvista-uniprot.js`, a pre-Vite
  name no build emits, making the jsDelivr purge a no-op; it now purges the
  `.mjs` entry and its map. Note the lazy `dist/*.js` chunks carry no content
  hash and are still not purged.
- `yarn test:pack` runs `publint` and `attw` against the packed tarball, and
  CI runs it after the build. Nothing previously checked the exports map or
  the emitted declarations the way a consumer resolves them.

### Breaking — `label` is now a Markdoc string; `helpPage` and `labelUrl` removed

Group and track `label` is now a Markdoc **inline** source string rendered
through the same `@markdoc/markdoc` pipeline as `dataTooltip`. This collapses
the previous three-field label surface (`label` + `helpPage` + `labelUrl`) into
one: write Markdown, including a link if you want one. `{accession}` is
interpolated into the label before rendering (same substitution `labelUrl`
used). The allowed surface is inline only — emphasis, code, links, and a
registered `{% help %}` custom tag; block-level markup (headings, lists, code
fences, tables) is rejected with a console warning and degrades to inline text.

The `helpPage` and `labelUrl` fields have been **removed** from the schema
(`ConfigDefaults`, `GroupConfig`, `TrackConfig`).

**Migration.** Rewrite affected labels:

| Before                                                        | After                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `label: Signal peptide`<br>`helpPage: signal`                 | `label: '{% help slug="signal" %}Signal peptide{% /help %}'`                |
| `label: AlphaFold Confidence`<br>`labelUrl: https://x/{accession}` | `label: '[AlphaFold Confidence](https://x/{accession})'`               |

The `{% help slug="…" %}…{% /help %}` tag renders
`<span data-article-id="…">…</span>` — byte-identical to what `helpPage`
produced. External `http(s)` links in a label open in a new tab
(`target="_blank" rel="noopener noreferrer"`), matching the old `labelUrl`
anchor. `slug` is restricted to `^[a-zA-Z0-9_#-]+$`.

**uniprot.org embedders:** the in-page help popover keeps working **only if the
`{% help %}` tag stays registered** (it is, by default, in this package's label
renderer). The `data-article-id` DOM your help-article controller listens for is
unchanged. If you strip or fail to register the tag, help spans stop rendering
and the popovers break — that is the one visible DOM regression to watch for.

### Removed (breaking) — the top-level `groups:` config field is now `rows:`

The top-level entry list is `rows:`, and the deprecated `groups:` alias is
**removed** (no fold, no warning — a leftover `groups:` is now an unknown
property and fails validation). That array has held two kinds of entry
since standalone single-row tracks landed — a group (a collapsible
cluster, has `tracks:`) and a standalone track (one row on its own, has
`data:`) — so `groups:` named it dishonestly. Every top-level entry is one
vertical lane; a group is simply an expandable lane.

**Migration.** Rename the field. Nothing else about the entries changes:

```yaml
# Before                     # After
groups:                      rows:
  - id: DOMAINS                - id: DOMAINS
    tracks: [...]                tracks: [...]
```

**Not affected:** `tracks:` nested inside a group keeps its name — only
the top-level field is renamed. The post-load `NormalizedConfig` model
exposes `rows` / `NormalizedRow`, so the authoring field and the resolved
model agree.

### Added — no-code theming via the config `theme:` field

A new optional top-level `theme: { labelColor?, accentColor? }` recolours
the viewer chrome from the config — no CSS required. `labelColor` sets the
row-label side panel; `accentColor` sets focus rings and the datatable
active-row marker. Each maps to a `--protvista-*` design token the
component sets inline on the host at mount, so a config `theme` takes
precedence over the token defaults and ordinary page CSS (a host overrides
it only with `!important`). See `docs/theming.md`.

### Breaking — internal CSS classes and DOM ids are now hash-prefixed

`<protvista-uniprot>` renders in light DOM (required by Mol*), so its
stylesheet lives in the document's global selector scope. To make its
class names collision-proof against consumer and child-component styles,
every internal class name and wrapper/wiring DOM id now carries a
package-specific hash prefix, `pv-cecb45-` (derived from
`sha1('protvista-uniprot@' + <release version>)` — the base version, ignoring
any pre-release suffix, so it is stable across the 5.0.0 line — exposed as
`CSS_PREFIX` in
`src/styles/css-prefix.ts`). The rules remain tag-scoped under
`protvista-uniprot` as defence-in-depth.

**Migration.** If you override ProtVista's styling from your own
stylesheet, update the selectors:

| Before                             | After                                          |
| ---------------------------------- | ---------------------------------------------- |
| `.group`                           | `.pv-cecb45-group`                             |
| `.group-label`                     | `.pv-cecb45-group-label`                       |
| `.group__track`                    | `.pv-cecb45-group__track`                      |
| `.track-label`                     | `.pv-cecb45-track-label`                       |
| `.track-content`                   | `.pv-cecb45-track-content`                     |
| `.track-content__coloured-sequence`| `.pv-cecb45-track-content__coloured-sequence` |
| `.nav-container`                   | `.pv-cecb45-nav-container`                     |
| `.nav-track-label`                 | `.pv-cecb45-nav-track-label`                   |
| `.credits`                         | `.pv-cecb45-credits`                           |
| `.aggregate-track-content`         | `.pv-cecb45-aggregate-track-content`          |

Wrapper element ids (`group_<id>`, `track_<id>`) and the Nightingale
wiring ids (`track-<id>`) gained the same prefix (e.g.
`#pv-cecb45-group_DOMAINS`). The `<id>` portion — which comes from your
config — is unchanged.

**Not affected:**

- `.feature` is unchanged. The host never applies this class itself (it
  styles feature glyphs rendered by Nightingale child components), so
  prefixing it would simply stop it matching.
- The `.proforma` and `.mod-link` rules were **removed** — they were
  dead (their emitter, `src/tooltips/feature-tooltip.ts`, was deleted in
  the tooltip refactor).
- The `data-group-toggle` / `data-article-id` attributes, the
  `.protvista-tooltip` popover classes, and the loader/no-results
  classes are unchanged.

### Added — user-facing error surfaces

Errors no longer dead-end at `console.*` behind a silent blank render.
Three user-facing channels sit on top of the unchanged developer
`console.*` output (all routed through one shared reporter so the message
text stays in lockstep):

- **Mount-level error panel.** A config-validation failure or a
  sequence-fetch failure now renders a visible `role="alert"` panel
  (one-line summary and a collapsible per-issue list with `path` /
  `message` / `code`) instead of a blank element. Focus moves to the
  panel on appear. A fatal error (bad config / no sequence — nothing to
  reveal) offers no dismiss; a warning promoted under `strict` is
  dismissible, and dismissing restores focus and reveals the viewer.
  The top-level **sequence** fetch now applies the same broken-vs-missing
  distinction as per-track fetches: a **broken** fetch (`network` / HTTP
  `5xx` / unparseable) shows _"the UniProt data service is unreachable or
  failing…"_ with a **Retry** button that re-runs the mount in place,
  while a **missing** entry (HTTP `4xx`, or a `2xx` with no `sequence`)
  shows _"No UniProt entry found for 'X'. Check that the accession is
  correct."_ with no Retry. Previously every sequence failure — server
  down, offline, or a genuine typo — showed one identical "check the
  identifier" message with no way to retry. The `sequence` event now
  carries `context.errorKind` (+ `status`).
- **Per-track error badge.** The distinction is *broken* vs *missing*. A
  track whose data is **broken** shows a keyboard-focusable `⚠` badge
  (detail via `aria-describedby` and `title`). Failures are classified:
  `network` (unreachable — blocked, offline, DNS, CORS, timeout), `http`
  (a 4xx/5xx response), or `parse` (a 2xx body that failed to parse).
  "Broken" is `network`, `parse`, and HTTP `5xx` — a real transport or
  server problem the user should know about; these always surface, with
  no opt-in. Recoverable ones (`network`, HTTP `5xx`) also get a **Retry**
  button that re-fetches only that track; a `parse` failure is
  deterministic, so its badge carries no Retry. A track whose data is
  merely **missing** — an HTTP `4xx` such as a 404 "no data for this
  accession" — is treated exactly like an empty 2xx response: the track
  is hidden, with no badge, no `protvista-error` event, and no panel.
  There is no flag to surface 4xx; "missing" is deliberately invisible. A
  collapsed group whose tracks (all or some) are broken shows a summary
  badge on its header, so failures aren't hidden behind the collapse.
- **`protvista-error` event.** A bubbling `CustomEvent('protvista-error',
  { detail: { phase, issues, context } })` fires for every *broken* error
  (a 4xx "missing" fires nothing), so embedders route errors into their
  own UI with one listener. `phase` is one of `config` / `sequence` /
  `track-fetch` / `set-track-data` / `transform-calculate` /
  `tooltip-field-miss`; for `track-fetch`, `context.errorKind` carries
  the `network` / `http` / `parse` classification.

Also adds `strict?: boolean` (promote every warning to the mount panel;
default `false`) and a tree-shakeable, lazily-loaded `src/errors/format.ts`
issue formatter (its own ~0.3 kB gzip chunk — the happy path never loads
it). See the _Error events_ section in `specs/config-approach.md`.

Two fixes make the per-track error surfacing actually reach the screen:

- **Error-only groups are now revealed.** Groups render `display: none` by
  default and are shown imperatively only once they have data. A group
  whose data all failed to load (e.g. Variants when its API is blocked)
  therefore rendered its header + ⚠ badge into the DOM but stayed
  `display: none` — it looked like the group had vanished. `updated()`
  now also reveals any group with a visible fetch error.
- **The loader is resilient to a throwing adapter.** The per-track
  pipeline is isolated in `loadProtvistaData`, so an adapter that throws
  on an unexpected payload (e.g. the empty body a blocked/failed fetch
  leaves — the AlphaFold/AlphaMissense parsers are prone to this)
  degrades just that track to empty instead of rejecting the whole load.
  Previously one throwing adapter aborted the batch before the
  error-correlation pass, suppressing *all* badges and events. (Hardening
  those parsers at the source is tracked in
  `specs/alphafold-alphamissense-adapter-hardening.md`.)

### Fixed — `js-yaml` pinned to 4.x; install-time patch removed

A routine dependency refresh had bumped `js-yaml` to 5.2.1, a major that
replaced the package's named/default export shape and removed `Type`,
`DEFAULT_SCHEMA`, and several loader/dumper options. `astro`,
`@astrojs/starlight`, and `@astrojs/internal-helpers` all declare
`js-yaml ^4.1.1`, so the docs build broke on the missing `default`
export, and a `postinstall` step had been added to write one into the
installed package inside `node_modules`.

`js-yaml` is now pinned to **4.3.0**, which satisfies that same
`^4.1.1` range — the tree dedupes to a single copy and the patch is
gone, along with the `postinstall` hook and `scripts/patch-js-yaml.mjs`.
This also removes two hazards: writing into `node_modules` corrupts the
shared global store under package managers that hardlink from it (pnpm),
and because `scripts/` is not in `files`, publishing with a `postinstall`
would have failed every consumer's install on a missing file.

One behavioural change follows. A YAML document with no content — blank,
whitespace, or comments only — is handled differently by the two majors
(4.x returns `undefined`/`null`, 5.x throws). `parseConfigText` now pins
this itself and rejects with a `SyntaxError`, so the contract no longer
depends on which `js-yaml` is installed. A bare `---` still parses to
`null` and is rejected by validation, as before.

Also corrected: the parser was documented as pinning `SAFE_SCHEMA`, a
name that exists in no shipped `js-yaml`. It has always used
`CORE_SCHEMA` — the narrowest schema available, with no `!!js/*` tags —
which is what the docs and constraint C4 now say, and what a new test
asserts.
