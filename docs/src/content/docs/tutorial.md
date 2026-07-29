---
title: Tutorial
description: "Go from an empty page to a custom, themed protein viewer in four steps: add the component, point it at an accession, add your own track from a CSV, and style it."
---

This is the guided, end-to-end path: start from nothing and finish with a
working viewer that shows the full UniProt annotation for a protein **plus your
own track**, recoloured to match your site. It's one continuous example on a
single protein: [`P05067`](https://www.uniprot.org/uniprotkb/P05067), amyloid
precursor protein, the reference accession used throughout these docs.

Each step ends with a **Try it live** link that opens the exact setup in the
[playground](/protvista/playground/), so you can see it render and edit it
without leaving the browser. When you want the full detail behind a step, follow
the links to the how-to guides.

The quickest way to follow along is the
**[Starter Kit](https://github.com/ebi-webcomponents/protvista-starter-kit)**: a
no-build template repository you can copy and open straight in the browser. You
can also work in your own page served by any static file server or your app's dev
server, or use the [playground](/protvista/playground/) for the config-only
steps. No build tooling is required.

:::note
These docs describe the **unreleased 5.0 config surface** (`rows:`, `kind:`,
`extends:`). The current npm release, `protvista-uniprot@4.9.3`, predates it and
will not read the configs below — Step 1 shows how to get a matching build.
:::

## Step 1: Add the component and point it at an accession

`<protvista-uniprot>` is a **web component**: a custom element that works in any
page with no bundler or framework. Load it once and drop the tag in with an
accession:

```html
<script type="module" src="./protvista-uniprot.mjs"></script>

<protvista-uniprot accession="P05067"></protvista-uniprot>
```

`protvista-uniprot.mjs` is the component's built ES-module bundle. Until 5.0 is
published to npm, build it from source and copy it next to your page:

```sh
git clone https://github.com/ebi-webcomponents/protvista
cd protvista
yarn install && yarn build
# then copy dist/protvista-uniprot.mjs next to your HTML page
```

That single attribute gives you the **full default UniProt viewer** for the
protein: domains, variants, binding sites, structure coverage, AlphaFold
confidence, and more. No config required.

:::tip[Try it live]
Open the [default viewer for P05067](/protvista/playground/#preset=uniprot-default&accession=P05067).
Swap the accession in the header to view any other protein.
:::

<!-- TODO(screenshot): the full default UniProt viewer for P05067 — all built-in
     track groups. Capture from the running site; needs descriptive alt text. -->


[Embed the viewer](/protvista/embed) covers both ways to load the component and
every attribute (`config-src`, `notooltip`, `nostructure`, …).

## Step 2: Add your own track from a CSV

Now bring your own annotations. A `features` track can read a **CSV** file
directly: point `data:` at the file and the `.csv` extension picks the parser for
you: no `adapter:` needed.

Say your lab has flagged some hotspot regions. Put them in a CSV with the
feature-record columns `type,start,end,description,score`:

```csv
type,start,end,description,score
DOMAIN,18,289,Extracellular domain (custom re-annotation),0.95
BINDING,132,140,Predicted heparin-binding site,0.87
REGION,290,340,Acidic-rich linker region,0.6
MUTAGEN,614,614,Lab-observed loss-of-function point mutation,0.75
```

Then describe a viewer that shows just that file as one standalone track (a
`rows:` entry with `data:` and no `tracks:` needs no group wrapper):

```yaml
accession: P05067
rows:
  - id: hotspots
    label: Hotspots
    kind: features
    data: ./hotspots.csv
    description: Hotspot regions identified by our lab's pipeline
```

Save the config as `my-config.yaml` next to `hotspots.csv` and point the element
at it:

```html
<protvista-uniprot config-src="./my-config.yaml"></protvista-uniprot>
```

:::caution
`data: ./hotspots.csv` is fetched **relative to the hosting page**, not the
config file. If a file-backed track renders empty, this is the usual cause:
serve the page from the same directory as the data, or use an absolute URL.
:::

:::tip[Try it live]
Open [the CSV track in the playground](/protvista/playground/#preset=csv). It
renders the same config against a hosted copy of `hotspots.csv`.
:::

<!-- TODO(screenshot): the standalone "Hotspots" CSV track rendered on its own. -->


[Load your own data](/protvista/your-data) covers the full feature record and the
TSV, JSON, and BED formats.

## Step 3: Layer it onto the full UniProt viewer

A standalone track is a viewer of its own. More often you want your track *on top
of* everything UniProt already provides. Instead of rebuilding the default
viewer, **`extends`** it: you inherit all its sources, groups, and themes, and
declare only your addition.

The custom data can be simpler here — the default viewer supplies the rest:

```csv
type,start,end,description,score
DOMAIN,18,289,Custom re-annotation of the extracellular domain,0.9
BINDING,614,614,Lab-observed candidate binding residue,0.72
```

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
        description: Hotspot regions identified by our lab's pipeline, layered on top of the canonical UniProt viewer
```

That's the whole config: the full canonical viewer, with a **My lab** group added
at the end.

:::caution
`extends: /src/default-config.yaml` resolves only when the page is served from
this repo's root; a deployed site must point `extends` at a hosted copy instead —
either your own, or the published package on a CDN:
`https://cdn.jsdelivr.net/npm/protvista-uniprot@5.0.0/src/default-config.yaml`
(available once 5.0.0 ships, as above). See
[Author a config](/protvista/configure#reuse-the-default-with-extends) for the
merge rules and the full caveat.
:::

:::tip[Try it live]
Open the [full default viewer](/protvista/playground/#preset=uniprot-default) to
see the base you're extending. To see it combined with your track, switch
`extends:` to the CDN URL above — that form resolves from any page, once 5.0.0
ships.
:::

<!-- TODO(screenshot): the "My lab" group layered on top of the full default
     viewer (captured from `yarn docs:dev`, where the extends path resolves). -->

## Step 4: Style it

Finally, make it yours. There are two levers, no rebuild required.

**No code: from the config.** A `theme:` block recolours the viewer chrome
directly, so an author who doesn't write CSS can still brand the viewer.
`labelColor` sets the row-label panel; the optional `accentColor` sets focus
rings and the datatable's active-row marker:

```yaml
theme:
  labelColor: '#e8f5e9'
  accentColor: '#2e7d32'
```

:::tip[Try it live]
Open the [inline-data preset](/protvista/playground/#preset=inline-data), which
carries a `theme:` block — edit the colours and press **Run**.
:::

**From your page's CSS.** For full control, `<protvista-uniprot>` exposes
`--protvista-*` design tokens and `::part` hooks — set them in ordinary CSS on
the page:

```css
protvista-uniprot {
  --protvista-color-accent: #7b2d8e;
  --protvista-group-label-bg: #efe6f5;
}
```

:::caution
The two levers are not additive: a config `theme:` **wins**. `labelColor` and
`accentColor` are applied as inline styles on the element, so they override page
CSS targeting the same tokens — including both tokens in the example above. Pick
one lever, or force the CSS with `!important`. See
[No-code theming from the config](/protvista/theming#no-code-theming-from-the-config).
:::

[Theme the viewer](/protvista/theming) lists every token and the datatable
`::part` hooks.

<!-- TODO(screenshot): the recoloured viewer after theming (theme.labelColor /
     accentColor, or the CSS custom properties). -->

## You're done

You went from an empty page to a viewer that shows the full UniProt annotation
for a protein, adds your own track from a CSV, and matches your site's colours.

Where to go next:

- [Author a config](/protvista/configure) — every field a config can hold.
- [Load your own data](/protvista/your-data) — TSV, JSON, BED, and inline data.
- [Theme the viewer](/protvista/theming) — the full token and `::part` reference.
- [Configuration vs data](/protvista/configuration-vs-data) — what your config
  controls versus what a data provider supplies.
- [Escape hatches](/protvista/escape-hatches) — custom parsers, kinds, and themes
  when the built-ins aren't enough.
- [Playground](/protvista/playground/) — edit any config live and share it by link.
- [Starter Kit](https://github.com/ebi-webcomponents/protvista-starter-kit) — a
  no-build template repository to copy and go.
- [Runnable examples](https://github.com/ebi-webcomponents/protvista/tree/next/examples)
  — the CI-validated configs this tutorial draws from.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
