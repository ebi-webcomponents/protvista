# Isoform support: demo pages (hackathon project F8)

The mapper (`src/utils/isoform-map.ts`) and the built-in
`uniprot-isoforms-json` adapter live in `src/`, with tests. These pages load
the published build from jsDelivr and can't import `src/`, so
`isoforms-adapter.js` is a plain-JavaScript twin of the built-in adapter: keep
the two in step. The projection onto one isoform (`canonicalToIsoformMap`,
`projectFeatures`, `projectTo`, used by `gold.html`) exists only here for now
(Milestone 3). `demos/` is not a folder the repo builds, lints or tests.

## Run it

You need an internet connection (the viewer loads from jsDelivr and the data
from UniProt and the Proteins API) and any static web server. From the repo
root:

```sh
cd demos/isoforms
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open:
- http://localhost:8000/?acc=P05067 : APP, 11 rows (the canonical and 10 isoforms); APP695 (`P05067-4`) has a gap at 290–364
- http://localhost:8000/?acc=P10636 : tau, 9 rows
- http://localhost:8000/?acc=P42771 : CDKN2A, 4 rows (its 2 External ARF isoforms are skipped)
- http://localhost:8000/gold.html : tau-441 (Tau-F, `P10636-8`) with canonical annotations projected onto it; P301L lands at 301 and the repeats R1–R4 at 244–274, 275–305, 306–336 and 337–368

The canonical row is blue and each isoform row grey. A gap is a deleted
segment; dark ticks on the bar mark replaced residues, including insertions
(a replacement longer than the original, e.g. `V → VPPV`). The tooltip names
the isoform and lists its edits, e.g. `P05067-4 (APP695): 289: E → V;
290-364: missing`; the canonical row names any External isoforms it leaves out.

Expand the **Isoforms** row (or **Canonical annotations on Tau-F**) to see
the tracks. Opening the HTML file directly (`file://`) does not work.

The rows are thin: the pages load the published `protvista-uniprot@5.0.0-beta.5`,
which ignores `rendering.height`. Zoom in to read them.

## Files

| File | What it is |
| --- | --- |
| `isoforms-adapter.js` | Plain-JS twin of the built-in `uniprot-isoforms-json` adapter. `isoformEdits(entry)` joins each isoform's `sequenceIds` to the VAR_SEQ features (a deletion is `alternativeSequence: {}`); `uniprotIsoforms(entry)` is the escape-hatch adapter that returns one feature per non-External isoform, canonical included, with gaps for deletions and marks for replacements; `canonicalToIsoformMap()`, `projectFeatures()` and `projectTo(isoformId)` project canonical features onto one isoform, dropping those it lacks entirely and noting in the description those it partly lacks. |
| `main.js` | Isoform-rows page script: registers `uniprot-isoforms` through `viewer.adapters`, then sets a config with an isoforms track, the VAR_SEQ track and domains. `?acc=` picks the protein (default P05067). |
| `gold.js` | Tau-441 page script: registers `project-to-isoform` and shows repeats, regions, variants and modified residues from `/features/P10636` in Tau-F numbering. Each track label gives the number of canonical features of its type that Tau-F lacks (e.g. 5 of 30 variants). |
| `index.html`, `gold.html` | Pages adapted from `starter-kit/index.html`. An import map points the scripts' `import 'protvista-uniprot'` at the jsDelivr build, so there is no bundling step. |

Offline copies of the data, for tests, are in
[`src/__fixtures__/isoforms/`](../../src/__fixtures__/isoforms/) (see its
`PROVENANCE.md`).
