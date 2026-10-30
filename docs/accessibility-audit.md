# Accessibility audit (WCAG 2.2 AA)

This is the accessibility audit report for `protvista-uniprot`, a named Q3 output of the grant (ROADMAP: _"Audit and improve WCAG accessibility: keyboard navigation, colour-blind-friendly palettes, ARIA labelling, and screen-reader hooks. Document any known limitations."_), tracked as [issue #382](https://github.com/ebi-webcomponents/protvista/issues/382). It builds on the automated baseline in [`accessibility-baseline.md`](./accessibility-baseline.md).

**Status.** This report covers everything that can be checked without a person using assistive technology: automated axe and keyboard tests, a computed colour-blind check of every default palette, code inspection, and automated browser checks in Chromium that do most of what the keyboard-only and zoom passes asked for (tab order, traps, focus, what focus and input change, 200% zoom, 320 px reflow, text spacing, orientation, pointer cancellation, landmarks and the accessibility tree). Results from those checks are labelled "Automated browser check, Chromium". **No screen reader has been used yet**, and no result here is a manual or screen-reader result. What still needs a person is listed under [Manual passes still to do](#manual-passes-still-to-do); three criteria wait for it entirely and are marked "Not yet checked — manual pass".

**Baseline.** The code audited is `next` at `09f1832`. The audit script and the browser tests that pin its findings are added together with this report, so they do not exist on `09f1832` itself; run them on the commit that adds this report or any later one (see [Reproducing the figures](#reproducing-the-figures)). The automated browser checks were added and run later, on `next` at `2d58072`, which differs from `09f1832` in `src/` by the playground's Copy link and Download config buttons, a null-prototype object in `src/load-data.ts` and new tests. The end-user summary is on the docs site: [Accessibility and known limitations](https://ebi-webcomponents.github.io/protvista/accessibility).

## Summary

- **38 WCAG 2.2 A/AA criteria** apply to the viewer and the playground. **9 pass**, **18 fail**, **8 are partly checked** (what was checked passes) and **3 wait for a manual pass**. The other A/AA criteria do not apply (see [Not applicable](#not-applicable)).
- **Automated browser checks in Chromium (with code inspection for the Mol* 3D view) settled 13 of the 16 criteria that waited for a manual pass**: 3 pass (1.3.4 orientation, 1.4.4 resize text, 2.4.1 bypass blocks), 6 fail and 4 are partly checked. They also measured target sizes (2.5.8, now a failure) and the playground's validation messages (3.3.1, now a pass). The new failures: an unknown accession in the playground and a datatable filter change move focus (3.2.2); the datatable's sticky header hides the focused row (2.4.11); at 320 px the label column is 64 px wide and the Customize button runs under the tracks (1.4.10); the Mol* 3D view has single-letter shortcuts (2.1.4); notes close on the press, not the release (2.5.2); some validation messages give no suggestion (3.3.3); the playground's splitter is 8 px wide (2.5.8).
- **The largest failures are in the tracks themselves.** Features, variants and scores are drawn on canvas or SVG by the upstream Nightingale components. They have no text alternative and cannot be reached with a keyboard, and their details (tooltips) open only with a pointer click (1.1.1, 2.1.1, 4.1.2). Zooming needs a drag or Ctrl+scroll (2.1.1, 2.5.7).
- **Colour-blind check.** Under protanopia and deuteranopia the pathogenic and benign variant colours keep their lightness difference but take the same hue (0–1° apart), so "red = pathogenic, green = benign" is lost. Under tritanopia, predicted and uncertain variants are hard to tell apart (ΔE00 8.6). Every variant is a circle, so nothing but colour separates the classes on the track.
- **Low contrast.** As drawn, three of the four variant colours, three of the four AlphaFold colours, five of the nine AlphaMissense ramp stops and 14 of the 45 feature-type colours are below the 3:1 non-text minimum (1.4.11).
- **A colour defect found by the audit.** The AlphaMissense average-pathogenicity track draws three of its eight score buckets in another bucket's colour. The most benign residues (score below 0.1132) are drawn in the light salmon used for likely-pathogenic scores. This is not an accessibility issue as such, but it changes what the colours mean for every reader.
- **The four baseline gaps are all still open.** Two are tracked by #312 and the third (group header) needs an issue. The fourth (Nightingale internals) is assessed in this report.
- **New issues to file:** 18, listed in [Issues to file](#issues-to-file): A–J from the first part of the audit and K–R from the automated browser checks. They have no numbers yet.

## Scope and method

**Surfaces.** The viewer `<protvista-uniprot>` with the default UniProt configuration (`src/default-config.yaml`), including groups, tracks, tooltips, ⓘ notes, ⚠ error badges and Customize mode; the structure panel `<protvista-uniprot-structure>` and its datatable `<protvista-uniprot-datatable>`; and the configuration playground page (`docs/src/pages/playground.astro`). The rest of the documentation site is out of scope.

**How each criterion was checked.**

| Method | What it means here |
|---|---|
| axe | [`axe-core`](https://github.com/dequelabs/axe-core) 4.13, default rule set, run in Chromium by the browser tests (`src/__browser__/*.browser.spec.ts`, helper `src/__browser__/axe.ts`). Surfaces with an axe check: the datatable, the error panel and ⚠ badges, ⓘ notes, the group toggle, Customize mode, sequence mode, and the playground's local-data and file panels. |
| Keyboard tests | Browser tests that drive real key presses: datatable rows, group toggle, Customize mode, notes and badges. |
| Computed | `scripts/accessibility/palette_audit.py` (see [Colour-blind check](#colour-blind-check-of-the-default-palettes)). |
| Code inspection | Reading the source on `09f1832` and the installed Nightingale 5.11 bundles (including Mol* 3.44 inside `nightingale-structure`). File and line references are given in the evidence. |
| Automated browser check, Chromium | Browser tests that do what a keyboard-only or zoom tester would, in Playwright's Chromium (`src/__browser__/a11y-*.browser.spec.ts`, helpers in `a11y-checks.ts`). They press Tab, Shift+Tab, arrows, Escape and every printable key; record each focus stop and whether its look changes; test whether it is on top somewhere in its box; compare the open, expanded, pressed, selected, checked and hidden state of every element before and after; press with a real mouse and release elsewhere; read Chromium's accessibility tree over the DevTools protocol; and lay pages out at the CSS sizes browser zoom gives, with WCAG text spacing forced. The viewer is checked with real Nightingale tracks and variant filter; the playground as the page ships (`playground.astro`'s markup and styles with the real controller). The Mol* 3D view is stubbed and not covered. This is not a screen-reader test. |
| Manual pass | A person with a screen reader, keyboard only, or browser zoom. Not done yet. |

**Results.**

| Result | Meaning |
|---|---|
| Pass | Every surface checked conforms. |
| Fail | At least one default surface does not conform. |
| Partial | What was checked conforms, but part of the criterion still needs checking. |
| Not yet checked — manual pass | Needs a person; the evidence column says what to do. |

## WCAG 2.2 AA results

Issue numbers refer to [ebi-webcomponents/protvista](https://github.com/ebi-webcomponents/protvista/issues). "Issue to file" items are described under [Issues to file](#issues-to-file), with the same letter.

| Criterion | How checked | Result | Evidence | Tracking |
|---|---|---|---|---|
| 1.1.1 Non-text content (A) | Code inspection | **Fail** | Track contents are drawn by Nightingale on canvas or SVG with no role, name or text equivalent, and ProtVista adds none to the track cells (`src/protvista-uniprot.ts`, `src/renderer/track-template.ts`). Icon-only controls (ⓘ, ⚠, Retry, Customize) do have names: axe passes on them. | Issue to file: A |
| 1.3.1 Info and relationships (A) | axe; code inspection | **Fail** | A collapsed group whose label carries a ⚠ badge fails axe `nested-interactive` (pinned in `src/__browser__/group-toggle.browser.spec.ts`). Datatable filters are named by `aria-label`, not tied to their column header (`src/protvista-uniprot-datatable.ts:462`). The "No matching results" row is a plain `<tr>` inside `role="listbox"` (`:476`). The structure table's last column header is empty (`src/protvista-uniprot-structure.ts:579`). | #312, #311, issue to file: B |
| 1.3.2 Meaningful sequence (A) | Automated browser check, Chromium | Partial | Chromium's accessibility tree lists the viewer and the playground in their visual order: the viewer's top bar, then each group header with its ⚠ badge and Retry, then the variant filter; the playground's header, then the editor (left), then the preview (right). An opened ⓘ note is read straight after its button. The feature tooltip is added at the end of the viewer rather than beside the feature, but takes focus when it opens. Not checked: the structure panel, and what a screen reader actually reads (screen-reader pass). | — |
| 1.3.3 Sensory characteristics (A) | Manual pass | Not yet checked — manual pass | Tester: check that no on-screen instruction relies only on colour, shape or position (playground notices, help text, ⓘ notes). | — |
| 1.3.4 Orientation (AA) | Automated browser check, Chromium | Pass | The playground with a real viewer lays out in portrait (360×640 CSS px) and landscape (640×360) with no sideways scroll, no clipped or overlapping text and every control in reach. No stylesheet on the page has an orientation media query, and nothing calls `screen.orientation.lock`. Checked in Chromium at those sizes, not on a phone or tablet. | — |
| 1.4.1 Use of colour (A) | Computed; code inspection | **Fail** | The class of each variant is shown by colour only: every dot is a circle (`nightingale-variation-canvas` draws only `arc`). AlphaFold and AlphaMissense categories are colour only on the track. In a collapsed group some types differ only by colour, and so do InterPro domains and the two lines of the variant-count graph. Non-colour routes exist but are partial: the variant filter's text labels, tooltip text (pointer only) and expanding a group. Customize mode passes (baseline). See the [colour-blind check](#colour-blind-check-of-the-default-palettes). | Issues to file: C, F, H |
| 1.4.3 Contrast (minimum) (AA) | axe (`color-contrast`) | Partial | Passes on every surface with an axe check (see Scope). Not covered: the structure panel, the full playground page, and text Nightingale draws in SVG (sequence letters, axis labels). The default design-token pairs have no regression test. | #311, #315 |
| 1.4.4 Resize text (AA) | Automated browser check, Chromium | Pass | 200% browser zoom reproduced as the CSS viewport it leaves: 640×360 (a 1280×720 window) and 960×540 (1920×1080). The playground with a real viewer in its preview, and the structure panel with its table, show no clipped or overlapping text, no control out of reach and no sideways scroll. Zooming in after the viewer has drawn leaves its track area at the old width, so the preview scrolls sideways until the viewer is drawn again; nothing is lost (issue to file: Q). Text-only zoom (Firefox) was not tried. | Issue to file: Q |
| 1.4.5 Images of text (AA) | Code inspection | Pass | No images of text: the icons in `src/icons/` are SVG glyphs with no `<text>`, and each icon control has a text name. | — |
| 1.4.10 Reflow (AA) | Automated browser check, Chromium | **Fail** | At 320×256 CSS px (1280×1024 at 400%) the playground page, the viewer and the structure panel scroll only vertically; only the track area and the structure table, which are two-dimensional and exempt, are wider than the screen. But the viewer's label column is 20% of the window (`--protvista-label-width`, default `20vw`), 64 px here: the Customize button, the variant filter's headings and labels, and any long word in a group label run past it, under the ruler and tracks, which paint over them. | Issue to file: R |
| 1.4.11 Non-text contrast (AA) | Computed; baseline | **Fail** | Against white, as drawn: benign variant 1.48:1, predicted 2.04:1, uncertain 2.07:1; three of four AlphaFold colours (1.36–2.54:1); the five lightest of the nine AlphaMissense ramp stops (1.30–2.18:1); 14 of 45 feature-type colours; 1531 of the 3231 possible InterPro domain colours; the grey count-graph line 2.35:1. The Customize switch meets 3:1 (baseline). | Issues to file: C, H |
| 1.4.12 Text spacing (AA) | Automated browser check, Chromium | Partial | With line height 1.5, paragraph spacing 2em, letter spacing 0.12em and word spacing 0.16em forced on every element, shadow roots included, the playground, the viewer's labels, controls and filter, and the structure panel show no clipped or overlapping text and no sideways scroll at 1280×720. Not checked: text that Nightingale draws in SVG (ruler numbers, sequence letters), which the check leaves out with the rest of the track area. | — |
| 1.4.13 Content on hover or focus (AA) | Code inspection | Partial | ProtVista's popovers (feature tooltip, ⓘ notes, ⚠ badges) open on click, not on hover or focus (`src/tooltips/popover.ts:276`). `title` tooltips are drawn by the browser and are exempt. Not checked: hover labels inside the Mol* 3D view. | — |
| 2.1.1 Keyboard (A) | Keyboard tests; automated browser check, Chromium; code inspection | **Fail** | Pass: group toggle, Customize mode, notes and badges, datatable rows. Fail: track features and their tooltips need a pointer click (a Tab walk through a viewer with real Nightingale tracks reaches no feature) (`popover.ts:276`; the Nightingale track bundles have no `tabindex` or `aria-` attributes). Zoom and pan need a drag on the navigation track or Ctrl+scroll (`use-ctrl-to-zoom`, `protvista-uniprot.ts:5071`). The Mol* view was not checked. | Issues to file: A, D |
| 2.1.2 No keyboard trap (A) | Automated browser check, Chromium | Partial | Tab and Shift+Tab pass through and out of the viewer (real Nightingale tracks and variant filter, also in Customize mode), the whole playground page including its code editor (Tab moves on; the editor does not take Tab for indenting), and the structure panel and its table. Tab and Escape both leave an open ⓘ note and the feature tooltip. Not checked: the Mol* 3D view, which is stubbed in the browser tests. | — |
| 2.1.4 Character key shortcuts (A) | Automated browser check, Chromium; code inspection | **Fail** | ProtVista's own code handles only Enter, Space, Escape, the arrows, Home, End and Ctrl/Cmd+Enter, and pressing every printable character on the viewer, the playground and their controls changes nothing. But the Mol* 3D view in the structure panel binds I (spin), O (rock) and T (reset the view) with no modifier (`CameraControls`, which the installed `nightingale-structure` 5.11 bundle includes in its Mol* 3.44 plugin spec). They act when focus is on the page body or the 3D canvas and the pointer is over the 3D view, and ProtVista has no setting to turn them off or remap them. Found by code inspection; not run, since Mol* needs WebGL and structure data. | Issue to file: P |
| 2.2.2 Pause, stop, hide (A) | Code inspection; manual pass | Not yet checked — manual pass | The only animation in ProtVista's styles is Customize mode's 2-second "moved" fade, which is off under `prefers-reduced-motion`. Tester: on a throttled connection, check whether a loading spinner runs for more than 5 seconds beside other content. | — |
| 2.3.1 Three flashes or below threshold (A) | Code inspection | Pass | No flashing content in the viewer or playground styles. | — |
| 2.4.1 Bypass blocks (A) | Automated browser check, Chromium | Pass | Chromium's accessibility tree for the playground has a banner, a main landmark, "Config editor", "Validation results" and "Live preview" regions, an h1 and an h2 for each pane; axe's `bypass` rule passes. The viewer is a component: a way past it belongs to the page that embeds it. | — |
| 2.4.2 Page titled (A) | Code inspection | Pass | The playground has `<title>ProtVista configuration playground</title>` (`docs/src/pages/playground.astro:36`). | — |
| 2.4.3 Focus order (A) | Keyboard tests; automated browser check, Chromium | Partial | Tab follows the visual reading order in the viewer (also in Customize mode), the playground and the structure panel, and Shift+Tab reverses it. Customize mode returns focus to its button on Done and moves it when a move disables the pressed button; the error panel takes focus when it appears; popovers return focus on Escape. In the structure table, the links in rows above the selected row come before the row itself. Two changes of input move focus unexpectedly (3.2.2). Not checked: the Mol* 3D view. | Issues to file: K, L |
| 2.4.4 Link purpose (in context) (A) | Code inspection | **Fail** | Every structure row's download link has the same name, "Download source file" (`protvista-uniprot-structure.ts:400`). | #311 |
| 2.4.6 Headings and labels (AA) | axe; code inspection | **Fail** | Names checked by axe are descriptive, but the structure table's last column header is empty (`protvista-uniprot-structure.ts:579`). | #311 |
| 2.4.7 Focus visible (AA) | Code inspection; automated browser check, Chromium | **Fail** | Tabbing through every control and comparing its look with and without focus: every stop shows focus except the variant filter's labels. `nightingale-filter` 5.11 makes each `<label>` focusable (`tabindex="0"`) and removes its outline (`outline: none`), so each of the seven filters has a Tab stop with no focus indicator before its checkbox. The group toggle and Retry show the browser's default ring, and the code editor a 1 px dotted outline. | Issue to file: I |
| 2.4.11 Focus not obscured (minimum) (AA) | Automated browser check, Chromium | **Fail** | No focus stop in the viewer, the playground or the structure panel is entirely hidden, in a 1280×400 window too, and moving on from an open note closes it. But in the datatable (the structure panel's table), when the table has to scroll up, the browser brings the focused row to the top of the scroll box, under the sticky header: arrowing up from the last of 30 rows in a 240 px tall table, more than 20 rows are entirely hidden when they take focus. | Issue to file: M |
| 2.5.1 Pointer gestures (A) | Manual pass | Not yet checked — manual pass | Tester: check that nothing in the tracks or the Mol* view needs a pinch or a path gesture. | — |
| 2.5.2 Pointer cancellation (A) | Automated browser check, Chromium | **Fail** | Pressing a control with a real mouse and releasing it elsewhere activates nothing: Customize, ⓘ notes, ⚠ badges, group toggles, Retry, the variant filter's checkboxes, the playground's Load data file, Copy link, Download config and Run, and a feature on a real track (no tooltip). A click on each does act. But an open ⓘ or ⚠ popover closes on the *down* event of a press anywhere else (a capture `pointerdown` listener), even if the press is then moved and released elsewhere; reopening it takes one click. Not checked: the Mol* 3D view. | Issue to file: O |
| 2.5.3 Label in name (A) | Code inspection | Partial | Customize switches are named "Show X"; the playground preset `<select>`'s name, "Configuration preset", contains its visible label "Preset". Other controls are not yet checked. | — |
| 2.5.7 Dragging movements (AA) | Code inspection | **Fail** | Zoom and pan need a drag on the navigation track or Ctrl+scroll, with no single-pointer alternative. The playground's panel splitter is resized by dragging or with arrow keys, which is not a single-pointer alternative. Customize mode passes (move buttons, no drag). | Issues to file: D, J |
| 2.5.8 Target size (minimum) (AA) | Browser tests; automated browser check, Chromium | **Fail** | Measured: Customize, group toggles, ⓘ notes, ⚠ badges, Retry, the structure radios and the playground's header controls are at least 24×24 px or have the spacing the criterion allows. The variant filter's checkboxes and the playground's two header links are smaller than 24 px and pass on spacing. The playground's panel splitter is 8 px wide, and a 24 px circle on it reaches the code editor. Not measured: the navigation ruler's drag handles. | Issue to file: J |
| 3.1.1 Language of page (A) | Code inspection | Pass | The playground sets `<html lang="en">` (`playground.astro:33`). | — |
| 3.2.1 On focus (A) | Automated browser check, Chromium | Partial | Moving focus with Tab and Shift+Tab through every control of the viewer (real Nightingale), the playground and the structure panel opens, submits and moves nothing: the URL and the open, expanded, pressed, selected, checked and hidden state of every element are the same after each step. Not checked: the Mol* 3D view. | — |
| 3.2.2 On input (A) | Automated browser check, Chromium | **Fail** | Pass: the playground's preset picker (ArrowDown on the closed picker loads the next preset and leaves focus on the picker, with no navigation or new window) and the structure colour radios. Fail: typing an accession that UniProt does not have and pressing Tab moves focus into the preview's error alert instead of the next control; changing a datatable filter moves focus from the filter to a row, so with the keyboard (where ArrowDown on a closed `<select>` changes its value, as in Chromium on Windows and Linux) one step throws focus out of the filter. | Issues to file: K, L |
| 3.3.1 Error identification (A) | axe; browser tests; automated browser check, Chromium | Pass | The viewer's alert panel (`role="alert"`) and ⚠ badges describe each failure in text (`error-retry` and `notices` specs, axe clean). The playground lists each validation problem in text with its path, or its line and column, in a "Validation results" region. | — |
| 3.3.2 Labels or instructions (A) | Code inspection | Pass | The playground's preset and accession inputs and the structure colour radios have `<label for>`; each datatable filter sits under its visible column header (its programmatic link is a 1.3.1 finding). | — |
| 3.3.3 Error suggestion (AA) | Automated browser check, Chromium | **Fail** | Common mistakes get messages that say what to change: an unknown kind lists the valid kinds, a row with neither `tracks:` nor `data:` says to add one, a bad residue names the allowed letters, YAML and JSON syntax errors give the line and column, and an undefined variable says where to define it. But a value outside an allowed set, such as `format: xls`, gets the schema validator's raw messages ("must be equal to one of the allowed values", "must match exactly one schema in oneOf"), which list no allowed values, and one says `data` is missing although it is there. #307 adds "Did you mean …?" to the unknown-name messages. | #307, issue to file: N |
| 4.1.2 Name, role, value (A) | axe; code inspection | **Fail** | `nested-interactive` on a group header carrying a ⚠ badge (above). The feature tooltip has `role="tooltip"` but takes focus and can contain links (`popover.ts:121`). Track canvases expose no role or name. Pass: group toggle (`aria-expanded`), Customize switches, badges (`aria-expanded`, `aria-controls`). | Issues to file: A, B |
| 4.1.3 Status messages (AA) | Browser tests; code inspection | **Fail** | Pass: Customize announcements, the viewer's loading status, notes. Fail: datatable filter results are not announced; the structure panel's loading and empty states are not announced. | #312, #311 |


### Not applicable

These WCAG 2.2 A/AA criteria do not apply to the viewer or playground: 1.2.1–1.2.5 (no audio or video), 1.3.5 (no inputs that collect personal data), 1.4.2 (no audio), 2.2.1 (no time limits; the only timers clear live-region text or debounce the editor), 2.4.5, 3.2.3, 3.2.4 and 3.2.6 (single pages, no shared navigation or help mechanism), 2.5.4 (no motion input), 3.1.2 (all text is English), 3.3.4 (no legal, financial or data-deleting submissions), 3.3.7 (no multi-step process) and 3.3.8 (no log-in).

## Colour-blind check of the default palettes

### Method

`scripts/accessibility/palette_audit.py` reads every default data palette from the source tree it runs in, so on any commit that includes it, its output describes that commit. It uses the Python standard library only. With `--check` it compares every colour figure quoted in this report and on the docs-site page with what it computes now, and fails on any difference; CI runs it with the script's own tests (`pnpm test:palettes`), so a palette change that makes these documents wrong fails the build.

- **Colour-vision deficiency** is simulated with Machado, Oliveira and Fernandes (2009) at full severity, for protanopia, deuteranopia and tritanopia. This is the model behind Chrome DevTools' "Emulate vision deficiencies". Milder (anomalous) forms see more than this.
- **Colour difference** is CIEDE2000 (ΔE00). The script checks itself against the published reference pairs (Sharma, Wu and Dalal 2005).
- **Contrast** is the WCAG ratio against the default white surface.
- **As drawn.** Nightingale paints variant dots at 60% opacity and feature shapes at 90% opacity, so those colours are blended over white before measuring. The script reads both opacities from the installed Nightingale bundles and exits with an error if either has changed. Overlapping dots, which get darker, are not modelled.
- **Types from a data source.** The epitope, antigen and large-scale mutagenesis tracks have no type filter and draw whatever types their source returns. The script takes those types from the recorded P05067 responses in `scripts/screenshots/fixtures/` and resolves their colour the way Nightingale does.
- **By eye.** The Chrome DevTools "Emulate vision deficiencies" check that issue #382 names, with screenshots, needs a person and is listed under [Manual passes still to do](#manual-passes-still-to-do). The computed results here use the same simulation model.
- **Thresholds.** For small marks on white this audit reads ΔE00 below 5 as _indistinguishable_ and below 10 as _hard to tell apart_. These are our working cut-offs, not a standard. The script prints the raw values so other thresholds can be applied.

### Results by palette

#### Variant consequence (`scaleColors` in `src/filter-config.ts`)

| Class | Colour | As drawn | vs white (as drawn) |
|---|---|---|---|
| Pathogenic | `#990000` | `#c26666` | 3.90:1 |
| Benign | `#99cc00` | `#c2e066` | **1.48:1** |
| Predicted | `#4c8acd` | `#94b9e1` | **2.04:1** |
| Uncertain / other | `#009e73` | `#66c5ab` | **2.07:1** |

- **Pairs that become hard to tell apart:** predicted and uncertain under tritanopia (ΔE00 8.6). No other pair falls below 10; the closest are pathogenic and uncertain under deuteranopia (17.9) and benign and uncertain under protanopia (21.2).
- **Meaning lost:** pathogenic and benign stay far apart (ΔE00 34.9 protanopia, 24.7 deuteranopia) but take the same hue, 96° and 95° under protanopia and 97° and 96° under deuteranopia (olive against pale yellow). They differ only in lightness (L* 49 against 85 under protanopia), so a reader can tell two dots apart but not which one is pathogenic.
- **Besides colour:** every variant is the same circle. The variant filter lists each class as a text label beside a checkbox in the class colour, and unticking classes isolates one, which is a real non-colour route. The tooltip names the consequence and clinical significance (`src/tooltips/resolve.ts:679-684`), but it opens only with a pointer click.

#### AlphaFold confidence (pLDDT)

The coloured-sequence track, the registry theme and the structure-panel legend all use the same four colours.

| Category | Colour | vs white |
|---|---|---|
| Very low (< 50) | `#ff7d45` | **2.54:1** |
| Low (50–70) | `#ffdb13` | **1.36:1** |
| Confident (70–90) | `#65cbf3` | **1.84:1** |
| Very high (> 90) | `#0053d6` | 6.55:1 |

- **Pairs that become hard to tell apart:** none. The closest pair is very low and low under deuteranopia (ΔE00 14.4).
- **Order:** lightness does not follow the order (L* 67, 88, 77, 40 in normal vision), so the order is carried by hue and the legend.
- **Besides colour:** the track has no legend; the structure panel shows one with text bands when it is open. The tooltip gives the pLDDT number but not the band name.

#### AlphaMissense

The default config draws AlphaMissense three ways: the average-pathogenicity coloured sequence and the heatmap, both through the `alphamissense-ramp` theme, and the 3D model in the structure panel.

**Coloured sequence (average pathogenicity).** The adapter puts each residue's average score into one of eight buckets and writes a letter for it; the theme's `scale` maps each letter to a value on the ramp. `nightingale-colored-sequence` 5.11 upper-cases those letters, so `H`/`h`, `L`/`l` and `P`/`p` collide and the later value wins. Measured in Chromium by `src/__browser__/score-colours.browser.spec.ts`:

| Letter | Score | Class | Intended | Drawn | Drawn vs white |
|---|---|---|---|---|---|
| `H` | 0–0.1132 | likely benign | `#4290bf` | **`#e99e7c`** (wrong) | 2.18:1 |
| `V` | 0.1132–0.2264 | likely benign | `#8cbcd4` | `#8cbcd4` | 2.05:1 |
| `L` | 0.2264–0.3395 | likely benign | `#c3d6e0` | **`#edcdba`** (wrong) | 1.50:1 |
| `A` | 0.3395–0.4527 | ambiguous (from 0.34) | `#e2e2e2` | `#e2e2e2` | 1.30:1 |
| `l` | 0.4527–0.5895 | ambiguous, then likely pathogenic from 0.564 | `#edcdba` | `#edcdba` | 1.50:1 |
| `h` | 0.5895–0.7264 | likely pathogenic | `#e99e7c` | `#e99e7c` | 2.18:1 |
| `p` | 0.7264–0.8632 | likely pathogenic | `#d15e4b` | **`#b2182b`** (wrong) | 6.87:1 |
| `P` | 0.8632–1 | likely pathogenic | `#b2182b` | `#b2182b` | 6.87:1 |
| `-` | no score | — | transparent | transparent | nothing drawn |

- The most benign residues (`H`) are drawn in the same colour as likely-pathogenic ones (`h`), and the `L` bucket in the same colour as `l`. Only one benign bucket (`V`) is drawn blue. This affects every reader, not only colour-blind readers (issue to file: E).
- The transparent placeholder works as intended: a residue with no score draws nothing. It is close to the ambiguous colour `#e2e2e2` (ΔE00 6.1 against white under every simulation, since both are grey), so "no score" and "ambiguous" are hard to tell apart.

**Heatmap and 3D model.** Both use the nine-stop ramp from `#2166ac` to `#b2182b` continuously; the heatmap leaves out the transparent placeholder stop. Sampled at the centre of each AlphaMissense class:

| Class centre | Colour | vs white |
|---|---|---|
| Likely benign (0.170) | `#67a6ca` | **2.66:1** |
| Ambiguous (0.452) | `#e2e2e2` | **1.30:1** |
| Likely pathogenic (0.782) | `#df8468` | **2.75:1** |

- **Pairs that become hard to tell apart:** none between classes; the closest is benign and ambiguous under protanopia (ΔE00 21.4). The closest neighbouring stops are ΔE00 6.4 apart under protanopia and 11.5 under tritanopia, which suits a continuous scale.
- **Contrast:** the whole ambiguous class is 1.30–1.50:1 against white, so it reads as "no data".

**Legend and theme.** The structure panel's legend swatches do not match the 3D model: benign `#3d5493` against `#67a6ca` drawn (ΔE00 31.1), ambiguous `#a8a9ad` against `#e2e2e2` (14.5), pathogenic `#9a131a` against `#df8468` (32.4). The registry theme `alphamissense-ramp` that `getTheme()` returns (`#3457b9`, `#d7d7d7`, `#ca1615`) is not used for drawing (issue to file: G).

**Besides colour:** the tooltip gives the score as a number ("Pathogenicity score") but not the class name, and opens only with a pointer click. The tracks have no legend; the structure panel's legend has text bands but the swatches do not match the model.

#### Feature-type colours

The 45 type colours are Nightingale's defaults (listed on [Feature type and shape vocabulary](https://ebi-webcomponents.github.io/protvista/type-and-shape-vocabulary)). Groups start collapsed, and a collapsed group draws all its types in one aggregate track, so the check is within each default group, with colours as drawn at 90% opacity.

| Group | Pairs below ΔE00 10 (worst vision) | Same shape? |
|---|---|---|
| Sites | DNA binding / metal binding 0.8 (tritanopia); binding site / DNA binding 5.4 (tritanopia); binding site / metal binding 6.1 (tritanopia); active site / calcium binding 6.4 (tritanopia); metal / nucleotide binding 7.3 (protanopia); active site / nucleotide binding 9.2 (tritanopia); DNA / nucleotide binding 9.7 (protanopia) | DNA binding and binding site, and DNA and nucleotide binding, share the rectangle; the rest differ |
| Domains | Motif / zinc finger 2.4 (protanopia) | Yes (rectangle) |
| PTM | Cross-link / PTMeXchange Gold 1.3 (deuteranopia); lipidation / Gold 6.0; cross-link / lipidation 7.1; disulfide bond / Gold 7.7 (protanopia); glycosylation / PTMeXchange Bronze 7.7 (tritanopia); glycosylation / cross-link 9.2 (tritanopia) | No |
| Sequence information | Non-adjacent / non-terminal residues 4.2 (deuteranopia); compositional bias / non-terminal 6.7; compositional bias / non-adjacent 8.7 | Non-adjacent and non-terminal share the double bar |
| Molecule processing | Initiator methionine / signal peptide 4.3 (deuteranopia) | No (arrow, rectangle) |
| Topology, Epitopes, Antigenic sequences, Mutagenesis, Proteomics, PDBe 3D structure coverage | None | — |

- Metal binding and DNA binding are hard to tell apart even in normal vision (ΔE00 5.5).
- 12 of the 45 colours are below 3:1 against white as specified, and 14 as drawn. The lowest are sequence uncertainty 1.36:1, beta strand 1.51:1, propeptide 1.77:1, epitope 1.78:1 and lipidation 1.90:1.
- Epitopes, antigens and large-scale mutagenesis: in the recorded P05067 responses their types are `EPITOPE`, `ANTIGEN` and `MUTAGENESIS`. `MUTAGENESIS` is not in Nightingale's type table, so it is drawn as a black rectangle (Nightingale's fallback), far from the orange of the `MUTAGEN` sites it shares the Mutagenesis group with.
- **Besides colour:** where shapes differ they help, but small shapes are hard to tell apart at low zoom. Expanding a group draws each type on its own labelled track, which removes the problem. The tooltip names the type, but only by pointer.

#### InterPro representative domains

The Domains group's InterPro track colours each entry by a hash of its accession (`color-hash` in `src/schema/adapters/interpro-adapter.ts`, copied from InterPro's site). The script reproduces the library exactly and lists every colour it can give.

- 1531 of the 3231 possible colours (47%) are below 3:1 against white as drawn.
- Nothing keeps two entries on one protein apart, so two domains can get the same or a very similar colour. Each domain's name is in its tooltip only (pointer). The recorded P05067 response has no representative domain, so it gives no example to measure.

#### Count graphs

The Variants and RNA editing groups each start with a count graph (`nightingale-linegraph-track`), drawn at full opacity.

- The variant-count graph draws all variants in `darkgrey` (`#a9a9a9`, 2.35:1 against white) and disease-causing variants in `red` (`#ff0000`, 4.00:1). The two lines stay at least ΔE00 27 apart under every simulation, so they remain distinguishable, but only colour says which is which: neither ProtVista nor the component draws a legend.
- The RNA editing graph draws one `darkgrey` line.

#### Other built-in colours

PTMeXchange confidence (Gold `#c39b00`, Silver `#8194a1`, Bronze `#a65708`, no score black) keeps every pair above ΔE00 15 under all three simulations; Gold (2.36:1) and Silver (2.73:1) are below 3:1 as drawn. The isoform colours (`#0053d6`, `#888888`; not in the default config) are at least ΔE00 23 apart and at least 3:1.

## The four baseline gaps, revisited

| Gap in `accessibility-baseline.md` | Status at `09f1832` | Evidence | Tracking |
|---|---|---|---|
| 1. Filter `<select>` labelling | Open | Still named only by `aria-label="Filter by <column>"`, with no `<label for>`; a column without a label gives the select no name (`src/protvista-uniprot-datatable.ts:460-465`). | #312 |
| 2. "No results" is not a live region | Open | The datatable has no `role="status"` region; the empty state is a plain row inside `role="listbox"` (`:476-484`). | #312 |
| 3. Group label wraps nested controls | Open | Outside Customize mode the header is still a `role="button"` `<div>` holding the label's links, the ⚠ badge and Retry (`src/protvista-uniprot.ts:4239-4251`). axe reports `nested-interactive`; a browser test now pins this so a fix shows up. Customize mode and groups with no data at all already avoid the nesting. | Issue to file: B |
| 4. Nightingale track internals | Assessed, not fixed | See the next section. Fixes are out of scope for #382. | Issues to file: A, H, I |

## Nightingale track internals

The tracks are drawn by the upstream `@nightingale-elements/*` 5.11 components. ProtVista can work around some limitations in its own wrapper but cannot fix them inside the components. Found by inspecting the installed bundles:

- **No accessibility hooks.** None of the track components (`nightingale-track-canvas`, `-variation-canvas`, `-colored-sequence`, `-sequence-heatmap`, `-linegraph-track`, `-sequence`, `-navigation`, `-manager`) contains a `tabindex` or `aria-` attribute. Their only key handling is the d3 brush's modifier keys during a drag, and Escape to clear a heatmap selection.
- **Pointer-only interaction.** Features report clicks and hovers as `change` events; zooming uses the navigation brush or Ctrl+scroll.
- **Variant glyphs.** `nightingale-variation-canvas` draws every variant as a filled circle at 60% opacity, so class can only be shown by colour.
- **Feature opacity.** `nightingale-track-canvas` draws features at 90% opacity unless a feature sets its own.
- **Coloured-sequence scale letters.** `nightingale-colored-sequence` upper-cases `scale` keys and residue letters, which causes the AlphaMissense colour defect above.
- **Variant filter.** `nightingale-filter` puts `tabindex="0"` and `outline: none` on each checkbox's `<label>`, adding a Tab stop with no visible focus.
- **Default type colours.** The collisions and low-contrast colours above come from Nightingale's type table.
- **Mol* keys.** `nightingale-structure` builds its Mol* 3.44 viewer with the `CameraControls` behaviour, which binds I, O and T to spin, rock and reset the view, with no modifier (2.1.4).

## Issues to file

None of these is tracked yet. They are drafted here for the maintainer to file; letters match the tracking column above. K–R come from the automated browser checks; each is pinned by a browser test that names its letter, so a fix shows up as a test to update.

- **A.** Tracks: give track features a text alternative and a keyboard path, including a way to open their tooltips, and make the tooltip a named dialog rather than `role="tooltip"` (1.1.1, 2.1.1, 4.1.2). Build it in ProtVista's wrapper, and raise the missing hooks (no roles, names or keyboard focus) with Nightingale.
- **B.** Group header: separate the collapse button from the label's links, ⚠ badge and Retry, so it no longer fails `nested-interactive` (1.3.1, 4.1.2; baseline gap 3).
- **C.** Variants: choose consequence colours that stay distinct under colour-vision deficiency and reach 3:1 as drawn, keep the filter legend in step, and consider a non-colour cue per class (1.4.1, 1.4.11).
- **D.** Viewer: add zoom and pan controls that work with a keyboard and a single click (2.1.1, 2.5.7).
- **E.** AlphaMissense coloured sequence: three score buckets are drawn in another bucket's colour because Nightingale upper-cases the scale letters; the most benign residues are drawn likely-pathogenic salmon.
- **F.** Score tooltips: add the class name ("Very high", "Likely pathogenic") to the pLDDT and AlphaMissense score (1.4.1).
- **G.** AlphaMissense: make the structure legend and the registry theme use the colours the track, heatmap and 3D model actually draw.
- **H.** Feature-type default colours: report the within-group collisions and the 14 colours below 3:1 to Nightingale, and decide whether ProtVista overrides the worst pairs (1.4.1, 1.4.11).
- **I.** `nightingale-filter`: remove the focusable `<label>` without a focus indicator (2.4.7), upstream.
- **J.** Playground: give the panel splitter a single-pointer alternative to dragging (2.5.7), and a target at least 24 px wide (it is 8 px; 2.5.8).
- **K.** Playground: when a changed accession makes the preview fail, do not move focus into the preview's error alert; announce it and leave focus where the author put it (3.2.2). Pinned in `a11y-playground.browser.spec.ts`.
- **L.** Datatable: keep focus on a filter when its value changes, instead of moving it to the rows in `updated()` (3.2.2). Pinned in `a11y-structure-panel.browser.spec.ts`.
- **M.** Datatable: keep the focused row clear of the sticky header when the table scrolls (for example `scroll-padding-top` on the scroll box) (2.4.11). Pinned in `a11y-structure-panel.browser.spec.ts`.
- **N.** Validation messages: rewrite the schema validator's raw messages for enum values and unexpected keys so they list the allowed values and name the key, and drop the misleading "must have required property" that follows them (3.3.3). Related: #307. Pinned in `a11y-playground.browser.spec.ts`.
- **O.** Notes and badges: close an open popover on the click outside, not on `pointerdown` (2.5.2). Pinned in `a11y-viewer-keyboard.browser.spec.ts`.
- **P.** Structure panel, upstream: Mol*'s single-letter camera keys (I, O, T) act whenever the pointer is over the 3D view and focus is on the page; ask Nightingale to leave out `CameraControls`, require a modifier, or offer a way to turn them off (2.1.4).
- **Q.** Viewer: let the track area shrink when its container narrows (browser zoom, a narrower window); today only a redraw makes it fit (1.4.4, 1.4.10; not a failure, since the track area is exempt). Pinned in `a11y-zoom-reflow.browser.spec.ts`.
- **R.** Viewer: give the label column a usable minimum width, or wrap its contents inside it, so the Customize button, the variant filter and long words stay in the column at 320 px (1.4.10). Pinned in `a11y-zoom-reflow.browser.spec.ts`.

## Manual passes still to do

The automated browser checks replaced most of the keyboard-only and zoom passes. What still needs a person:

| Pass | What the tester does | Criteria it settles |
|---|---|---|
| Screen readers | With VoiceOver and Safari (macOS) and NVDA with Firefox and Chrome (Windows), walk the viewer on a docs embed page with P05067 and the playground presets "Your own variants", AlphaMissense and EGFR. Cover groups, tracks, tooltips, ⓘ notes, ⚠ badges, Customize mode and the structure panel. Record what is announced, and whether browse mode reads in the order the accessibility tree has. | 1.3.2, 4.1.2, 4.1.3 (and confirms 3.3.1) |
| Mol* 3D view | In a browser with WebGL and network access, open the structure panel for P05067. Tab into and out of the 3D view; check what focus reaches there and whether anything opens on focus; press I, O and T with the pointer over the view; press on it and release elsewhere; check for pinch or path gestures. | 2.1.2, 2.1.4 (confirms P), 2.4.3, 3.2.1, 2.5.1, 2.5.2 |
| Instructions and motion | Read every on-screen instruction (playground notices, help text, ⓘ notes) for references to colour, shape or position alone; on a throttled connection, check whether a loading spinner runs for more than 5 seconds beside other content. | 1.3.3, 2.2.2 |
| Other browsers | Repeat the Tab walk in Firefox and in Safari (with "Press Tab to highlight each item" on), and 200% text-only zoom in Firefox. | Confirms 2.1.2, 2.4.3, 2.4.7, 1.4.4 |
| Text spacing in the tracks | With a text-spacing bookmarklet, look at the ruler numbers and sequence letters Nightingale draws in SVG. | 1.4.12 |
| Colour-blind check by eye | Chrome DevTools "Emulate vision deficiencies" on the variants track, AlphaFold, AlphaMissense and a collapsed Sites group, to confirm the computed results. Attach screenshots. | 1.4.1 |

## Reproducing the figures

Run from the repository root, after `pnpm install`, on the commit that adds this report or any later one. The script and the pinned browser tests are new with this report, so they cannot be run on `09f1832`; the code they measure is the same there (between the two commits `src/` changes only by these tests and a comment in `src/schema/registry.ts`).

```sh
python3 scripts/accessibility/palette_audit.py           # every colour figure in this report
python3 scripts/accessibility/palette_audit.py --json    # the same, as JSON
python3 scripts/accessibility/palette_audit.py --check   # do this report and the docs page still match?
pnpm test:palettes                                       # the script's own tests, including --check
pnpm exec vitest run --project browser \
  src/__browser__/score-colours.browser.spec.ts \
  src/__browser__/group-toggle.browser.spec.ts           # AlphaMissense colours drawn; nested-interactive
pnpm exec vitest run --project browser \
  src/__browser__/a11y-viewer-keyboard.browser.spec.ts \
  src/__browser__/a11y-playground.browser.spec.ts \
  src/__browser__/a11y-structure-panel.browser.spec.ts \
  src/__browser__/a11y-zoom-reflow.browser.spec.ts       # the automated browser checks (Chromium)
pnpm test:browser                                        # every axe and keyboard test cited above
grep -rnE "\.key ===?|e\.key|event\.key" src --include=*.ts \
  | grep -v __                                           # ProtVista's key handlers (2.1.4)
grep -oE 'key(SpinAnimation|RockAnimation|ResetView):[^]]*]|Behavior\([^)]*CameraControls\)' \
  node_modules/@nightingale-elements/nightingale-structure/dist/index.js  # Mol*'s I, O and T keys
grep -cE 'tabindex|aria-' node_modules/@nightingale-elements/nightingale-track-canvas/dist/index.js
```

The first `grep` lists every keyboard handler in ProtVista's source (two of its lines read data keys, not keyboard keys); the second prints Mol*'s three single-letter bindings and the line that includes them in `nightingale-structure`'s viewer. The `grep -cE 'tabindex|aria-'` command prints 0; replace the package name to check the other components. The variant and feature opacities are read from the same bundles by the palette script, which exits with an error if they differ from the ones it assumes.
