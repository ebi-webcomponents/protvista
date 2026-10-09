---
title: Proteins outside UniProt
description: "You can use ProtVista without a UniProt accession by providing your own custom protein sequence—via a FASTA file, inline text, or raw residues—to visualize custom annotation tracks entirely independently of UniProt."
---

ProtVista normally starts from a UniProt accession: it fetches the entry's
sequence, then draws tracks against it. A predicted protein, a synthetic
construct, a patient-specific variant or an unreviewed assembly has no
accession — so give the viewer the sequence itself instead.

```yaml
sequence: ./my-protein.fasta
rows:
  - id: hotspots
    label: Hotspots on {accession}
    kind: features
    data: ./hotspots.csv
```

With `sequence:` set, the viewer draws the navigation, the sequence and every
track that reads your own data. It makes **no request of its own**: no UniProt
entry, no structure panel. The runnable
[`examples/sequence-only/`](https://github.com/ebi-webcomponents/protvista/tree/next/examples/sequence-only)
is exactly this config, with its FASTA file and data beside it.

## When to use it

Use `sequence:` when the protein you want to annotate is not a UniProt entry,
or when the viewer must not reach UniProt at all. If your protein *is* in
UniProt, use `accession:` — you get the sequence, the structure panel and every
UniProt track for free, and you can still [add your own
tracks](/protvista/your-data).

It suits a short protein too. The
[small-peptide preset](/protvista/playground/#preset=small-peptide) shows
Trp-cage, a designed 20-residue miniprotein, from its own sequence with its
secondary structure from a CSV file.

`accession:` and `sequence:` are alternatives: set one, never both. Pairing your
own sequence with UniProt annotations would place UniProt's coordinates on a
sequence they don't describe.

## Three ways to give the sequence

**A FASTA file** — a path or URL to a file with one record:

```yaml
sequence: ./my-protein.fasta
```

The path is fetched relative to the hosting page, like a
[data file](/protvista/your-data#a-path-gotcha-to-know), when the config loads.
A bare name with a FASTA extension (`.fasta`, `.fa`, `.faa`, `.fas`) works too.

**Inline FASTA** — written as a YAML literal block, with `|`:

```yaml
sequence: |
  >my construct v2
  MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQ
```

Use `|`, not `>`. YAML's folded `>` joins the lines into one, so the residues
end up inside the header and the viewer reports that the sequence "has no
residues".

The [own-sequence preset](/protvista/playground/#preset=own-sequence) is this
form, with its track's records written inline too, so it makes no request at
all. Paste your own FASTA over the block, or load a `.fasta` file (below).

**Raw residues** — just the letters:

```yaml
sequence: MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQ
```

In every form, whitespace and line breaks are ignored, letters are uppercased,
and one trailing `*` (a stop) is dropped. Residues are the one-letter codes
A–Z. A FASTA file must hold exactly one record.

The FASTA header is the protein's name: the viewer shows it wherever it would
show an accession — `{accession}` in a label, the "No feature data available
for …" message, and warnings about your data. A header longer than 80
characters is cut short; with no header, the name is "your sequence".

## Which tracks work

Every track that reads your own data:

- a file or URL of your own — CSV, TSV, JSON or BED, on any kind with a record
  shape (`features`, `linegraph`, `variants`, …); see
  [Load your own data](/protvista/your-data);
- inline data written into the config;
- a `from: custom` source filled by `setTrackData()`.

A `kind: variants` track takes its residues from your `sequence:`, just as it
takes them from the entry in accession mode.

These need UniProt, and are rejected when the config loads:

- any data URL that uses `{accession}` — including every source in the default
  UniProt config;
- the AlphaFold and AlphaMissense kinds (`alphafold-confidence`,
  `alphamissense-pathogenicity`, `alphamissense-heatmap`), or an explicit
  `adapter:` that reads those feeds;
- a label that *links* to an `{accession}` URL, such as
  `[AlphaFold](https://alphafold.ebi.ac.uk/entry/{accession})`. `{accession}`
  in plain label text is fine: it becomes your FASTA header.

To show per-residue scores you computed yourself — pLDDT from your own
structure prediction, say — use [`kind: linegraph`](/protvista/your-data#a-line-graph-of-your-own-values)
with a `position,value` file.

## Start from a blank config

`extends:` the default UniProt config won't work: nearly every track in it
needs UniProt. Write the rows you want from scratch. If a config does extend
it, every inherited track that needs UniProt is listed, followed by a summary
saying to start from a blank config instead.

## The error messages

Every problem with a `sequence:` config is a config error. It shows in the
viewer's error panel, logs one console line, and fires a `protvista-error`
event with `phase: 'config'`, `severity: 'error'` and each problem in
`detail.issues` (see [Troubleshoot errors](/protvista/troubleshooting)):

| `code` | Message |
| --- | --- |
| `accession-and-sequence` | `This config sets both 'accession:' and 'sequence:'. Use 'accession:' to show a UniProt entry, or 'sequence:' to show your own protein — not both.` When the accession comes from the element's `accession` attribute, the message says so. |
| `needs-accession` | `Track hotspots needs UniProt data: its data URL uses {accession}. With 'sequence:' only file, inline and custom sources work.` The reason may also be `kind 'alphafold-confidence' reads AlphaFold DB data for a UniProt entry` or `its label links to a UniProt-keyed URL ({accession})`. |
| `invalid-sequence` | `./my-protein.fasta (parsed as FASTA): contains 2 records; the viewer shows one protein. …` — or an invalid character with its residue position, or no residues at all. An inline value that looks like a file name (`protein.txt`) is told to write it as `./protein.txt`. |
| `cannot-resolve-sequence` | `Could not load the sequence file './my-protein.fasta': HTTP 404 Not Found.` |
| `missing-protein` | `Nothing to show: set 'accession:' (a UniProt entry) or 'sequence:' (your own protein), or the element's accession attribute.` |

The [playground](/protvista/playground/) checks a `sequence:` config as you
type, inline sequence included, and disables its accession box while the
config sets `sequence:`, itself or through an `extends:` base.

## Try your FASTA in the playground

Press **Load data file…** in the [playground](/protvista/playground/) (or drop
the file onto the config editor) and pick a one-record FASTA file: `.fasta`,
`.fa`, `.faa` or `.fas`, or any other file whose first non-blank line starts
with `>` (a `.csv`, `.tsv`, `.json` or `.bed` file is read as data, unless the
config's `sequence:` names it). It is read in your browser and never uploaded.
Only its *name* goes into the config — `sequence: ./my-protein.fasta` — so
neither the residues nor the header reach a link you share.

If the config already names the file, as
[`examples/sequence-only/`](https://github.com/ebi-webcomponents/protvista/tree/next/examples/sequence-only)
does, it just loads — whatever its name, so a `seq.txt` of raw residues
works too. Otherwise you choose where it goes:

- **This config** sets its `sequence:` (replacing an inline one) and removes
  `accession:`, keeping your tracks. Tracks that need UniProt are then listed
  as `needs-accession` errors.
- **A new sequence-only config** replaces the editor text with one that names
  only your file. Press Ctrl/Cmd+Z in the editor to get the old config back.

A file the viewer would reject — two records, a character outside A–Z, no
residues — is not loaded, and the playground shows the `invalid-sequence`
message a hosted viewer would. A file over 2 MB, the most a hosted viewer
fetches, is refused too. Someone who opens a shared link is asked to load the
file themselves: until they do, the playground lists `local-file-missing`, and
the preview pane, which shows no preview, says which file to load. If your header is a UniProt one
(`>sp|P01542|…`), the protein is in UniProt: `accession: P01542` gives you its
UniProt tracks as well.

## Your coordinates are still checked

Rows that fall outside your sequence — a start below 1, or an end past the last
residue — load and render as written, with a `track-data` warning on the
console and the `protvista-error` event that names your FASTA header:

```
./hotspots.csv (parsed as CSV): 1 of 5 rows fall outside my construct v2 (240 residues); first: row 4, end 812. …
```

See [Common coordinate mistakes](/protvista/troubleshooting#common-coordinate-mistakes).

## Offline and air-gapped use

With `sequence:` the viewer itself contacts no server: no UniProt, no
AlphaFold, no structure lookups. The only requests are for the files your
config names — the FASTA file and your data files, fetched relative to the
page — so a page and its files on an internal server, or on disk behind a
local web server, need no internet access. Inline sequence and inline data
need no requests at all.

For fully offline use, also host the viewer yourself rather than loading it
from a CDN: serve the package's `dist/` folder, which holds the component and
the lazily loaded YAML parser chunk it fetches for a YAML config.

## Limits

These are out of scope for `sequence:`:

- isoforms;
- more than one sequence in a viewer;
- structures: no prediction, and no structure panel, for a custom sequence;
- mapping your sequence to a UniProt entry automatically;
- nucleotide sequences — residues are protein one-letter codes.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
