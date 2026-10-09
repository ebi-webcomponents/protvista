---
title: Embed the viewer
description: "<protvista-uniprot> is embedded as a web component either via CDN or an npm package, configured using HTML attributes like 'accession' and 'config-src', or driven by custom YAML and JSON configurations."
---

ProtVista is a **web component**: a custom element, `<protvista-uniprot>`, that
works in any web page or framework without extra setup. This page shows the two
ways to load it and the handful of attributes you'll use most.

## The quickest possible viewer

Point the element at a UniProt accession and you get the full default UniProt
viewer for that protein:

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/npm/protvista-uniprot@5.0.0-beta.5/dist/protvista-uniprot.mjs"
></script>

<protvista-uniprot accession="P05067"></protvista-uniprot>
```

That's it — no config required. `P05067` is Amyloid precursor protein, the
reference protein used throughout these docs; swap in any UniProt accession.

## Two ways to load the component

### 1. As a module script in a static page

Import the built file as an [ES
module](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules),
then use the tag. The simplest source is a CDN, which serves the published v5
beta with nothing to install:

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/npm/protvista-uniprot@5.0.0-beta.5/dist/protvista-uniprot.mjs"
></script>

<protvista-uniprot accession="P05067"></protvista-uniprot>
```

Pin the exact version, as above: `@beta` and `@5` would move under you as the
beta develops.

To host the file yourself instead, clone the `next` branch of the
[repository](https://github.com/ebi-webcomponents/protvista)
(`git clone --branch next https://github.com/ebi-webcomponents/protvista`; the
default branch, `main`, is the 4.x line), run `pnpm install`, then
`pnpm build`, copy the
**contents** of `dist/` next to your page, and point the tag at your own copy
(`src="./protvista-uniprot.mjs"`). Copy the whole folder: the build is split up,
so the `.mjs` loads sibling files from the same directory and will not run
alone.

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
A plain `npm install protvista-uniprot` gives you `4.9.x` — the current stable
release, which predates the config surface these docs describe (`rows:`,
`kind:`, `extends:`) and will not read the configs in this guide. That stays
true for as long as v5 is in beta, because the beta publishes under the `beta`
dist-tag rather than `latest`. Install the beta explicitly with
`npm install protvista-uniprot@beta`, or build from source as above.
:::

Either way, the tag behaves like any other HTML element — style it, size it,
and place it wherever you like.

#### Other entry points

The package root defines the whole viewer. These subpaths load less:

| Import | What you get |
| --- | --- |
| `protvista-uniprot/config` | `filterConfig` and `colorConfig` — the variant filter and colour config — with no element and no side effects. Use it when you only need the data, e.g. to filter variants in your own UI. |
| `protvista-uniprot/structure` | Defines `<protvista-uniprot-structure>` alone — the 3D structure viewer and its table — without the track viewer. Its attributes are `accession`, `no-table`, `selected-id` and `color-theme`. |
| `protvista-uniprot/react` | Types only: JSX declarations for both elements (see [Rich tooltips in React](/protvista/react-integration#typing-the-elements-in-jsx)). |

## The attributes you'll use

Set these as HTML attributes (or as JavaScript properties on the element).

| Attribute | Type | What it does |
| --- | --- | --- |
| `accession` | string | The UniProt accession to display. Takes precedence over an `accession` in a config. Leave it off for a config that sets [`sequence:`](/protvista/sequence-only): the two together are an error (`accession-and-sequence`). |
| `config-src` | string | URL or path to a **YAML or JSON** config, fetched at mount time. See [Author a config](/protvista/configure). |
| `data-*` | string | Fills a `{token}` in the config's data URLs: `data-species="mouse"` fills `{species}`, `data-dataset-id` fills `{datasetId}`. Overrides the config's `variables:` defaults. `{accession}` always comes from the `accession` attribute (or the config's `accession:`), so `data-accession` has no effect. Changing one on the live element reloads the data. |
| `viewerConfig` | object | A config object (or a YAML/JSON string) assigned as a JS property — there is no matching HTML attribute. An alternative to `config-src` when you already have the config in memory. |
| `nostructure` | boolean | Hides the 3D structure group. |
| `notooltip` | boolean | Suppresses the built-in click tooltip (set this when you render your own — see [Rich tooltips in React](/protvista/react-integration)). |
| `suspend` | boolean | Holds off loading (and rendering) until it is removed, e.g. while you configure the element or an accession is about to change. |
| `quiet-notices` | boolean | Turns off the visitor notices: the quiet ⓘ that tells a visitor when what they see is incomplete (features outside the sequence, colours not painted, a track whose data couldn't be loaded). See [What visitors and authors see](/protvista/troubleshooting#what-visitors-and-authors-see). |
| `show-warnings` | boolean | Author mode: lists every warning on its track or beside Customize, with the console's text, and expands error badges and the error panel. Same as `showWarnings: true` in the config. Off by default. |
| `adapters` | object | A map of adapter name to function, assigned as a JS property — the declarative form of `registerAdapter()`. May be set before the element is defined. See [Escape hatches](/protvista/escape-hatches). |

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
