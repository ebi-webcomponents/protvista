---
title: 'What came out of the ProtVista hackathon'
description: What contributors built at the ProtVista hackathon, 7–9 October 2026. It includes isoform rows, an EGFR drug-contacts view, a loader fix and 17 documentation improvements, with a link to every pull request.
---

From 7 to 9 October 2026 we ran the ProtVista hackathon: three free days
online, working with the developers to get people's own data into ProtVista and
to make the project easier to join. This post is our record of the event. It
lists every contribution with a link, says what we learned, and says what
happens next.

Thank you to everyone who took part. The pull requests below were opened by
[Bibhuprasadbehera](https://github.com/Bibhuprasadbehera),
[Rajarshi0](https://github.com/Rajarshi0),
[Tanmaypatil-25](https://github.com/Tanmaypatil-25),
[abhicodes-007](https://github.com/abhicodes-007),
[bryanswe01](https://github.com/bryanswe01),
[knownshah](https://github.com/knownshah),
[lamplinked-netizen](https://github.com/lamplinked-netizen) and
[lokchinleung](https://github.com/lokchinleung).
[TODO(maintainer): thank the mentors and anyone else who helped run the event,
if you want to name them.]

## At a glance

|                                                         |                                                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Dates**                                               | 7–9 October 2026                                                                         |
| **Format**                                              | Online, free                                                                             |
| **Places offered**                                      | 30                                                                                       |
| **Registrations**                                       | [TODO(maintainer): number of registrations]                                              |
| **Attendees**                                           | [TODO(maintainer): number who attended]                                                  |
| **Teams**                                               | [TODO(maintainer): number of teams]                                                      |
| **Projects**                                            | [TODO(maintainer): number of projects worked on, and link to the project list if public] |
| **Merged pull requests from contributors, 6–9 October** | 24, from 8 GitHub accounts (20 by the end of the event, 4 more by 30 October)            |

How each figure was counted is at the end of this post.

## New features

### Isoform rows ([#337](https://github.com/ebi-webcomponents/protvista/pull/337))

By [Rajarshi0](https://github.com/Rajarshi0) (hackathon project F8).

ProtVista draws a protein's canonical sequence, but UniProt lists several
isoforms for many proteins. This contribution is the first step towards
[#14](https://github.com/ebi-webcomponents/protvista/issues/14), which asked to
see a protein's annotations on a chosen isoform.

- A new built-in adapter, `uniprot-isoforms-json`, draws one row per isoform on
  the canonical sequence's numbering, with a gap where an isoform lacks part of
  the sequence and a mark where it replaces residues. It is opt-in, and is
  documented under [Built-in track kinds](/protvista/track-kinds).
- A mapper rebuilds each isoform from UniProt's own data and maps residues
  between the canonical sequence and an isoform, with tests on saved UniProt
  data.
- A new community view, [APP isoforms](/protvista/playground/#preset=community-isoforms-app),
  in the playground.
- [Prototype pages](https://github.com/ebi-webcomponents/protvista/tree/next/demos/isoforms)
  that show canonical tau annotations on the 441-residue isoform most papers
  use, so that the P301L mutation appears at 301 rather than at its canonical
  position.

### EGFR drug contacts ([#355](https://github.com/ebi-webcomponents/protvista/pull/355))

By [Bibhuprasadbehera](https://github.com/Bibhuprasadbehera) and a second team
member [TODO(maintainer): their GitHub handle, if they agree to be named]
(project L2, community presets).

A community view of human EGFR (`P00533`) that shows which residues contact each
of seven approved kinase-inhibitor drugs and one ATP analogue in solved
co-crystal structures, from PDBe-KB, beside domains, PDB structure coverage and
AlphaFold confidence. A script rebuilds the data from its sources and checks it
has not drifted. Open it in the playground as
[EGFR drug contacts](/protvista/playground/#preset=community-structure-egfr);
the team's
[first-milestone demo](https://bibhuprasadbehera.github.io/protvista-disordered-proteins/)
is linked from the pull request.

### Safer handling of unusual group ids ([#356](https://github.com/ebi-webcomponents/protvista/pull/356))

By [knownshah](https://github.com/knownshah).

A config group with the id `__proto__` lost its data when the viewer loaded it.
The loader now keeps every group's data, with tests, and the project's security
note records the fix
([#325](https://github.com/ebi-webcomponents/protvista/issues/325)).

## Documentation

During the event, seventeen pull requests improved the documentation.

| Pull request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | By                                                          | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#334](https://github.com/ebi-webcomponents/protvista/pull/334)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [lokchinleung](https://github.com/lokchinleung)             | [Tutorial](/protvista/tutorial): says the HTML snippet goes in your page's `<body>`, not in the playground's config editor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| [#336](https://github.com/ebi-webcomponents/protvista/pull/336)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [bryanswe01](https://github.com/bryanswe01)                 | [Configuration vs data](/protvista/configuration-vs-data): a clearer explanation of how `data` and `kind` connect a config to its data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [#338](https://github.com/ebi-webcomponents/protvista/pull/338)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [lokchinleung](https://github.com/lokchinleung)             | [Troubleshoot errors](/protvista/troubleshooting): start with the messages on screen before opening the browser console.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [#339](https://github.com/ebi-webcomponents/protvista/pull/339)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [lamplinked-netizen](https://github.com/lamplinked-netizen) | [Overview](/protvista/overview): a short list of key terms, such as adapter, payload and schema.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| [#340](https://github.com/ebi-webcomponents/protvista/pull/340)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [lokchinleung](https://github.com/lokchinleung)             | [Load your own data](/protvista/your-data): a new section, "Ask an AI to write your config", including how to check what it writes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| [#352](https://github.com/ebi-webcomponents/protvista/pull/352)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [lamplinked-netizen](https://github.com/lamplinked-netizen) | The documentation index for AI assistants (`llms.txt`): plain-language explanations of each term and page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [#342](https://github.com/ebi-webcomponents/protvista/pull/342), [#343](https://github.com/ebi-webcomponents/protvista/pull/343), [#344](https://github.com/ebi-webcomponents/protvista/pull/344), [#345](https://github.com/ebi-webcomponents/protvista/pull/345), [#346](https://github.com/ebi-webcomponents/protvista/pull/346), [#347](https://github.com/ebi-webcomponents/protvista/pull/347), [#348](https://github.com/ebi-webcomponents/protvista/pull/348), [#349](https://github.com/ebi-webcomponents/protvista/pull/349), [#350](https://github.com/ebi-webcomponents/protvista/pull/350), [#351](https://github.com/ebi-webcomponents/protvista/pull/351), [#353](https://github.com/ebi-webcomponents/protvista/pull/353) | [bryanswe01](https://github.com/bryanswe01)                 | A one-line summary for 11 pages, which search engines and link previews show: [Rich tooltips in React](/protvista/react-integration), [Configuration vs data](/protvista/configuration-vs-data), [Author tooltips](/protvista/data-tooltip), [Embed the viewer](/protvista/embed), [Author a config](/protvista/configure), [Escape hatches](/protvista/escape-hatches), [Proteins outside UniProt](/protvista/sequence-only), [Theme the viewer](/protvista/theming), [Built-in track kinds](/protvista/track-kinds), [Troubleshoot errors](/protvista/troubleshooting) and [Load your own data](/protvista/your-data). |

## In the run-up

Four pull requests were opened on 6 October, the day before the event
started:

- [#326](https://github.com/ebi-webcomponents/protvista/pull/326) by
  [Tanmaypatil-25](https://github.com/Tanmaypatil-25): tests for every branch
  of the variant colour rules
  ([#314](https://github.com/ebi-webcomponents/protvista/issues/314)).
- [#327](https://github.com/ebi-webcomponents/protvista/pull/327) by
  [knownshah](https://github.com/knownshah): the structure panel's colour-scale
  buttons stay in step with the colour scale, and two panels on one page no
  longer interfere
  ([#310](https://github.com/ebi-webcomponents/protvista/issues/310)).
- [#331](https://github.com/ebi-webcomponents/protvista/pull/331) by
  [abhicodes-007](https://github.com/abhicodes-007): **Copy link** and
  **Download config** buttons in the [playground](/protvista/playground/)
  ([#321](https://github.com/ebi-webcomponents/protvista/issues/321)).
- [#332](https://github.com/ebi-webcomponents/protvista/pull/332) by
  [abhicodes-007](https://github.com/abhicodes-007): a new
  [Events](/protvista/events) reference page
  ([#322](https://github.com/ebi-webcomponents/protvista/issues/322)).

## What came out of it

- **Isoforms in their own numbering**
  ([#393](https://github.com/ebi-webcomponents/protvista/issues/393)): the next
  step after #337, which moves the tau prototype into ProtVista itself, so a
  config can show a protein's annotations on the isoform you care about.
- **Structure legend** ([#390](https://github.com/ebi-webcomponents/protvista/issues/390)):
  a follow-up to #327. The legend under the structure did not follow the
  colour scale when a page set it. It is now fixed
  ([#401](https://github.com/ebi-webcomponents/protvista/pull/401)).
- **Follow-up work by the team** to bring contributions up to release standard:
  [#402](https://github.com/ebi-webcomponents/protvista/pull/402) for the EGFR
  view, and further tests and wording for the playground buttons and the Events
  page
  ([8d5c37a](https://github.com/ebi-webcomponents/protvista/commit/8d5c37a484fc373243969dbb3a8955b89511dc1f)).

[TODO(maintainer): any other projects, prototypes or ideas from the event that
are not in a pull request or issue.]

## Feedback

[TODO(maintainer): results of the post-hackathon survey
([#229](https://github.com/ebi-webcomponents/protvista/issues/229)): number of
responses and the main findings.]

[TODO(maintainer): what came out of the closing feedback session.]

## What we learned

What the pull requests show:

- **Most contributions during the event were to the documentation.** 17 of
  the 20 merged pull requests opened from 7 to 9 October changed only the
  docs. They show where the docs fell short for people outside the team: undefined terms, a
  tutorial step that did not say where a snippet goes, on-screen error messages
  that the troubleshooting page did not mention, and pages with no summary.
- **Review went on well after the event.** Every documentation pull request
  merged from the event was merged on 8 or 9 October. The four pull requests
  still open when it ended
  ([#331](https://github.com/ebi-webcomponents/protvista/pull/331),
  [#332](https://github.com/ebi-webcomponents/protvista/pull/332),
  [#355](https://github.com/ebi-webcomponents/protvista/pull/355),
  [#356](https://github.com/ebi-webcomponents/protvista/pull/356)) were merged
  on 29–30 October, and three of them needed follow-up work from the team.
- **Community views work without touching shared code.** Both new community
  views (APP isoforms and EGFR drug contacts) were added as a folder of
  examples with a `preset.json`, with no change to the playground's code. That
  became possible on the evening of the first day
  ([#378](https://github.com/ebi-webcomponents/protvista/issues/378)).

[TODO(maintainer): anything else we learned, including from the survey and the
feedback session.]

## What changes

[TODO(maintainer): what we will change as a result, for example to the
contributor guide, the default branch, or review capacity, and for the next
event.]

## Get involved

You don't need to have been at the hackathon. Nine of the `good first issue`
tasks filed for it are still
[open](https://github.com/ebi-webcomponents/protvista/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22%20created%3A2026-10-06),
and each says which files to look at. Start with
[Contributing via a fork](https://github.com/ebi-webcomponents/protvista/blob/next/CONTRIBUTING.md#contributing-via-a-fork),
and come to
[office hours](https://github.com/ebi-webcomponents/protvista/blob/next/CONTRIBUTING.md#office-hours)
for help with setup or your own data.

## How the figures were counted

Counted on 30 October 2026 from the repository on GitHub.

- **Places offered:** from the hackathon announcement in
  [ProtVista 5 is in beta](/protvista/blog/protvista-5#hackathon-visualise-your-own-data).
- **Merged pull requests and accounts:**
  [merged pull requests created 6–9 October 2026 by anyone but the maintainer](https://github.com/ebi-webcomponents/protvista/pulls?q=is%3Apr%20is%3Amerged%20created%3A2026-10-06..2026-10-09%20-author%3Adlrice);
  no one else on the team opened one in those days. Add
  `merged:2026-10-06..2026-10-09` for those merged by the end of the event, and
  use `created:2026-10-07..2026-10-09` for the event days alone. The
  maintainer's own pull requests in those days
  ([#328](https://github.com/ebi-webcomponents/protvista/pull/328),
  [#329](https://github.com/ebi-webcomponents/protvista/pull/329),
  [#330](https://github.com/ebi-webcomponents/protvista/pull/330),
  [#333](https://github.com/ebi-webcomponents/protvista/pull/333)) are not
  counted as contributions; #329, #330 and #333 were preparation for the
  event.
- **Open `good first issue` tasks:** the search linked under
  [Get involved](#get-involved).

---

_30 October 2026._

Code is licensed under the MIT License; documentation and sample data are
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
