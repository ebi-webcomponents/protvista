---
title: Accessibility and known limitations
description: What works with a keyboard, screen reader and colour-vision deficiency today, the verified limitations of the viewer, and how to work around them.
---

ProtVista is being audited against [WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA. The automated and computed parts of the audit are done; the manual screen-reader, keyboard-only and zoom passes are still to come. The full results, with the evidence and tracking issue for each criterion, are in the [accessibility audit report](https://github.com/ebi-webcomponents/protvista/blob/next/docs/accessibility-audit.md).

This page lists only limitations that have been verified in the code or by a test.

## What works today

- **Controls around the tracks** are real buttons with names: group expand and collapse, the ⓘ notes, the ⚠ error badges and their Retry, and every [Customize mode](/protvista/customize-layout) control. They work with Enter and Space and show a focus ring.
- **Announcements.** Loading, Customize-mode changes and visitor notes are announced to screen readers. A viewer that cannot load shows an alert and moves focus to it.
- **The structure table** under the 3D view can be used with the arrow keys.
- **Automated checks.** Every change runs axe and keyboard tests in a real browser on the surfaces above.

## Known limitations

### The tracks themselves

- **No text alternative.** Features, variants and scores are drawn as pictures (canvas or SVG) by the Nightingale components. A screen reader cannot read what a track shows.
- **Pointer only.** A feature's details open only when you click or tap it; there is no keyboard path to a feature or its tooltip.
- **Zooming** needs a drag on the navigation bar at the top, or Ctrl+scroll over a track. There are no zoom buttons.

### Colour

- **Variants.** Each variant is a dot whose colour gives its class: red pathogenic, green benign, blue predicted, teal uncertain. Every dot is the same circle. With red–green colour blindness, pathogenic and benign dots differ only in lightness, so it is hard to tell which is which. Benign, predicted and uncertain dots have less than 3:1 contrast with the white background.
- **AlphaFold confidence.** Three of the four colours (orange, yellow, light blue) have less than 3:1 contrast with white.
- **AlphaMissense.** The light middle of the scale (ambiguous scores) is close to white, and a residue with no score is drawn as white, so the two are hard to tell apart.
- **AlphaMissense average track.** Three of its eight score ranges are drawn in the wrong colour: the most benign residues (average score below 0.1132) appear in the light salmon used for likely-pathogenic scores, residues from 0.2264 to 0.3395 appear light peach, and 0.7264–0.8632 appears in the darkest red. The heatmap and the 3D model are not affected.
- **The AlphaMissense legend** in the structure panel uses darker colours than the 3D model shows.
- **Collapsed groups.** A collapsed group draws all its feature types in one track, and some default colours are almost the same: for example metal binding and DNA binding in Sites, and motif and zinc finger in Domains for people with protanopia. Twelve of the 45 default feature colours have less than 3:1 contrast with white.

### Other parts of the page

- **Group headers with a ⚠ badge or a link.** A screen reader announces the header as a button that contains other buttons or links.
- **Datatable filters.** Each filter is named "Filter by …" for screen readers but is not linked to its column heading, and the number of matching rows is not announced when a filter changes ([#312](https://github.com/ebi-webcomponents/protvista/issues/312)).
- **Structure panel.** Every download link has the same name, the last column has no heading, and loading and "no structures" are not announced ([#311](https://github.com/ebi-webcomponents/protvista/issues/311)).
- **Variant filter checkboxes.** Each one has an extra Tab stop on its label that shows no focus ring.

## Workarounds

- **Read a variant's class without colour:** in the variants filter, untick every class but one; only that class stays on the track. The tooltip also names the clinical significance.
- **Read AlphaFold and AlphaMissense values:** click a residue; the tooltip gives the pLDDT or pathogenicity score as a number. For AlphaMissense, prefer the heatmap or the score to the average track's colour.
- **Tell feature types apart:** expand the group. Each type then has its own track with a text label.
- **Simulate colour-vision deficiency** in Chrome or Edge under DevTools › Rendering › "Emulate vision deficiencies" to see what your readers see.
- **Change the colours** of your own tracks with `rendering.color` or a custom colour scale; see [Theme the viewer](/protvista/theming) and [Escape hatches](/protvista/escape-hatches).

## Report a problem

Open an issue on [GitHub](https://github.com/ebi-webcomponents/protvista/issues) and say which page, browser and assistive technology you used.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
