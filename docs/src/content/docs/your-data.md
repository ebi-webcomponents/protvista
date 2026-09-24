---
title: Load your own data
---

ProtVista isn't limited to UniProt. A `features` track can read your own
annotations from a **CSV, TSV, JSON, or BED** file, from a URL, or written
straight into the config. This page shows the shape your data needs and how to
point a track at it.

## The feature record

A `features` track draws a list of **feature records**. Each record has:

| Field | Required | Meaning |
| --- | --- | --- |
| `type` | yes | A label/category for the feature (e.g. `DOMAIN`, `BINDING`). Also what `filter:` matches on. |
| `start` | yes | 1-based start position (inclusive). |
| `end` | yes | 1-based end position (inclusive). |
| `description` | no | Free text shown on hover/click. |
| `score` | no | A number, typically 0–1, for quality or confidence. |

A machine-readable version is published as
[`feature-record.schema.json`](https://ebi-webcomponents.github.io/protvista/schema/v1/feature-record.schema.json).
The [Adapter reference](/protvista/adapter-reference) documents the shape for every
built-in kind and adapter.

## Pick a format — the extension chooses the parser

Point `data:` at a file and the **file extension selects the parser** for you.
No `adapter:` needed.

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
```

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

## A line graph of your own values

The `kind: linegraph` setting draws a line graph from a JSON array of `{ position, value }` records (both numbers).

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

Points are drawn in the order you supply them, so sort your records by `position` before serving them — the adapter neither sorts them nor rejects duplicates.

Malformed rows fail with an error naming the row index and field.

The same record shape works inline — `from: inline` with `inlineData:` — so a graph can render with no fetch at all. See [`examples/linegraph/`](https://github.com/ebi-webcomponents/protvista/tree/next/examples/linegraph), or open **Your own line graph (inline values)** in the [playground](/protvista/playground/).

`kind: linegraph` also wins over the usual extension inference, so a `.json` file path works without naming the adapter — `data: ./depth.json` is read as line-graph records, not generic features. Name the adapter explicitly only on a track that has no `kind`:

```yaml
data:
  url: ./depth.json
  adapter: linegraph
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

Columns may be in either order, extra columns are ignored, and a malformed cell fails with the row and column named (`linegraph-csv: row 3, column "value": expected a number, got "abc"`). Note this only applies to a track that declares the `kind` — a bare `data: ./x.csv` with no `kind` still means generic features.

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

## Custom columns or formats

If your file doesn't match the feature-record columns — different headings, a
bespoke format — you can register your own parser with `registerAdapter` and
name it on the track. See [Escape hatches](/protvista/escape-hatches).

## Where to go next

- [Configuration vs data](/protvista/configuration-vs-data) — the boundary this page sits on.
- [Adapter reference](/protvista/adapter-reference) — exact payload shapes.
- [Troubleshoot errors](/protvista/troubleshooting) — when a track won't load.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
