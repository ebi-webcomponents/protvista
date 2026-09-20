---
title: Built-in track kinds
---

A track's `kind` says *what it is* in domain terms — features, variants, a
confidence ramp — and ProtVista maps it to the right renderer and data adapter
for you. Write `kind: features`, not a component name.

This page lists every built-in kind. For the exact data shape each one consumes,
see the [Adapter reference](/protvista/adapter-reference); for the boundary between what
your config controls and what the data must provide, see
[Configuration vs data](/protvista/configuration-vs-data).

## The kinds

A kind's name tells you whether you can bring your own data to it:

- **A plain domain word** — `features`, `variants`, `peptides` — takes a file
  from you as readily as it takes a provider API. Point `data:` at your CSV,
  TSV, or JSON and the kind reads it.
- **A name that starts with a provider** — `alphafold-confidence`,
  `alphamissense-heatmap` — reads that provider's feed and nothing else. Those
  tracks are assembled from two API responses plus a further fetch, which no
  single file can stand in for.

| `kind` | What it draws | Your own data | Typical provider |
| --- | --- | --- | --- |
| `features` | Sequence feature regions (domains, chains, binding sites, signal peptides…) drawn as shapes along the sequence. | `.csv` `.tsv` `.json` `.bed` | UniProt features API |
| `interpro-features` | InterPro domain and family predictions. | `.csv` `.tsv` `.json` `.bed` | InterPro entries API |
| `variants` | Single-residue variants (amino-acid changes), with disease association. | `.csv` `.tsv` `.json` | UniProt variation API |
| `variant-counts` | A line graph of variant frequency along the sequence. | `.csv` `.tsv` `.json` | UniProt variation counts |
| `rna-editing` | RNA-editing sites, drawn like variants. | `.csv` `.tsv` `.json` | UniProt RNA-editing API |
| `rna-editing-counts` | A line graph of RNA-editing frequency. | `.csv` `.tsv` `.json` | UniProt RNA-editing counts |
| `linegraph` | A line graph of numeric values you supply, one per position. | `.csv` `.tsv` `.json`, or inline | — (yours by design) |
| `peptides` | Mass-spectrometry-detected peptides. | `.csv` `.tsv` `.json` `.bed` | UniProt proteomics API |
| `peptides-ptm` | Post-translational modifications detected by MS. | `.csv` `.tsv` `.json` `.bed` | UniProt proteomics PTM API |
| `structure-coverage` | Which stretches of the sequence are covered by known 3D structures. | `.csv` `.tsv` `.json` `.bed` | UniProt/PDBe coverage |
| `alphafold-confidence` | AlphaFold per-residue confidence (pLDDT), drawn as a colour gradient over the sequence. | — | AlphaFold prediction |
| `alphamissense-pathogenicity` | AlphaMissense average pathogenicity per residue, as a colour gradient. | — | AlphaMissense average |
| `alphamissense-heatmap` | AlphaMissense pathogenicity as a full heatmap (every substitution × position). | — | AlphaMissense full matrix |

Three record shapes cover every "your own data" cell above — features
(`type,start,end`), points (`position,value`), and residue changes
(`position,variant`). Which one a kind reads follows from what it draws, so
`variants` and `rna-editing` share one, and every feature kind shares another.

## Colour scales

The score kinds (`alphafold-confidence`, `alphamissense-pathogenicity`) come with
accessibility-reviewed colour ramps built in — AlphaFold's confidence ramp
(orange = low confidence, through to blue = very high) and AlphaMissense's
benign-to-pathogenic scale (blue = benign, through to red = pathogenic). You can
define and apply your own ramps; see [Theme the viewer](/protvista/theming) and
[Escape hatches](/protvista/escape-hatches) (`registerTheme`).

## Using a kind with your own data

Swap the `data:` and keep everything else. The kind still decides the renderer,
the tooltips, and the colours — only the parser changes:

```yaml
# The UniProt variation API…
- id: variants
  kind: variants
  data: variation

# …and your own calls, same kind, same track.
- id: variants
  kind: variants
  data: ./my-variants.csv
```

Pair a kind with a format it has no parser for — `kind: alphafold-confidence`
at a `./x.csv` — and the config is rejected before anything loads, with a
message naming the kinds that *do* read that format. See
[Load your own data](/protvista/your-data) for each shape's columns.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
