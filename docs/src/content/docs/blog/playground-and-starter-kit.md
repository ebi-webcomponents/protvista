---
title: "Bring your own data: the Playground and Starter Kit are live"
description: A guided walkthrough of the new tools for visualizing your own protein annotations alongside UniProt's — no coding required.
---

Research groups routinely maintain their own annotations — hotspot regions,
custom domain calls, lab-specific variant lists — that live in a spreadsheet,
disconnected from the sequence context that gives them meaning. Displaying
that data alongside UniProt's own domains and variants has historically
required a developer to write an adapter. As of this release, it requires a
CSV file and a text box.

ProtVista is EMBL-EBI's protein feature viewer: the `<protvista-uniprot>`
component embedded across UniProt, rendering domains, variants, PTMs,
structure coverage, and AlphaFold confidence as tracks along a sequence. This
release, funded by the Research Software Maintenance Fund, was built
specifically for researchers who are *not* developers.

**In this walkthrough:**

1. [The playground](#1-the-playground-explore-before-you-commit) — explore before you commit to anything
2. [Loading your own data](#2-loading-your-own-data-a-csv-walkthrough) — a complete CSV walkthrough
3. [Customizing the layout](#3-customizing-the-layout-without-editing-a-config-file) — without editing a config file
4. [The Starter Kit](#4-the-starter-kit-publishing-what-youve-built) — publishing what you've built

## 1. The playground: explore before you commit

Start with the [playground](/protvista/playground/). It presents two panels:
a configuration editor on the left, and a live viewer on the right. Enter a
UniProt accession — your protein of interest, or the reference example used
throughout this walkthrough, [`P05067`](https://www.uniprot.org/uniprotkb/P05067)
— and every built-in track renders: domains, natural variants, PTMs,
structure coverage, and AlphaFold confidence. Edit the configuration and
press **Run** to see the result immediately, with validation errors
underlined as you type rather than surfacing later.

Every view in the playground is recorded in the page's URL — a preset, an
edited configuration, a different accession — so sharing an exact setup is
straightforward. Send a colleague the link, and they open precisely what you
were looking at, not a screenshot that needs explaining.

:::tip[Try it live]
Open the [default viewer for P05067](/protvista/playground/#preset=uniprot-default&accession=P05067)
and swap the accession in the header to view any other protein.
:::

## 2. Loading your own data: a CSV walkthrough

This is usually the first thing people want to do, so let's cover it in
full — from a spreadsheet of hotspots your lab identified to a track
rendered on the actual protein sequence. Four steps, no code.

### Step 1: Prepare your data as a CSV

Structure one row per feature, with a header row. Three columns are
required; two are optional:

| Column | Required | What it holds |
| --- | --- | --- |
| `type` | Required | A short label for the kind of feature — for example `DOMAIN`, `BINDING`, `REGION`, or `MUTAGEN`. This is your own vocabulary; ProtVista does not restrict it. |
| `start` | Required | First residue position, counting from 1. |
| `end` | Required | Last residue position. Equal to `start` for a single-residue feature. |
| `description` | Optional | Free text, displayed when a user hovers over or clicks the feature. |
| `score` | Optional | A numeric value — a confidence score, an effect size, or any figure you track. |

`hotspots.csv`:

```csv
type,start,end,description,score
DOMAIN,18,289,Extracellular domain (custom re-annotation),0.95
BINDING,132,140,Predicted heparin-binding site,0.87
REGION,290,340,Acidic-rich linker region,0.6
```

Export this directly from Excel, Google Sheets, or whatever spreadsheet tool
your lab already uses — no reformatting is required beyond these five
columns.

### Step 2: Place the file alongside your page

Save `hotspots.csv` in the same location as your viewer's HTML page —
typically a `data/` folder next to `index.html`. If you're working from the
Starter Kit, covered in Section 4, that folder is already in place.

### Step 3: Reference it from your configuration

The configuration is a short YAML (or JSON) file that describes what the
viewer should display. Add one entry to its `rows:` list:

`config.yaml`:

```yaml
accession: P05067
rows:
  - id: hotspots
    label: Hotspots
    kind: features
    data: ./data/hotspots.csv
```

`kind: features` tells ProtVista that this row draws feature blocks along
the sequence. The `.csv` extension on `data:` selects the parser
automatically — there is no separate adapter setting to configure. The same
rule applies to `.tsv`, `.json`, and `.bed` files: the extension determines
how the file is read. See [Load your own data](/protvista/your-data) for the
full field reference across every format.

### Step 4: Load the configuration and verify the result

Point the viewer at the configuration file. With the Starter Kit this is
already wired up; on a page you're building yourself, it is a single
attribute:

```html
<protvista-uniprot config-src="./config.yaml"></protvista-uniprot>
```

Reload the page, and a new **Hotspots** track appears beneath the sequence.
If the track is empty, the cause is almost always the issue below.

:::caution[A common point of confusion]
The path in `data: ./data/hotspots.csv` is resolved against the **page**,
not against `config.yaml` itself. If a track renders but stays empty,
confirm the file is located where the page expects it, or open the
browser's developer console (usually <kbd>F12</kbd>), which reports the
exact row or column responsible for a parsing failure.
:::

That completes the workflow for a standalone track. To layer your data on
top of UniProt's full set of tracks instead of displaying it alone, `extends`
the canonical config and add the same row — see
[Author a config](/protvista/configure#reuse-the-default-with-extends) for
the merge rules. The four steps above are otherwise unchanged.

## 3. Customizing the layout without editing a config file

Once your data is on screen — your own track, UniProt's, or both — there's
no need to return to the configuration just to rearrange what's displayed.
Every viewer, whether in the playground, a Starter Kit page, or an embedded
instance, now includes a **Customize** button beside the navigation.

### Step 1: Enter Customize mode

Selecting **Customize** turns each row's label into a set of controls. The
tracks themselves stay in place and reflow live as you make changes, so
nothing is obscured while you work.

### Step 2: Reorder and show or hide, at any level

Every row and every track has a move-up / move-down control and a show/hide
toggle. Moving or hiding a group's header affects the whole group at once;
an individual track can be reordered only within its own group, or hidden
independently. Every control operates identically with a mouse, a
touchscreen, or a keyboard — there is no drag gesture to reproduce.

### Step 3: Hidden is not deleted

A hidden row or track collapses to a dimmed placeholder rather than
disappearing, and its Show control remains reachable. Outside Customize
mode, an **"N hidden"** indicator beside the Customize button reports how
much is currently tucked away; selecting it re-enters Customize mode and
opens every group holding something hidden, so the relevant controls are
never more than one click away.

### Step 4: Reset, or confirm and continue

**Reset** restores the authored layout exactly. There is no separate save
action otherwise — **Done** simply exits Customize mode, and the
arrangement you made is already in effect.

The resulting layout persists automatically the next time the same viewer is
opened on the same protein, and it is also encoded in a shareable
`?layout=` link — the same mechanism the playground uses to share whole
configurations. A request such as "move Variants above Domains" becomes a
link to send, rather than a set of instructions to repeat.

:::tip[See it in action]
Open the [playground](/protvista/playground/), load the default UniProt
viewer for `P05067`, select **Customize**, and try reordering or hiding a
track. The full implementation detail is available in the pull request:
[ebi-webcomponents/protvista#240](https://github.com/ebi-webcomponents/protvista/pull/240).
:::

## 4. The Starter Kit: publishing what you've built

The playground is designed for exploration. The **Starter Kit** is where
that exploration becomes a page you keep. It is a template repository on
GitHub — select **Use this template**, and you receive a page, a
`config.yaml`, and a `data/` folder already wired together, so much of the
walkthrough in Section 2 is already done for you.

1. Select **Use this template** and name your copy.
2. Replace the sample file in `data/` with your own CSV, TSV, JSON, or BED
   file, and update `config.yaml` to match, following the same steps
   described in Section 2.
3. Enable GitHub Pages in the repository settings. Your viewer becomes a
   live, shareable web page within a few minutes — no build step, no
   `npm install`, and no JavaScript to write.

A GitHub Action included in the template validates `config.yaml` against
ProtVista's published schema on every push, surfacing a mistyped field as a
failed check rather than a support request later on.

:::caution[Worth noting]
Enabling GitHub Pages publishes everything in `data/` along with the page.
Treat the repository accordingly, and keep any data that shouldn't be
public out of that folder.
:::

Ready to start? [Use the Starter Kit](https://github.com/ebi-webcomponents/protvista-starter-kit),
or see [Author tooltips](/protvista/data-tooltip) to add richer detail to
your own data's tooltips first.

## Matching your site's visual style

A viewer that clashes with the surrounding page can look unfinished. An
optional `theme:` block recolors the chrome — the row labels, and the
accent used for focus rings and the active row — directly from the
configuration file, with no CSS required:

```yaml
theme:
  labelColor: '#e8f5e9'
  accentColor: '#2e7d32'
```

For teams that prefer to style from their own stylesheet instead, the full
set of [CSS custom properties and `::part` hooks](/protvista/theming) is
documented as well — the configuration option above is simply the no-code
path to the same result.

## Where to go next

New to ProtVista? Begin with the [Tutorial](/protvista/tutorial) — the same
ground as this walkthrough, in more depth.

- [Tutorial](/protvista/tutorial) — empty page to custom, themed viewer, in four steps.
- [Load your own data](/protvista/your-data) — CSV, TSV, JSON, BED, and inline, the full field reference.
- [Playground](/protvista/playground/) — edit any configuration live and share it by link.
- [Starter Kit](https://github.com/ebi-webcomponents/protvista-starter-kit) — use this template, add your data, publish.
- [Source & issues](https://github.com/ebi-webcomponents/protvista) — questions, bugs, and feature requests.
- [Office hours](https://github.com/ebi-webcomponents/protvista/blob/next/CONTRIBUTING.md#office-hours) — monthly live help with setup and your own data, no registration required.

---

This work is part of ProtVista's [three-year sustainability roadmap](https://github.com/ebi-webcomponents/protvista/blob/next/ROADMAP.md),
supported by the Research Software Maintenance Fund, managed by the Software
Sustainability Institute and funded by UKRI grant reference AH/Z000114/1.
Code is licensed under the MIT License; documentation and sample data are
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
