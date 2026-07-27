---
title: Author a config
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

The protein to display. Required — the viewer fetches the sequence for this
accession before loading any track, even for fully local data.

### `sources`

A map of named URL templates. Use `{accession}` as a placeholder; it's filled in
at fetch time. Tracks refer to a source by its key, so you write the URL once and
reuse it:

```yaml
sources:
  features: https://www.ebi.ac.uk/proteins/api/features/{accession}
  variation: https://www.ebi.ac.uk/proteins/api/variation/{accession}
```

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
| `kind` | The track type — `features`, `variants`, `confidence-score`, … See [Built-in track kinds](/protvista/track-kinds). |
| `data` | Where the data comes from: a `sources` key, a URL, a file path, or inline. See [Load your own data](/protvista/your-data). |
| `filter` | Keep only records of one `type` (e.g. `DOMAIN`). A convenience shortcut. |
| `label` | Human-readable track title. Supports rich inline text. |
| `description` | Longer text shown alongside the track. |
| `rendering` | Visual overrides — `color`, `shape`, `height`, `layout`, `colorScale`. |

### `kind`

The `kind` is a **domain concept**, not a component name. `kind: features` draws
feature regions; `kind: variants` draws single-residue variants;
`kind: confidence-score` draws an AlphaFold confidence ramp. Each kind knows
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
repository root (e.g. the dev server, `yarn start`). A deployed site does not
serve `src/`, so an embedder who copies this verbatim gets a 404. For anything
beyond local development, point `extends` at your own hosted copy of the config,
or at the published package on a CDN:

```yaml
extends: https://cdn.jsdelivr.net/npm/protvista-uniprot@5.0.0/src/default-config.yaml
```

That path is served straight from the npm tarball, so pin an exact version — a
config written against one release is not guaranteed to merge cleanly into
another. It resolves once 5.0.0 is published; see the release note on the
[tutorial](/protvista/tutorial).
:::

## Where to go next

- [Load your own data](/protvista/your-data) — the `data` descriptor in full.
- [Built-in track kinds](/protvista/track-kinds) — every `kind` and what it draws.
- [Configuration vs data](/protvista/configuration-vs-data) — what your config controls
  versus what a data provider must supply.
- The normative, field-by-field reference is
  [`specs/config-approach.md`](https://github.com/ebi-webcomponents/protvista/blob/next/specs/config-approach.md).

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
