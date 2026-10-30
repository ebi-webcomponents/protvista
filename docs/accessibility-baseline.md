# Accessibility baseline (Q3 WCAG audit)

This document is the accessibility baseline for `protvista-uniprot`,
established alongside the browser-mode component test layer
([issue #213](https://github.com/ebi-webcomponents/protvista/issues/213)).
It records what is now covered by automated accessibility + interaction
tests, what those tests verify, and the residual gaps a manual WCAG audit
should still review.

The audit itself, with a result for each WCAG 2.2 AA criterion and the
colour-blind check of the default palettes, is in
[`accessibility-audit.md`](./accessibility-audit.md) (issue #382).

## How accessibility is tested

Two Vitest projects run side by side (see `vite.config.mjs`):

| Project   | Environment            | Purpose                                             |
| --------- | ---------------------- | --------------------------------------------------- |
| `unit`    | jsdom                  | The existing fast logic/DOM suite (`*.spec.ts`).    |
| `browser` | Playwright / Chromium  | Real-DOM a11y + interaction tests (`*.browser.spec.ts`). |

The browser project renders components for real and asserts with
[`axe-core`](https://github.com/dequelabs/axe-core) (helper:
`src/__browser__/axe.ts`, `expectNoA11yViolations`). Interactions are
driven with real keyboard/pointer events via `vitest/browser`'s
`userEvent`. Run them with:

```sh
pnpm test:browser      # browser project only
pnpm test:coverage     # both projects + coverage thresholds (issue #162)
```

CI installs Chromium (`pnpm exec playwright install --with-deps chromium`) and
runs `test:browser` and `test:coverage` on every push/PR.

## What is covered and verified

### Datatable — `<protvista-uniprot-datatable>` (`src/__browser__/datatable.browser.spec.ts`)

- **axe:** no violations on the rendered table.
- **Labelling:** `role="listbox"` + `aria-label="Results"` on the body;
  each filter `<select>` carries `aria-label="Filter by <column>"`.
- **Keyboard operability:** roving `tabindex` (exactly one row tabbable);
  ArrowUp/ArrowDown/Home/End move focus; Enter/Space select and fire
  `row-click` with `aria-selected` updated.
- **Non-color signalling:** selection is conveyed by `aria-selected`
  (and the `active` part), not colour alone.
- **Filtering:** `<select>` narrows/restores rows; the empty state renders
  a "No matching results" cell.

### Error surfaces — `<protvista-uniprot>` (`src/__browser__/error-retry.browser.spec.ts`)

- **axe:** no violations on the mount-level alert panel or the per-track
  error group.
- **Alert panel:** `role="alert"`; focus is moved into the panel when it
  appears; Retry re-fetches and tears the panel down on recovery.
- **Per-track badge:** a `<button>` like the visitor ⓘ (`aria-expanded`,
  `aria-controls` its popover). When the error's text says more than the
  button's name, it is also the button's `aria-describedby`, so it is heard
  on focus without opening the note. It shares a line with its Retry, so the
  note, which opens below it, never covers Retry;
  its Retry recovers the track under a real click.

### Group expand/collapse — `<protvista-uniprot>` (`src/__browser__/group-toggle.browser.spec.ts`)

- **Fixed in this work:** the toggle was a bare `<div @click>` — operable
  by mouse only. It now exposes `role="button"`, `tabindex="0"`, and a
  live `aria-expanded`, and activates on **Enter/Space** as well as click.
- **axe:** no violations over a group with nothing nested in its label. A
  label carrying a `⚠` badge (and Retry) fails `nested-interactive`: see
  known gap 3.

### "Customize layout" mode (`src/__browser__/customize-mode.browser.spec.ts`)

The track-configuration UI ([issue #199](https://github.com/ebi-webcomponents/protvista/issues/199))
is now built: an end user can reorder rows, reorder tracks within a group, and
show/hide either, directly on the rows themselves — backed by the runtime
layout API, which rewrites the config, and per-config persistence. See
[Customize the layout](https://ebi-webcomponents.github.io/protvista/customize-layout)
(`docs/src/content/docs/customize-layout.md`).

- **axe:** no violations with the mode active on a mounted viewer.
- **Real controls:** show/hide is a `role="switch"` `<button>` whose state
  rides on `aria-checked` and the thumb's position, never colour alone; its
  accessible name is a stable purpose ("Show X"). Its off track meets 3:1
  non-text contrast (1.4.11) and has a `forced-colors` fallback. Reordering is
  move-up/down buttons only — there is no drag gesture to fail WCAG 2.5.7.
  Controls are at least 24×24 px (2.5.8).
- **Dead ends removed:** a track with no data has its Show switch disabled
  and named "Show X — no data", rather than offering a press that visibly does
  nothing. The "N hidden" badge is a button, not a `<span title>`, so the
  explanation of how to undo a hide is reachable without a mouse — and
  pressing it opens the groups holding those tracks, then announces how many
  it opened, so the badge leads somewhere instead of merely reporting.
- **Announcements:** a polite live region announces each reorder ("… moved to
  position N of M"), hide, and show (4.1.3).
- **Focus:** a visible focus ring on every control; Done returns focus to the
  Customize button that opened the mode, and a move that disables the button
  you pressed hands focus to its opposite number rather than dropping it
  (2.4.7).
- **Nothing is displaced:** the Customize button lives in the empty label cell
  beside the navigation, so entering the mode does not move the visualization
  — a browser test pins that the manager's position is unchanged.
- **Hidden in place:** a hidden row or track stays where it was as a dimmed
  stub with a muted italic label and its switch turned off (`aria-checked`
  false, thumb left), so its state never rides on colour or opacity alone.
  Outside the mode a
  "N hidden" count reports what is missing, and an all-hidden viewer says so
  rather than rendering an empty frame.

## Known residual gaps (for the manual audit)

These are documented, not yet remediated. The #382 audit re-checked them on
`next` at `09f1832` and all four are still open: gaps 1 and 2 are tracked by
#312, gap 3 now has a browser test that pins the `nested-interactive` failure,
and gap 4 is assessed in
[`accessibility-audit.md`](./accessibility-audit.md#nightingale-track-internals).

1. **Filter `<select>` labelling.** Filter selects are labelled with
   `aria-label` rather than a visible `<label for>` associated with the
   column header text. Screen-reader-accessible, but a visible programmatic
   association would be stronger.
2. **"No results" is not a live region.** When a filter empties the table,
   the empty-state cell is not announced (`aria-live`) to screen readers.
3. **Group label / nested controls.** A group label may contain an inline
   `<a>` (Markdoc), and a group with a failed track carries its `⚠` badge,
   the badge's popover and a Retry. The toggle wraps them all as
   `role="button"`, which axe reports as `nested-interactive`; while a
   badge's popover is open, its text also joins the group's accessible
   name. Each control still works on its own — a click on one never
   toggles the group, and the toggle's keydown handler acts only on keys
   pressed on the label itself, so Enter on a link or Enter/Space on the
   badge or Retry activates that control — but a cleaner DOM would separate
   the collapse affordance from the label's contents. The #199 Track
   Manager controls deliberately avoid this pattern (real, separate
   `<button>`s with no nested interactive content); the legacy collapse
   toggle is left as-is for now since it is functionally correct, and a DOM
   cleanup of the group header is a separate, low-risk follow-up.
4. **Nightingale track internals** (canvas/SVG rendering) are out of scope
   here (stubbed in tests) and must be assessed separately.

## Coverage floor

`vite.config.mjs` enforces a coverage floor (issue #162) just below the
current baseline: statements 80 / branches 74 / functions 78 / lines 81.
Ratchet these up as coverage grows.
