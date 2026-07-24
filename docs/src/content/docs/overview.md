---
title: Overview
description: What ProtVista is, who it's for, and where to go next.
---

ProtVista is a web component — a custom HTML element, `<protvista-uniprot>` —
that draws protein sequence features as horizontal **tracks** aligned to the
amino-acid sequence: domains, variants, binding sites, structure coverage,
AlphaFold confidence, and more. You give it a UniProt **accession** (a protein
identifier such as `P05067`) and, optionally, a **config** describing which
tracks to show and where their data comes from.

Because it's a standard custom element, it drops into any page — plain HTML,
React, Vue, Angular — with a `<script>` tag and no build step. You do not need
to know the underlying rendering library or name any internal components: you
describe *what to show* in a small YAML or JSON document, and ProtVista resolves
that to the right components, data adapters, and layout for you.

## Who it's for

- **Scientists** who want to look at a protein without writing code — open the
  [playground](/protvista/playground/), type an accession, and explore.
- **Bioinformaticians** bringing their own annotations — load a CSV, TSV, JSON,
  or BED file alongside the live UniProt tracks. See
  [Load your own data](/protvista/your-data).
- **Developers** embedding the viewer in an application — add the element,
  author a config, and wire up events. Start with
  [Embed the viewer](/protvista/embed).

## Find your path

- **New here?** Start with [Embed the viewer](/protvista/embed), then
  [Author a config](/protvista/configure).
- **Bringing your own data?** Go straight to
  [Load your own data](/protvista/your-data).
- **What each track type draws?** See [Built-in track kinds](/protvista/track-kinds).
- **Config vs. what a provider supplies?** Read
  [Configuration vs data](/protvista/configuration-vs-data).
- **Validating configs or working at scale?** Point your editor at the
  [config JSON Schema](/protvista/configure#editor-autocomplete).
- **Beyond the built-ins?** See the [Escape hatches](/protvista/escape-hatches).
- **Something not rendering?** Check [Troubleshoot errors](/protvista/troubleshooting).

## Tools & resources

- [**Playground**](/protvista/playground/) — edit a config live, see it render,
  share it via a link.
- [**Playground — dev examples**](/protvista/playground/?dev) — the same, seeded
  with tricky proteins for eyeballing edge cases.
- [**Starter Kit**](https://github.com/ebi-webcomponents/protvista-starter-kit) —
  a no-build template repository to copy and go.
- [**Feature record schema**](https://ebi-webcomponents.github.io/protvista/schema/v1/feature-record.schema.json)
  — machine-readable schema for bring-your-own data.
- [**Source & issues**](https://github.com/ebi-webcomponents/protvista) —
  component source, schema, and tracker.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
