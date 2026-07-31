---
title: ProtVista
description: Embed an interactive protein feature viewer and load your own data — no framework required.
template: splash
hero:
  tagline: Visualize protein sequence features within the browser. Use UniProt data or bring your own. Use standalone or embed within your own website. Configuration driven with minimal coding.
  image:
    alt: The ProtVista viewer showing many rows of protein annotation — domains, sites, modifications, variants and structure coverage — drawn as coloured tracks along the sequence of P05067, with a three-dimensional ribbon model of the protein beneath them.
    file: ../../assets/screenshots/home-hero.png
  actions:
    - text: Learn more
      link: /protvista/overview
      icon: right-arrow
      variant: primary
    - text: Try the playground
      link: /protvista/playground/
      icon: rocket
      variant: primary
    - text: Check out the Starter Kit
      link: https://github.com/ebi-webcomponents/protvista-starter-kit
      icon: seti:notebook
      variant: primary
---

:::tip[ProtVista has been refactored]
**Version 5 is in beta.** Put your own data on screen beside UniProt's,
rearrange the view, and publish it, all without writing code.
[Read the announcement on the blog](/protvista/blog/protvista-5).
:::

ProtVista is a web component — the custom element `<protvista-uniprot>` — that
renders protein annotations as horizontal **tracks** aligned to the amino-acid
sequence. Give it a UniProt **accession** and an optional YAML/JSON **config**;
it fetches, draws, and lays out the rest.

New here? The end-to-end **[Tutorial](/protvista/tutorial)** takes you from an
empty page to a custom, themed viewer in four steps. Otherwise pick a starting
point above, or read the **[Overview](/protvista/overview)** for what it does,
who it's for, and where to go next.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
