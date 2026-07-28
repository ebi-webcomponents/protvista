# Accessibility baseline (Q3 WCAG audit)

This document is the accessibility baseline for `protvista-uniprot`,
established alongside the browser-mode component test layer
([issue #213](https://github.com/ebi-webcomponents/protvista/issues/213)).
It records what is now covered by automated accessibility + interaction
tests, what those tests verify, and the residual gaps a manual WCAG audit
should still review.

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
yarn test:browser      # browser project only
yarn test:coverage     # both projects + coverage thresholds (issue #162)
```

CI installs Chromium (`npx playwright install --with-deps chromium`) and
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
- **Per-track badge:** `role="img"`, `tabindex="0"`, described by a
  visually-hidden detail via `aria-describedby`; its Retry recovers the
  track under a real click.

### Group expand/collapse — `<protvista-uniprot>` (`src/__browser__/group-toggle.browser.spec.ts`)

- **Fixed in this work:** the toggle was a bare `<div @click>` — operable
  by mouse only. It now exposes `role="button"`, `tabindex="0"`, and a
  live `aria-expanded`, and activates on **Enter/Space** as well as click.
- **axe:** no violations over the group.

### "Customize layout" mode (`src/__browser__/customize-mode.browser.spec.ts`)

The track-configuration UI ([issue #199](https://github.com/ebi-webcomponents/protvista/issues/199))
is now built: an end user can reorder rows, reorder tracks within a group, and
show/hide either, directly on the rows themselves — backed by the runtime
layout API, which rewrites the config, and per-config persistence. See
[`docs/track-configuration.md`](./track-configuration.md).

- **axe:** no violations with the mode active on a mounted viewer.
- **Real controls:** show/hide is a `<button>` with `aria-pressed` plus an
  action word ("Hide X" / "Show X") and an eye / slashed-eye icon, never
  colour or icon alone. Reordering is move-up/down buttons only — there is no
  drag gesture to fail WCAG 2.5.7. Controls are at least 24×24 px (2.5.8).
- **Dead ends removed:** a track with no data has its Show control disabled
  and named "No data for X", rather than offering a press that visibly does
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
  stub with a muted italic label, an eye-slash icon, and a "Show" action word,
  so its state never rides on colour or opacity alone. Outside the mode a
  "N hidden" count reports what is missing, and an all-hidden viewer says so
  rather than rendering an empty frame.

## Known residual gaps (for the manual audit)

These are documented, not yet remediated:

1. **Filter `<select>` labelling.** Filter selects are labelled with
   `aria-label` rather than a visible `<label for>` associated with the
   column header text. Screen-reader-accessible, but a visible programmatic
   association would be stronger.
2. **"No results" is not a live region.** When a filter empties the table,
   the empty-state cell is not announced (`aria-live`) to screen readers.
3. **Group label / inline-link nesting.** A group label may contain an
   inline `<a>` (Markdoc). The toggle wraps it as `role="button"`, which is
   imperfect nesting of interactive content. Activating the link never
   toggles the group (the shared handler bails when the event target is an
   `<a>`, and the link stays independently focusable), but a cleaner DOM
   would separate the collapse affordance from the link. The #199 Track
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
