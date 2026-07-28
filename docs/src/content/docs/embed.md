---
title: Embed the viewer
---

ProtVista is a **web component**: a custom element, `<protvista-uniprot>`, that
works in any web page or framework without extra setup. This page shows the two
ways to load it and the handful of attributes you'll use most.

## The quickest possible viewer

Point the element at a UniProt accession and you get the full default UniProt
viewer for that protein:

```html
<script type="module" src="./protvista-uniprot.mjs"></script>

<protvista-uniprot accession="P05067"></protvista-uniprot>
```

That's it — no config required. `P05067` is Amyloid precursor protein, the
reference protein used throughout these docs; swap in any UniProt accession.

## Two ways to load the component

### 1. As a module script in a static page

Import the built file as an [ES
module](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules),
then use the tag:

```html
<script type="module" src="./protvista-uniprot.mjs"></script>

<protvista-uniprot accession="P05067"></protvista-uniprot>
```

`protvista-uniprot.mjs` is the built bundle. Until 5.0 is published, produce it
from source with `yarn install && yarn build` in a clone of the
[repository](https://github.com/ebi-webcomponents/protvista) and copy
`dist/protvista-uniprot.mjs` next to your page.

### 2. As an npm package

Install `protvista-uniprot` and import it once — the element self-registers as
`<protvista-uniprot>` on import, so you don't call `customElements.define`
yourself:

```js
import 'protvista-uniprot';
```

```html
<protvista-uniprot accession="P05067"></protvista-uniprot>
```

:::caution
The published release is `protvista-uniprot@4.9.3`, which predates the config
surface these docs describe (`rows:`, `kind:`, `extends:`). Until 5.0 ships,
`npm install` gives you a viewer that will not read the configs in this guide —
build from source as above.
:::

Either way, the tag behaves like any other HTML element — style it, size it,
and place it wherever you like.

## The attributes you'll use

Set these as HTML attributes (or as JavaScript properties on the element).

| Attribute | Type | What it does |
| --- | --- | --- |
| `accession` | string | The UniProt accession to display. Takes precedence over an `accession` in a config. |
| `config-src` | string | URL or path to a **YAML or JSON** config, fetched at mount time. See [Author a config](/protvista/configure). |
| `viewerConfig` | object | A config object (or a YAML/JSON string) assigned as a JS property — there is no matching HTML attribute. An alternative to `config-src` when you already have the config in memory. |
| `nostructure` | boolean | Hides the 3D structure group. |
| `notooltip` | boolean | Suppresses the built-in click tooltip (set this when you render your own — see [Rich tooltips in React](/protvista/react-integration)). |
| `suspend` | boolean | Pauses rendering, e.g. while an accession is about to change. |

## Driving it with your own config

Once you want more than the default UniProt view — your own tracks, your own
data, a different arrangement — point `config-src` at a config file:

```html
<protvista-uniprot config-src="./my-config.yaml"></protvista-uniprot>
```

```yaml
# my-config.yaml
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

This renders a single collapsible group with one track of domain features. Read
[Author a config](/protvista/configure) next to understand each part, or open the
[playground](/protvista/playground/) to
edit a config live and watch it render.

## Browser support

ProtVista needs a modern browser with support for
[ES2021](https://caniuse.com/?search=ES2021) and [Web Components (Custom
Elements v1)](https://caniuse.com/custom-elementsv1): Chrome/Edge 92+,
Firefox 90+, Safari 15+.

## Next steps

- [Author a config](/protvista/configure) — the structure of a config document.
- [Built-in track kinds](/protvista/track-kinds) — what each `kind` draws.
- [Load your own data](/protvista/your-data) — bring a CSV/TSV/JSON/BED file.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
