---
title: Load your own data
description: "How to load your own data into ProtVista: choose a format (CSV, TSV, JSON or BED) and give your data the shape a track needs."
---

ProtVista isn't limited to UniProt. Most tracks can read your own annotations
from a **CSV, TSV, JSON, or BED** file, from a URL, or written straight into the
config. This page shows the shape your data needs and how to point a track at
it.

You keep the same `kind:` either way. `kind: variants` draws variants whether
the records come from the UniProt API or from your spreadsheet — the kind picks
the renderer, the tooltips, and the colours; your file only has to carry the
records. Which records depends on what the track draws, and there are three
shapes in all:

| Shape | Required columns | Used by |
| --- | --- | --- |
| [Feature record](#the-feature-record) | `type`, `start`, `end` | `features`, `interpro-features`, `peptides`, `peptides-ptm`, `structure-coverage` |
| [Point record](#a-line-graph-of-your-own-values) | `position`, `value` | `linegraph`, `variant-counts`, `rna-editing-counts` |
| [Variation record](#your-own-variants) | `position`, `variant` | `variants`, `rna-editing` |

Kinds named for a provider — `alphafold-confidence`,
`alphamissense-pathogenicity`, `alphamissense-heatmap` — read that provider's
feed only; see [Built-in track kinds](/protvista/track-kinds).

Your protein isn't in UniProt? Give the config a `sequence:` instead of an
`accession:` — see [Proteins outside UniProt](/protvista/sequence-only).

## The feature record

A `features` track draws a list of **feature records**. Each record has:

| Field | Required | Meaning |
| --- | --- | --- |
| `type` | yes | A label/category for the feature (e.g. `DOMAIN`, `BINDING`). Also what `filter:` matches on. |
| `start` | yes | 1-based start position (inclusive), a whole number. |
| `end` | yes | 1-based end position (inclusive), a whole number no less than `start`. |
| `description` | CSV/TSV: yes | Free text shown on hover/click. A CSV or TSV file must have a `description` **column** in its header row, though its cells may be empty; a file whose header is only `type,start,end` is rejected. Optional in JSON. |
| `score` | no | A number, typically 0–1, for quality or confidence. |
| `color` | no | This feature's colour — any CSS colour (`#1f77b4`, `steelblue`, `rgb(…)`). Wins over the track's `rendering.color`. |
| `shape` | no | This feature's glyph, one of the [shape names](/protvista/type-and-shape-vocabulary). Wins over the track's `rendering.shape`. A value that names a JavaScript built-in (`valueOf`, `constructor`, …) is dropped with a `track-data` warning, so the feature takes the track's or type's shape. |
| `fill` | no | This feature's fill colour, when it should differ from `color`. |
| `opacity` | no | A number from 0 to 1 (default 0.9). |

Any other column is kept on the record for `dataTooltip` — see
[Style and annotate each feature from your file](#style-and-annotate-each-feature-from-your-file).
BED files carry only the first five fields.

A machine-readable version is published as
[`feature-record.schema.json`](https://ebi-webcomponents.github.io/protvista/schema/v1/feature-record.schema.json).
The [Adapter reference](/protvista/adapter-reference) lists every record shape,
which kinds draw it, and which encodings can carry it.

`type` isn't free text once it's drawn: ProtVista recognises 45 type names
(UniProt feature types plus a few for peptides, epitopes and structure
coverage), each with its own default colour and shape, and anything else
renders as a black rectangle. See
[Feature type and shape vocabulary](/protvista/type-and-shape-vocabulary) for
the full list, what an unrecognised type looks like, and the 22 `rendering.shape`
values.

## Pick a format — the extension chooses the parser

Point `data:` at a file and the **file extension says how it is encoded**,
while the track's `kind` says what the records are. Between them there is
nothing left to configure.

The extension always chooses a parser your track's `kind` can use: `.csv` on a
`kind: features` track reads feature records, `.csv` on a `kind: linegraph`
track reads `position,value` points. The `kind` says what the track *is*; the
extension says what your file *looks like*. Pair a kind with a format that
can't carry its records — `kind: variants` at a `./x.bed`, since BED only holds
feature records — and the config is rejected with a message naming both sides,
rather than the track quietly coming up empty.

### CSV

A header row plus one row per feature. This example is a single standalone track
(one `rows:` entry with `data:` and no group):

```yaml
accession: P05067
rows:
  - id: hotspots
    label: Hotspots
    kind: features
    data: ./hotspots.csv
    description: Hotspot regions identified by our lab's pipeline
```

```csv
type,start,end,description,score
DOMAIN,18,289,Extracellular domain (custom re-annotation),0.95
BINDING,132,140,Predicted heparin-binding site,0.87
REGION,290,340,Acidic-rich linker region,0.6
```

### TSV

Same columns, tab-separated. Use a `.tsv` extension:

```yaml
rows:
  - id: MY_LAB
    label: My lab
    tracks:
      - id: hotspots
        kind: features
        data: ./hotspots.tsv
```

#### Spreadsheet exports

ProtVista reads commas (`.csv`) and tabs (`.tsv`) only, and the format alone
decides which — it never guesses from the content. Excel's "CSV" export in many
European locales writes semicolons instead, so save the sheet as **Text (Tab
delimited)** and read it as TSV (if your text has accented letters, see the
encoding note below). Excel names that file `.txt`, so say the encoding
outright with `format:`, which works whatever the name:

```yaml
data:
  url: ./hotspots.txt
  format: tsv
```

Renaming the file to `.tsv` works too.

A few more things to check when the file comes from Excel or was edited on
Windows:

- **Accented text.** Excel's plain "CSV" and "Text (Tab delimited)" exports
  use the computer's legacy encoding, so accented letters and symbols in
  `description` come out garbled. Choose **CSV UTF-8 (Comma delimited)**
  instead. If your Excel writes semicolons even then (common where the decimal
  separator is a comma), export the sheet as CSV or TSV from Google Sheets or
  LibreOffice instead. "Unicode Text" (UTF-16) can't be read at all: it fails
  as if the header were missing.
- **Decimal points, not commas.** In a CSV, `0,95` splits into two cells and
  the row fails as ragged (`expected 5 columns, got 6`); in a TSV it fails with
  `expected a number`. Use `0.95`.
- **Check the real file name.** Windows hides extensions by default, so a file
  saved from Notepad as `hotspots.csv` may really be `hotspots.csv.txt`. Turn
  on **View → File name extensions** in File Explorer.
- **Match the case of the name exactly.** Windows treats `Hotspots.csv` and
  `hotspots.csv` as the same file; a web server such as GitHub Pages does not.

If a file's header looks like it uses a different separator from the one its
format implies, the missing-column error also names the separator the header
seems to use and the fix:

```
./hotspots.csv (parsed as CSV): missing required header column "type". Header must contain type, start, end, description[, score]. The header looks semicolon-separated, which ProtVista does not read. …
```

The same locales also write decimal commas (`0,5`). Those still fail as
`expected a number, got "0,5"`, so change them to `0.5`.

### JSON

An array of feature-record objects. Use a `.json` extension:

```yaml
rows:
  - id: MY_LAB
    label: My lab
    tracks:
      - id: hotspots
        kind: features
        data: ./hotspots.json
```

```json
[
  { "type": "DOMAIN", "start": 18, "end": 289, "description": "Extracellular domain" },
  { "type": "BINDING", "start": 132, "end": 140, "score": 0.87 }
]
```

### BED

Standard tab-delimited [BED](https://en.wikipedia.org/wiki/BED_(file_format)) —
a common genomics format for interval/region data. Use a `.bed` extension:

```yaml
rows:
  - id: MY_LAB
    label: My lab
    tracks:
      - id: hotspots
        kind: features
        data: ./regions.bed
        rendering:
          color: '#2e86c1'
          shape: roundRectangle
```

BED has no type column, so every record gets `type: BED`. That isn't one of
the [recognised types](/protvista/type-and-shape-vocabulary), so without the
`rendering` block above every region draws as a black rectangle.

## Style and annotate each feature from your file

Add a `color` column and each feature is painted on its own, so `DOMAIN` rows
can be blue and `BINDING` rows red in the same track. Add any other column —
a reference, a gene name, a link — and a [`dataTooltip`](/protvista/data-tooltip)
can show it:

```yaml
accession: P05067
rows:
  - id: MY_LAB
    label: My lab
    tracks:
      - id: hits
        label: Styled hits
        kind: features
        data: ./hits.csv
        rendering:
          color: '#7f7f7f'
        dataTooltip:
          kind: markdown
          template: |
            **{% $description %}** ({% $type %}, {% $start %}–{% $end %})

            PMID {% $pmid %} · {% link href=$url %}PubMed{% /link %}
```

```csv
type,start,end,description,color,pmid,url
DOMAIN,18,189,E1 domain,#1f77b4,12345678,https://pubmed.ncbi.nlm.nih.gov/12345678/
BINDING,132,140,Predicted heparin-binding site,#d62728,23456789,https://pubmed.ncbi.nlm.nih.gov/23456789/
REGION,290,340,Acidic-rich linker region,,,
```

(The PubMed IDs are placeholders.) For a runnable variant, see
[`examples/csv-styled/`](https://github.com/ebi-webcomponents/protvista/tree/next/examples/csv-styled):
the same track and pattern, with a lab-notebook `ref` column in place of
`pmid`, a "Read more" link, and one more `DOMAIN` row.

How it works:

- **Which colour wins.** A feature's own `color` / `shape` wins over the
  track's `rendering:`, which wins over the default for its `type`. A blank
  cell leaves the field off, so the `REGION` row above is drawn in the track's
  grey. The same goes for `fill` and `opacity`.
- **Colours must be valid CSS colours.** The canvas cannot paint a typo like
  `bleu` or `#catFace`, and draws that feature in the *previous* feature's
  colour instead. The viewer keeps the value but reports a `track-data`
  warning naming it (in the console, on the
  [`protvista-error` event](/protvista/troubleshooting), and in the
  playground). The check doesn't know every modern CSS colour, so `oklch(…)`
  also warns, though it paints fine.
- **`opacity` must be a number from 0 to 1.** Anything else fails the track,
  naming the row.
- **Every other column is kept as written**, as text — a blank cell is an
  empty string — so a template can use it as `{% $pmid %}` and a `fields` list
  as `path: pmid`. `{% link href=$url %}…{% /link %}` turns a URL column into a
  link; a row whose URL is empty, or not an `http(s):` / `mailto:` / `/…` /
  `#…` / `?…` URL, shows the text without one. A protocol-relative
  `//host/…` value counts as `/…` and links to that host. Name columns like identifiers (`gene_name`,
  `p-value`): a template cannot reference a name with a space in it, a
  `fields` path cannot reach one with a dot, and `$ctx` is reserved for the
  tooltip context.
- **A few names cannot come from a file.** `tooltipContent`, `locations`,
  `residuesToHighlight`, and names JavaScript reserves (`toString`,
  `constructor`, `__proto__`, …) are dropped from CSV/TSV/JSON files and from
  inline text read with `format:`, with a `track-data` warning naming them.
  Records written straight into the config with `from: inline` (and
  `setTrackData()` arrays) are trusted and may still set them.
- **JSON files work the same way**: `color`, `shape` and `fill` must be
  strings and `opacity` a number, and any other key is kept as it is, nested
  objects included.
- **BED files can't carry any of this.** Their columns are positional; use the
  track's `rendering:` instead.

Column names are matched exactly: `Color` is just another column, not a colour.

## Your data next to public data

Files and URLs mix freely. Here a live UniProt track sits above your own file:

```yaml
accession: P05067
sources:
  features: https://www.ebi.ac.uk/proteins/api/features/{accession}
rows:
  - id: UNIPROT_DOMAINS
    label: UniProt domains
    tracks:
      - id: domain
        kind: features
        filter: DOMAIN
        data: features
  - id: MY_LAB
    label: My lab
    tracks:
      - id: hotspots
        kind: features
        data: ./hotspots.json
```

## Inline data — no file at all

For small or generated data, write records directly in the config with
`from: inline`:

```yaml
rows:
  - id: MY_ANNOTATIONS
    label: My custom annotations
    tracks:
      - id: binding_sites
        label: Predicted binding sites
        kind: features
        data:
          from: inline
          inlineData:
            - { type: BINDING, start: 45, end: 52, description: ATP binding }
            - { type: BINDING, start: 120, end: 128, description: Mg2+ binding }
        rendering:
          color: '#e74c3c'
          shape: diamond
```

`shape` is one of 22 shape names (19 of which the canvas track draws), and this `rendering` block applies to
every feature in the `binding_sites` track — see
[Feature type and shape vocabulary](/protvista/type-and-shape-vocabulary) for
the full set, and for how this replaces `BINDING`'s own default colour and
shape. A record's own `color` / `shape` (say `{ type: BINDING, start: 45, end:
52, color: '#2e86c1' }`) wins over `rendering` for that one feature, exactly as
a `color` column does in a file.

## A line graph of your own values

The `kind: linegraph` setting draws a line graph from a JSON array of `{ position, value }` records: `position` is a whole number, `value` any number.

```yaml
accession: P05067
rows:
  - id: depth
    label: Read depth
    kind: linegraph
    data: https://my-lab.example/api/depth/{accession}
    description: Per-residue read depth from our pipeline
```

```json
[
  { "position": 1, "value": 12 },
  { "position": 2, "value": 15 },
  { "position": 3, "value": 9 }
]
```

Points are drawn in the order you supply them, so sort your records by `position` before serving them — nothing sorts them for you or rejects duplicates.

A malformed row fails with your own filename, the reading applied to it, and the offending row and column:

```
./depth.csv (parsed as CSV): row 3, column "value": expected a number, got "abc".
```

The same record shape works inline — `from: inline` with `inlineData:` — so a graph can render with no fetch at all. See [`examples/linegraph/`](https://github.com/ebi-webcomponents/protvista/tree/next/examples/linegraph), or open **Your own line graph (inline values)** in the [playground](/protvista/playground/).

The `kind` decides what the records are, so `data: ./depth.json` on a `kind: linegraph` track is read as line-graph points rather than generic features — nothing to name, nothing to configure.

Where an extension can't tell us — a URL with no filename, or records pasted straight into the config — say the encoding outright:

```yaml
data:
  url: https://my-lab.example/api/depth/{accession}
  format: json
```

The same records work as delimited text, which is usually what falls out of a spreadsheet or an analysis script. On a `kind: linegraph` track the extension picks the parser — `.csv` and `.tsv` read a `position,value` header row and produce exactly the graph the JSON form does:

```yaml
- id: depth
  label: Read depth
  kind: linegraph
  data: ./depth.csv
```

```csv
position,value
1,412
30,688
60,905
```

Columns may be in either order, extra columns are ignored (graph points have no per-point tooltip to show them in, unlike feature records), and a malformed cell fails naming your file, the reading, the row and the column (`./depth.csv (parsed as CSV): row 3, column "value": expected a number, got "abc"`). Note the records come from the `kind`: the same `./x.csv` on a `kind: features` track is read as feature records instead. (A track needs a `kind` or a `component`; one with neither is rejected as `missing-track-renderer`.)

`kind: variant-counts` and `kind: rna-editing-counts` read the same
`position,value` records, so a count you computed yourself renders on the same
track the UniProt counts would.

### Per-residue conservation

A conservation score per residue is a natural line graph. The
[`examples/conservation/`](https://github.com/ebi-webcomponents/protvista/tree/next/examples/conservation)
example, also the [conservation preset](/protvista/playground/#preset=conservation)
in the playground, draws real scores for rubredoxin (P24297, 54 residues) from
the Pfam PF00301 family alignment. It shows them beside a `SITE` track of the
most conserved residues and UniProt's own binding sites, and UniProt's four
iron-binding cysteines have the four highest scores.

The scores are generated by a script in the repository, and
[`PROVENANCE.md`](https://github.com/ebi-webcomponents/protvista/tree/next/examples/conservation/PROVENANCE.md)
records the method, the releases and the checksums. When you read them:

- **They are within one family.** They measure conservation across the Pfam
  domain family, not a whole-protein evolutionary rate.
- **Rare residues score higher.** The score (Jensen–Shannon divergence from a
  background distribution) rewards rare residues, so an invariant cysteine or
  tryptophan outscores an invariant leucine.
- **The ends have no score.** Residues outside the Pfam domain (1–3 and 50–54
  here) get no point, and the line covers only the scored stretch.
- **The y-axis is fitted to the data**, not to 0–1.
- **The line has no hover.** Graph points have no tooltip, so the example puts
  each top residue's score in its `SITE` feature's `score` column and shows it
  with a [`dataTooltip`](/protvista/data-tooltip): a `kind: features` track's
  own tooltip lists only type, description, start and end.

## Your own variants

`kind: variants` is the kind the UniProt viewer uses for its variation track.
Point it at a file and it reads your calls instead — same track, same hover
detail, same filter widget.

```yaml
accession: P05067
rows:
  - id: cohort_variants
    label: Cohort variants
    kind: variants
    data: ./my-variants.csv
    description: Missense variants called in our patient cohort
```

```csv
position,wildType,variant,description,consequence
672,D,N,Observed in 3 of 48 cohort samples,missense
692,K,N,Recurrent in early-onset subgroup,missense
723,T,*,Premature stop in one carrier,stop_gained
```

| Field | Required | Meaning |
| --- | --- | --- |
| `position` | yes | 1-based position of the changed residue, a whole number. |
| `variant` | yes | The residue it changes to. `*` for a stop, `-` for a deletion. |
| `wildType` | no | The original residue. Shown on hover and used to label the change. |
| `description` | no | Free text shown on hover/click. |
| `consequence` | no | Your own consequence label (e.g. `missense`), shown on hover. |

The same records work as `.tsv`, or as `.json` with one object per change:

```json
[
  { "position": 672, "wildType": "D", "variant": "N", "description": "3 of 48 samples" },
  { "position": 723, "wildType": "T", "variant": "*", "consequence": "stop_gained" }
]
```

Your file doesn't carry the protein sequence — the viewer already fetched it for
`accession:` and supplies it, which is what lets the track lay out one row per
residue. With a [`sequence:`](/protvista/sequence-only) config, the residues
come from your `sequence:` instead.

`kind: rna-editing` reads exactly the same shape.

## Add to the default UniProt viewer

To layer your track on top of the full canonical viewer instead of building from
scratch, `extends` the default — see the `extends` section in
[Author a config](/protvista/configure#reuse-the-default-with-extends). (Note the caveat
there: the built-in `/src/default-config.yaml` path only resolves during local
development — host your own copy for a deployed site.)

## A path gotcha to know

A track's `data: ./hotspots.csv` is fetched **relative to the hosting page**, not
relative to the config file. If a file-backed track renders empty, this is the
usual cause: the browser looked for the file next to your HTML page. Serve the
page from the same directory as the data (or use an absolute URL). The runnable
[`examples/`](https://github.com/ebi-webcomponents/protvista/tree/next/examples)
each carry their data file beside the config for exactly this reason — see
[`examples/README.md`](https://github.com/ebi-webcomponents/protvista/blob/next/examples/README.md).

## Try your file in the playground

You don't have to host a file to see it render. In the
[playground](/protvista/playground/), press **Load data file…** (or drop the
file onto the config editor) and pick a CSV, TSV, JSON or BED file (or a FASTA
file, to set `sequence:`). It is read in your browser and never uploaded. Only its *name* goes into the config, and
so into any link you share: the playground adds a track with
`data: ./hits.csv`, exactly as a config next to the real file would say it.

- A file whose extension doesn't say how to read it (`hits.txt`, `export.tab`)
  asks you to choose a format, and the config gets `format:` to match:
  `data: { url: ./hits.txt, format: csv }`. A `.csv` whose header is
  tab-separated is offered as `tsv` the same way, and the new track's `kind`
  follows the header's columns (`position,value` makes a line graph).
- In a config that `extends:` another, a new track's id ends in `-local`
  (`PTM.csv` becomes `PTM-local`), so it can't replace a base row with the
  same id.
- If the config already names the file — say you pasted a Starter Kit config
  with `data: ./data/hits.csv` — just load `hits.csv`. It renders in that
  track with no edit to the config.
- A `.fasta`, `.fa`, `.faa` or `.fas` file — or any other file, bar a CSV,
  TSV, JSON or BED one, whose first non-blank line starts with `>` — becomes
  the config's `sequence:` instead of a track (see
  [Try your FASTA in the playground](/protvista/sequence-only#try-your-fasta-in-the-playground)).
  So does any file the config's `sequence:` already names. Otherwise raw
  residues with no `>` line are read as data, so give them a `.fasta` name or
  a header line.
- Problems with the file are listed under the editor, naming it: a parse error
  (`./hits.csv (parsed as CSV): row 3, column "start": …`) with the same advice
  a hosted viewer gives, and, once it renders, any rows that fall outside the
  protein.

The file stays loaded until you reload the page. A shared link carries only the
name, so whoever opens it is asked to load the file themselves. After fixing the
file on disk, load it again to pick up the change.

## Custom columns or formats

If your file doesn't match the feature-record columns — different headings, a
bespoke format — you can register your own parser with `registerAdapter` and
name it on the track. See [Escape hatches](/protvista/escape-hatches).

## Ask an AI to write your config

Give the assistant your protein accession, the tracks you want, your data
file name and its column headers, and any tooltip or colour requirements.
Attach the [Config authoring documentation](https://ebi-webcomponents.github.io/protvista/_llms-txt/config-authoring.txt)
so it can read the instructions and examples directly. You can also provide
the [documentation index](https://ebi-webcomponents.github.io/protvista/llms.txt)
and the [config schema](https://ebi-webcomponents.github.io/protvista/schema/v1/config.schema.json).

Providing the config schema does not guarantee a working config.
For example, an AI may use an unresolved preset name such as `default`
in `extends`, omit required fields, or reference an undeclared source.
Provide the full Config authoring documentation alongside your request
so the assistant has the instructions and examples available.
Treat any AI-generated config as a draft: results vary by prompt and
assistant, so always verify the output in the playground.

Always paste the config into the [playground](https://ebi-webcomponents.github.io/protvista/playground/)
and load your sample file with **Load data file…**. Check the listed errors
and warnings, confirm that the requested tracks appear in the right order,
and test any tooltips, links and visibility controls before using it on your page.

## Where to go next

- [Configuration vs data](/protvista/configuration-vs-data) — the boundary this page sits on.
- [Adapter reference](/protvista/adapter-reference) — exact payload shapes.
- [Feature type and shape vocabulary](/protvista/type-and-shape-vocabulary) — what each `type` looks like, and every `shape`.
- [Proteins outside UniProt](/protvista/sequence-only) — your own sequence instead of an accession.
- [Troubleshoot errors](/protvista/troubleshooting) — when a track won't load.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
