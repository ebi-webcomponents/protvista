---
title: "Put your own protein data on screen: ProtVista 5 is in beta"
description: A configuration file now does what used to take a developer — load your own annotations beside UniProt's, rearrange the view, and publish it, without writing code.
---

Research groups keep annotations of their own — hotspot regions, custom domain
calls, lab-specific variant lists — and they usually sit in a spreadsheet, away
from the sequence context that makes them mean something. Putting them on screen
next to UniProt's domains and variants used to need a developer.

ProtVista 5 is now in beta, and it doesn't. This release is for the people
looking at proteins rather than the people building viewers: everything below
happens in a configuration file, a button, or a template repository.

:::tip[Bring your data to the ProtVista hackathon — 7–9 October 2026]
Three free days online, working directly with the developers to get your own
datasets into ProtVista and shape how they are visualised. **30 places, first
come first served. Applications close 1 October 2026.**

[Apply now](https://www.ebi.ac.uk/training/events/protvista-hackathon/)
:::

<!-- TODO(screenshot): the money shot — a custom "Hotspots" track rendered
     beneath UniProt's own domains and variants on P05067. Capture from the
     running site at 400x300, 72dpi; needs descriptive alt text and a caption
     crediting the source, licensed CC BY 4.0 like the rest of the docs. -->

## Load your own data

Save your annotations as CSV, TSV, JSON, or BED, and name the file in a
configuration document. The extension picks the parser, so there is nothing else
to wire up:

```yaml
accession: P05067
rows:
  - id: hotspots
    label: Hotspots
    kind: features
    data: ./hotspots.csv
```

That is the whole change. Your track appears alongside everything UniProt
already shows, and the same file works whether you are viewing one protein or
a hundred. Data sources are yours to choose too — nothing in the viewer assumes
EMBL-EBI's, so a group running its own API can point every row at it.

**Learn more:** [Load your own data](/protvista/your-data) covers all four
formats and the full field reference, and
[Author a config](/protvista/configure) explains how to layer your track on top
of the canonical UniProt view rather than replacing it.

## Rearrange what you see

Every viewer now has a **Customize** button. In that mode each row gets
move-up / move-down controls and a show/hide toggle: reorder groups, reorder
tracks within a group, hide what you don't need. No configuration file, no code
at all — and no drag gesture either, so it works the same with a mouse, a
touchscreen, or a keyboard.

The arrangement you make sticks. It comes back the next time you open that
viewer, and it travels in a shareable link, so "move Variants above Domains"
becomes something you send rather than something you explain.

**Learn more:** [Customize the layout](/protvista/customize-layout).

<!-- TODO(screenshot): Customize mode active — a row showing its move-up /
     move-down and show/hide controls. Same spec as above: 400x300, 72dpi,
     alt text, CC BY 4.0 caption. -->


## Try it now, then publish it

The [playground](/protvista/playground/) is the fastest way to see any of this:
a configuration editor beside a live viewer, with nothing to install. Type an
accession, edit the configuration, watch it render. Every view has its own URL,
so you can send a colleague the exact thing you are looking at.

When you want to keep it, the
[Starter Kit](https://github.com/ebi-webcomponents/protvista-starter-kit) is a
template repository: select **Use this template**, drop your data file into
`data/`, edit `config.yaml`, and switch on GitHub Pages. You get a live, shareable
viewer with no build step, no `npm install`, and no JavaScript. A bundled check
validates your configuration on every push, so a mistyped field shows up as a
failed check rather than a puzzle later.

## Getting it

The playground and the Starter Kit need nothing installed. If you embed
ProtVista yourself, this release is on npm under the `beta` tag:

```sh
npm install protvista-uniprot@beta
```

It is a beta on purpose. The stable 4.9 line stays the default install, so
existing deployments are untouched, and the configuration format may still
shift before the stable 5.0 release. If you are integrating now, we would
particularly like to hear from you.

## Come and build something with us

If anything above left you with an idea — a dataset worth wiring in, a
visualisation you need, an integration with your own resource — bring it to the
hackathon. It is open to researchers, bioinformaticians, and developers alike,
whether or not you have used ProtVista before, and no prior contribution to the
project is expected.

| | |
| --- | --- |
| **Dates** | 7–9 October 2026 |
| **Format** | Online, free |
| **Places** | 30, first come first served |
| **Applications close** | 1 October 2026 |

[Apply for the hackathon](https://www.ebi.ac.uk/training/events/protvista-hackathon/)

## Where to go next

- [Tutorial](/protvista/tutorial) — an empty page to a custom, themed viewer, in four steps.
- [Load your own data](/protvista/your-data) — CSV, TSV, JSON, BED, and inline data.
- [Customize the layout](/protvista/customize-layout) — reorder, show and hide, share, persist.
- [Author a config](/protvista/configure) — the structure of a configuration document.
- [Match your site's style](/protvista/theming) — colours from the configuration, or your own CSS.
- [Playground](/protvista/playground/) — edit a configuration live and share it by link.
- [Starter Kit](https://github.com/ebi-webcomponents/protvista-starter-kit) — use the template, add your data, publish.
- [Source and issues](https://github.com/ebi-webcomponents/protvista) — questions, bugs, and feature requests.
- [Office hours](https://github.com/ebi-webcomponents/protvista/blob/next/CONTRIBUTING.md#office-hours) — monthly live help with setup and your own data, no registration needed.

A webinar covering the same ground in more depth is coming later this year.

<!-- TODO(url): once the webinar is scheduled, replace the sentence above with
     a link — e.g. "A [webinar](URL) covering the same ground in more depth is
     coming later this year." Publishing without the link is deliberate: a bare
     placeholder URL must never ship. -->


---

_30 July 2026._

This work was supported by the Research Software Maintenance Fund, managed by
the Software Sustainability Institute and funded by UKRI through their Digital
Research Infrastructure programme via grant AH/Z000114/1.

Code is licensed under the MIT License; documentation and sample data are
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
