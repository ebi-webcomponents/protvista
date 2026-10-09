---
title: Author a config
description: "Write the short YAML or JSON file that tells the viewer which tracks to show, and where their data comes from."
---

A **config** is a small document that describes what the viewer should show: the
rows and tracks, where each track's data comes from, and how it's drawn. You
provide it in one of two ways: point `config-src` at a **YAML or JSON** file
(recommended), or assign it to the element's **`viewerConfig`** property (a parsed
object, or a YAML/JSON string). You never name internal components or adapters —
you describe intent with high-level concepts.

## The minimal config

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

This renders one collapsible group, **Domains** (the label is title-cased from
the `id`), containing one track, **Domain**, populated from the `features` URL
(with `{accession}` substituted at fetch time) and narrowed to items whose type
is `DOMAIN`. No `version`, no explicit component, no `label` — minimal configs
collapse to the minimum.

:::tip[Try it live]
Paste any config into the [playground](/protvista/playground/) to validate it as you
type and see it render. Every example below is drawn from the CI-validated
[`examples/`](https://github.com/ebi-webcomponents/protvista/tree/next/examples)
directory.
:::

## The building blocks

### `accession`

The UniProt entry to display. Required unless [`sequence`](#sequence) is set —
the viewer fetches the sequence for this accession before loading any track.
Set one or the other, never both. With neither, the viewer shows a
`missing-protein` error instead of mounting blank.

### `sequence`

Your own protein, for one that isn't in UniProt: use it instead of
`accession`. It takes raw residues, inline FASTA, or a path or URL to a
one-record FASTA file:

```yaml
sequence: ./my-protein.fasta   # fetched relative to the page, like data files
```

```yaml
sequence: |                    # `|`, not `>`: `>` folds the lines into one
  >my construct v2
  MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQ
```

The viewer then makes no request of its own (no UniProt entry, no structure
panel) and shows the FASTA header wherever it would show the accession. Only
tracks that read your own data work; see
[Proteins outside UniProt](/protvista/sequence-only).

### `sources`

A map of named URL templates. Use `{accession}` (or any other
[variable](#variables)) as a placeholder; it's filled in at fetch time. Tracks
refer to a source by its key, so you write the URL once and reuse it:

```yaml
sources:
  features: https://www.ebi.ac.uk/proteins/api/features/{accession}
  variation: https://www.ebi.ac.uk/proteins/api/variation/{accession}
```

### `variables`

Baseline values for other `{tokens}` in your data URLs. The page can override
each one with a `data-*` attribute on the element, so one config can serve
several species, builds or datasets:

```yaml
variables:
  species: human
sources:
  features: https://api.example.org/{species}/features/{accession}
```

```html
<protvista-uniprot accession="P05067" data-species="mouse" config-src="./my-config.yaml"></protvista-uniprot>
```

- Precedence, lowest first: `variables:`, then `data-*` attributes, then the
  `accession` attribute. `{accession}` always comes from `accession`.
- Multi-word attributes are camelCased: `data-dataset-id` fills `{datasetId}`.
- Values are URL-encoded. A value of exactly `.` or `..`, or one with malformed
  Unicode, is refused.
- A token defined nowhere is a `missing-variable` warning. If nothing supplies
  it when the data loads, that URL isn't fetched (a console warning says why)
  and its track is empty.
- Changing a `data-*` attribute on the live element reloads the data.

### `rows`

The list of things to show, top to bottom. A row is **either**:

- a **group** — has a `tracks:` list, and renders as a collapsible section; or
- a **standalone track** — has `data:` directly (no `tracks:`), for a single
  lane with no group wrapper.

```yaml
rows:
  # A group of two tracks
  - id: MOLECULE_PROCESSING
    label: Molecule processing
    tracks:
      - id: signal
        kind: features
        filter: SIGNAL
        data: features
      - id: chain
        kind: features
        filter: CHAIN
        data: features
  # A standalone track (no group)
  - id: hotspots
    label: Hotspots
    kind: features
    data: ./hotspots.csv
```

### `tracks`

Each track needs an `id` and a `kind`, and a `data` source. Common fields:

| Field | Purpose |
| --- | --- |
| `id` | Unique within its group. Also the fallback label. |
| `kind` | The track type — `features`, `variants`, `alphafold-confidence`, … See [Built-in track kinds](/protvista/track-kinds). |
| `data` | Where the data comes from: a `sources` key, a URL, a file path, or inline. See [Load your own data](/protvista/your-data). |
| `filter` | Keep only records of one `type` (e.g. `DOMAIN`). A convenience shortcut. |
| `label` | Human-readable track title. Supports rich inline text. |
| `description` | Longer text shown alongside the track. |
| `rendering` | Visual settings — `color`, `shape`, `height`, `layout`, `colorScale`. See [`rendering`](#rendering). |
| `hidden` | `true` ships the track hidden: a visitor can reveal it from **Customize**. Also valid on a group. See [Customize the layout](/protvista/customize-layout#authoring-a-row-or-track-hidden-hidden). |

### `kind`

The `kind` is a **domain concept**, not a component name. `kind: features` draws
feature regions; `kind: variants` draws single-residue variants;
`kind: alphafold-confidence` draws an AlphaFold confidence ramp. Each kind knows
which internal component and data adapter to use, so you don't. See the full list
in [Built-in track kinds](/protvista/track-kinds).

### `data`

Points a track at its data. It can be:

- a **`sources` key** — `data: features`;
- a **URL** — `data: https://example.org/regions.csv`;
- a **file path** — `data: ./hotspots.csv` (the format is inferred from the
  extension); or
- **inline** — the records written directly in the config.

The [Load your own data](/protvista/your-data) guide covers each in detail.

### `rendering`

How a track looks. Set it on a track, on a group (its tracks inherit it), or
under `defaults:` for every track. Each field is resolved separately, and the
first of these that sets it wins: the track, its `kind`, its group, then
`defaults:`.

The `kind` step matters for `colorScale`: `alphafold-confidence` and
`alphamissense-pathogenicity` bring their own ramp, which beats a group's or
`defaults:` `colorScale`. A `colorScale` on such a group colours only the
group's collapsed row; to recolour the track itself, set it on the track.

| Field | What it does | Where it has an effect |
| --- | --- | --- |
| `color` | The colour of every feature the track draws. A feature's own `color` column wins. | Feature tracks |
| `shape` | The glyph of every feature the track draws, one of the [shape names](/protvista/type-and-shape-vocabulary). A feature's own `shape` column wins. | Feature tracks |
| `height` | The track's height in pixels. Unset, a feature track is 40 px tall, a line graph 50, a coloured sequence 13, a heatmap 300 and the variant plot 500. On a group, it also sizes the collapsed row. | Every track |
| `layout` | `non-overlapping` (the default) gives overlapping features a row each; `default` draws them all on one row. | Feature tracks |
| `colorScale` | A colour gradient: a `theme` (`alphafold-ramp`, `alphamissense-ramp`) or explicit `stops`. | Coloured-sequence tracks (`alphafold-confidence`, `alphamissense-pathogenicity`) |

The rows of a `non-overlapping` track share its height, so ten overlapping
features (isoforms, say) get thin rows at the default 40 px. Give them room:

```yaml
  - id: isoforms
    label: Isoforms
    kind: features
    data: ./isoforms.csv
    rendering:
      height: 120
```

`height` under `defaults:` sizes every track, whatever its kind.

`color`, `shape`, `layout` or `colorScale` on a track that can't use it does
nothing, and the validator says so with a `rendering-field-ignored` warning.
In particular, a feature track has no colour scale: to colour features by
score, give each one a `color` column ([Style and annotate each feature from
your file](/protvista/your-data#style-and-annotate-each-feature-from-your-file)).

## Editor autocomplete

Point your YAML/JSON editor at the published schema for validation and
autocomplete as you write:

```yaml
# yaml-language-server: $schema=https://ebi-webcomponents.github.io/protvista/schema/v1/config.schema.json
```

## Reuse the default with `extends`

To keep the entire canonical UniProt viewer and just add something of your own,
`extends` it — you inherit all its sources, groups, and themes, and only declare
your additions:

```yaml
accession: P05067
extends: /src/default-config.yaml
rows:
  - id: MY_LAB
    label: My lab
    tracks:
      - id: hotspots
        kind: features
        data: ./hotspots.csv
```

:::caution
`/src/default-config.yaml` resolves only when the page is served from the
repository root (e.g. the dev server, `pnpm start`). A deployed site does not
serve `src/`, so an embedder who copies this verbatim gets a 404. For anything
beyond local development, point `extends` at your own hosted copy of the config,
or at the published package on a CDN:

```yaml
extends: https://cdn.jsdelivr.net/npm/protvista-uniprot@5.0.0-beta.5/dist/default-config.yaml
```

That path is served straight from the npm tarball, so pin an exact version — a
config written against one release is not guaranteed to merge cleanly into
another.
:::

## Where to go next

- [Load your own data](/protvista/your-data) — the `data` descriptor in full.
- [Built-in track kinds](/protvista/track-kinds) — every `kind` and what it draws.
- [Configuration vs data](/protvista/configuration-vs-data) — what your config controls
  versus what a data provider must supply.
- The normative, field-by-field reference is
  [`specs/config-approach.md`](https://github.com/ebi-webcomponents/protvista/blob/next/specs/config-approach.md).

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
