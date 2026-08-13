# ProtVista viewer configuration

ProtVista mounts its categories and tracks dynamically from a **viewer
configuration**. By default it uses the built-in UniProt configuration
([`src/config.ts`](../src/config.ts)); integrators can replace it entirely to
show their own tracks, their own data sources, or a mixture of both.

## Two separate contracts

ProtVista's architecture deliberately separates two things that are easy to
conflate:

1. **Viewer configuration** — _what the viewer mounts_: the list of
   categories, the tracks inside each category, which Nightingale element
   renders each track, where the data comes from (URLs), and rendering
   options (colours, shapes, scales). This contract is owned by ProtVista and
   formally described by
   [`schema/protvista-config.schema.json`](../schema/protvista-config.schema.json)
   (JSON Schema 2020-12, CC BY 4.0).

2. **Track payloads** — _what each data source returns_: the JSON documents
   fetched from the configured URLs. Their shape is **not** part of the
   configuration schema. Each payload must match what the track's `adapter`
   expects (or, when no adapter is set, the native input format of the
   Nightingale track element). Payload contracts are owned by the data
   provider and the adapter, and are documented per adapter below.

If you are embedding ProtVista: you control contract 1 and must supply data
conforming to contract 2.

## Supplying a configuration

There are two ways to provide a configuration:

### `config-src` attribute (no code)

```html
<protvista-uniprot
  accession="P05067"
  config-src="./config.json"
></protvista-uniprot>
```

The viewer fetches the JSON file, validates it, and mounts the described
tracks. On a fetch error or validation failure it reports every problem on
the console (with a JSON pointer to each offending value) and falls back to
the built-in UniProt configuration.

### `config` property (JavaScript)

```js
const viewer = document.querySelector('protvista-uniprot');
viewer.config = myConfigObject;
```

Setting the property programmatically is the escape hatch for advanced
integrations (dynamically generated configs, custom validation flows, etc.).

You can validate a configuration yourself before use:

```js
import { validateConfig, formatConfigErrors } from 'protvista-uniprot';

const result = validateConfig(myConfigObject);
if (!result.valid) {
  console.error(formatConfigErrors(result.errors));
}
```

Tooling that speaks JSON Schema (editors, CI checks, form generators) can use
`schema/protvista-config.schema.json` directly; adding a `$schema` field to
your config file enables live validation in most editors.

## Configuration structure

```jsonc
{
  "categories": [
    {
      "name": "MY_CATEGORY", // unique id
      "label": "My category", // shown in the category row
      "trackType": "nightingale-track-canvas",
      "tracks": [
        {
          "name": "my-track",
          "label": "My track",
          "trackType": "nightingale-track-canvas",
          "tooltip": "What this track shows",
          "filter": "DOMAIN", // keep only features of this type
          "data": [
            {
              "url": "./data/my-features.json", // {accession} is substituted
              "adapter": "feature-adapter",
            },
          ],
        },
      ],
    },
  ],
}
```

Key points:

- **Order matters**: categories and tracks render in the order listed.
- **`{accession}`** in any `url` is replaced with the viewer's accession, so
  one configuration serves every protein.
- **Relative URLs** resolve against the embedding page — local files work.
- **`filter`** lets several tracks share one data source, each showing a
  different feature type.
- Rendering options (`color`, `shape`, `scale`, `color-range`) can be set on
  a category (default for its tracks) or per track (override).

### Supported track types

| `trackType`                    | Renders                                   |
| ------------------------------ | ----------------------------------------- |
| `nightingale-track-canvas`     | positional features (domains, sites, …)   |
| `nightingale-interpro-track`   | InterPro entries with member DB matches   |
| `nightingale-colored-sequence` | per-residue scalar values as colour       |
| `nightingale-variation-canvas` | variants (position × alternative residue) |
| `nightingale-linegraph-track`  | line graphs (e.g. variant counts)         |
| `nightingale-sequence-heatmap` | position × class heatmaps                 |

### Built-in adapters and their payload contracts

| `adapter`                             | Expected payload                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `feature-adapter`                     | [Proteins API features](https://www.ebi.ac.uk/proteins/api/doc/) (`{ features: [] }`) |
| `variation-adapter`                   | Proteins API variation                                                                |
| `variation-graph-adapter`             | Proteins API variation (aggregated into counts)                                       |
| `structure-adapter`                   | PDBe best structures / UniProt cross-references                                       |
| `proteomics-adapter`                  | Proteins API proteomics (peptides)                                                    |
| `proteomics-ptm-adapter`              | Proteins API PTM proteomics (PTMeXchange)                                             |
| `interpro-adapter`                    | InterPro API entry payload                                                            |
| `alphafold-confidence-adapter`        | AlphaFold API confidence payload                                                      |
| `alphamissense-pathogenicity-adapter` | AlphaFold API AlphaMissense payload                                                   |
| `alphamissense-heatmap-adapter`       | AlphaFold API AlphaMissense payload (heatmap form)                                    |
| `rna-editing-adapter`                 | Proteins API RNA editing                                                              |
| `rna-editing-graph-adapter`           | Proteins API RNA editing (aggregated)                                                 |

When `adapter` is omitted the payload is passed to the track element
unchanged, which is the escape hatch for data already in a Nightingale-native
format.

## Try it

The [Starter Kit](../starter-kit/) is a complete, working example of a custom
configuration mixing a local data file with a public API track — copy it and
edit the JSON.
