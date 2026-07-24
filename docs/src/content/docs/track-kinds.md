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

| `kind` | What it draws | Typical data |
| --- | --- | --- |
| `features` | Sequence feature regions (domains, chains, binding sites, signal peptides…) drawn as shapes along the sequence. | UniProt features API, or your own CSV/TSV/JSON/BED. |
| `features-interpro` | InterPro domain and family predictions. | InterPro entries API. |
| `variants` | Single-residue variants (amino-acid changes), with disease association. | UniProt variation API. |
| `variant-counts` | A line graph of variant frequency along the sequence. | UniProt variation counts. |
| `rna-editing` | RNA-editing sites, drawn like variants. | UniProt RNA-editing API. |
| `rna-editing-counts` | A line graph of RNA-editing frequency. | UniProt RNA-editing counts. |
| `peptides` | Mass-spectrometry-detected peptides. | UniProt proteomics API. |
| `peptides-ptm` | Post-translational modifications detected by MS. | UniProt proteomics PTM API. |
| `structure-coverage` | Which stretches of the sequence are covered by known 3D structures. | UniProt/PDBe coverage. |
| `confidence-score` | AlphaFold per-residue confidence (pLDDT), drawn as a colour gradient over the sequence. | AlphaFold prediction. |
| `pathogenicity-score` | AlphaMissense average pathogenicity per residue, as a colour gradient. | AlphaMissense average. |
| `pathogenicity-heatmap` | AlphaMissense pathogenicity as a full heatmap (every substitution × position). | AlphaMissense full matrix. |

## Colour scales

The score kinds (`confidence-score`, `pathogenicity-score`) come with
accessibility-reviewed colour ramps built in — AlphaFold's confidence ramp
(orange = low confidence, through to blue = very high) and AlphaMissense's
benign-to-pathogenic scale (blue = benign, through to red = pathogenic). You can
define and apply your own ramps; see [Theme the viewer](/protvista/theming) and
[Escape hatches](/protvista/escape-hatches) (`registerTheme`).

## Using a kind with your own data

Most kinds default to an EBI/UniProt API, but `features` is the one you'll most
often point at your own file — its data is the generic **feature record**
(`type`, `start`, `end`, and optional `description`/`score`). See
[Load your own data](/protvista/your-data).

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
