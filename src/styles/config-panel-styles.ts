import { css, unsafeCSS } from 'lit';
import { CSS_PREFIX } from './css-prefix.js';
import { tokenRef } from './tokens.js';

/**
 * Light-DOM styles for "Customize layout": the toggle that enters the mode,
 * the per-row control clusters it turns on, and the drag placeholder.
 *
 * The controls live inside each row's label cell rather than in a panel or
 * modal, so nothing here displaces or covers the visualization — entering
 * customize mode must not move the tracks the user is about to arrange. The
 * one concession is a wider label column while customizing (see
 * `--protvista-label-width` below), since the controls and the label share
 * that cell.
 *
 * Conventions match `protvista-styles.ts` / `error-styles.ts`: internal class
 * names carry the collision-proof `CSS_PREFIX` hash and every rule is scoped
 * under the `protvista-uniprot` element tag (light DOM — see
 * `createRenderRoot()` in `protvista-uniprot.ts`). Colours flow through the
 * shared `--protvista-*` theming tokens (see `styles/tokens.ts`) with a
 * literal fallback, so the controls restyle with the rest of the viewer.
 */
const p = unsafeCSS(CSS_PREFIX);

/**
 * Read a token whose default is another token, carrying the whole
 * default chain down to the literal — see `tokenRef` in tokens.ts. The
 * literal fallbacks written out by hand below are the same idea for
 * tokens that default to a literal directly.
 */
const ref = (name: string) => unsafeCSS(tokenRef(name));

export default css`
  /* The label column doubles as the customize toolbar: the toggle sits in the
     empty cell beside the navigation, in the same column as the per-row
     controls it reveals.

     Stacked in rows rather than left to wrap: what is on screen (Customize,
     and the count of what is not) belongs on one line, and the actions that
     change it on the next. Letting them wrap put Done alone on a second row
     at some widths and not others. */
  protvista-uniprot .${p}-nav-track-label {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 0.3rem;
  }

  protvista-uniprot .${p}-toolbar-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
  }

  /* The actions row is always laid out, and merely made invisible outside
     customize mode, so entering the mode adds no height and the navigation
     ruler does not step down. Reserving it with a min-height would mean
     hard-coding a number that has to track the buttons' own metrics;
     visibility does it exactly, and takes them out of the tab order and the
     accessibility tree while it is at it. */
  protvista-uniprot .${p}-toolbar-row--reserved {
    visibility: hidden;
  }

  protvista-uniprot .${p}-customize-toggle,
  protvista-uniprot .${p}-customize-action {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    /* WCAG 2.5.8 Target Size (Minimum) — 24px is the floor for a pointer
       target, and these are small icon-bearing controls. */
    min-height: 24px;
    padding: 0.2rem 0.5rem;
    /* #8c8c8c, not the lighter --protvista-color-border (#c5c8cc, 1.68:1): an
       interactive control's boundary needs 3:1 against the page (WCAG 1.4.11).
       #8c8c8c clears it at ~3.4:1. */
    border: 1px solid #8c8c8c;
    border-radius: var(--protvista-radius, 4px);
    background: var(--protvista-color-surface, #ffffff);
    color: var(--protvista-color-text, #222222);
    font-family: var(--protvista-font-family, inherit);
    font-size: var(--protvista-font-size, 0.8rem);
    cursor: pointer;
  }

  protvista-uniprot .${p}-customize-toggle:hover,
  protvista-uniprot .${p}-customize-action:hover:not([disabled]) {
    background: var(--protvista-color-bg-hover, #f1f7ff);
  }

  protvista-uniprot .${p}-customize-action[disabled] {
    opacity: 0.5;
    cursor: default;
  }

  protvista-uniprot .${p}-customize-toggle:focus-visible,
  protvista-uniprot .${p}-customize-action:focus-visible,
  protvista-uniprot .${p}-switch:focus-visible,
  protvista-uniprot .${p}-row-control:focus-visible {
    outline: 2px solid var(--protvista-color-accent, #0053d6);
    outline-offset: 2px;
  }

  /* Pressed (customize mode active): accent border + tinted background, so
     the state is carried by more than colour alone — the button also reports
     its aria-pressed state. */
  protvista-uniprot .${p}-customize-toggle[aria-pressed='true'] {
    border-color: var(--protvista-color-accent, #0053d6);
    background: var(--protvista-color-bg-active, #e6f3ff);
  }

  protvista-uniprot .${p}-customize-toggle__icon {
    display: inline-flex;
  }

  protvista-uniprot .${p}-customize-toggle__icon svg {
    width: 16px;
    height: 16px;
  }

  protvista-uniprot .${p}-hidden-count {
    min-height: 24px;
    padding: 0.2rem 0.4rem;
    border: 0;
    border-radius: var(--protvista-radius, 4px);
    background: none;
    font-family: var(--protvista-font-family, inherit);
    font-size: var(--protvista-font-size, 0.8rem);
    color: var(--protvista-color-text-muted, #4a5056);
    text-decoration: underline dotted;
    cursor: pointer;
  }

  protvista-uniprot .${p}-hidden-count:hover {
    background: var(--protvista-color-bg-hover, #f1f7ff);
  }

  protvista-uniprot .${p}-hidden-count:focus-visible {
    outline: 2px solid var(--protvista-color-accent, #0053d6);
    outline-offset: 2px;
  }

  /* ── Per-row controls ─────────────────────────────────────── */

  /* Controls sit *after* the label and are pushed to the far end of the cell,
     against the divider. Two reasons over putting them first:

     the label then never moves between the default and editing views — the
     text you were reading stays exactly where it was when the mode opens,
     and keeps its full width instead of giving ~160px to a control cluster;

     and in DOM order the row now announces what it is before what can be
     done to it, so a screen-reader user is not tabbing through Hide/Move
     before hearing which row they are on.

     The trade is that a control sits further from its label on a wide
     column, and a long label ellipsizes against the cluster rather than
     the cell edge. */
  protvista-uniprot .${p}-row-controls {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    margin-left: auto;
    padding-left: 0.5rem;
    vertical-align: middle;
    /* Never let the controls be squeezed — the label gives way instead. */
    flex: 0 0 auto;
  }

  /* Controls and label share a fixed-width cell while customizing, so the
     label gives way first. It needs to be a real element rather than a bare
     text node: an anonymous flex item cannot take a zero min-width, so it
     refused to shrink and pushed the control cluster out of the cell
     entirely. Wrapped, it shrinks and truncates properly — with a real
     ellipsis, where the cell used to clip mid-glyph. The full text stays on
     the cell's title attribute and in every control's aria-label. */
  protvista-uniprot .${p}--customizing .${p}-track-label,
  protvista-uniprot .${p}--customizing .${p}-group-label {
    display: flex;
    align-items: center;
    overflow: hidden;
  }

  protvista-uniprot .${p}--customizing .${p}-label-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  protvista-uniprot .${p}-row-control {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    min-width: 24px;
    min-height: 24px;
    padding: 0.1rem 0.25rem;
    /* 3:1 boundary against the page (WCAG 1.4.11); see the customize-toggle
       note above — #c5c8cc was only 1.68:1. */
    border: 1px solid #8c8c8c;
    border-radius: var(--protvista-radius, 4px);
    background: var(--protvista-color-surface, #ffffff);
    color: var(--protvista-color-text, #222222);
    font-family: var(--protvista-font-family, inherit);
    font-size: var(--protvista-font-size, 0.8rem);
    line-height: 1;
    cursor: pointer;
  }

  protvista-uniprot .${p}-row-control:hover:not([disabled]) {
    background: var(--protvista-color-bg-hover, #f1f7ff);
  }

  protvista-uniprot .${p}-row-control[disabled] {
    opacity: 0.4;
    cursor: default;
  }

  /* A switch fades less than a plain button would: at 0.4 the track washed
     out and the control read as a stray dot rather than as a switch that
     happens to be unavailable. */
  protvista-uniprot .${p}-switch[disabled] {
    opacity: 0.55;
    cursor: not-allowed;
  }

  /* The visibility switch. It reports a state; the move buttons beside it
     perform actions — so it does not share their bordered-box look, and a gap
     separates the two categories.

     Standard proportions: a thin track with a white thumb that nearly fills
     it. The earlier version had a 10px thumb floating in a 16px track, which
     is what made it read as a fat pill rather than a switch.

     State rides on the thumb's position as well as the track colour, so it is
     never carried by hue alone (WCAG 1.4.1).

     The OFF track is a deliberate #767676 rather than the lighter
     --protvista-color-border (#c5c8cc): the switch is border-less, so its fill
     *is* its boundary, and #767676 clears 3:1 against both the white thumb and
     the white page (WCAG 1.4.11 non-text contrast) for the hidden state — the
     one it most needs to convey. #c5c8cc was only 1.68:1. */
  protvista-uniprot .${p}-switch {
    position: relative;
    flex: 0 0 auto;
    width: 26px;
    min-width: 26px;
    height: 14px;
    margin: 0 0.4rem 0 0;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: #767676;
    cursor: pointer;
    transition: background-color 120ms ease;
  }

  protvista-uniprot .${p}-switch::after {
    /* Restores the 24px pointer target (WCAG 2.5.8) without fattening the
       artwork back up. */
    content: '';
    position: absolute;
    inset: -6px -4px;
  }

  protvista-uniprot .${p}-switch__thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--protvista-color-surface, #ffffff);
    transition: transform 120ms ease;
  }

  protvista-uniprot .${p}-switch[aria-checked='true'] {
    background: var(--protvista-color-accent, #0053d6);
  }

  protvista-uniprot .${p}-switch[aria-checked='true'] .${p}-switch__thumb {
    transform: translateX(12px);
  }

  protvista-uniprot .${p}-switch:hover:not([disabled]) {
    filter: brightness(0.92);
  }

  @media (prefers-reduced-motion: reduce) {
    protvista-uniprot .${p}-switch,
    protvista-uniprot .${p}-switch__thumb {
      transition: none;
    }
  }

  /* Windows High Contrast / forced-colors: the system replaces author
     background-colors, which would erase both the switch's track-fill state
     and its border-less boundary — leaving no way to tell shown from hidden.
     Restore the boundary with an outline (WCAG 1.4.11) and give the thumb a
     system colour so its position still reads the state. aria-checked already
     carries the state to assistive tech; this is only the visual channel. */
  @media (forced-colors: active) {
    protvista-uniprot .${p}-switch {
      outline: 1px solid CanvasText;
      outline-offset: -1px;
    }
    protvista-uniprot .${p}-switch__thumb {
      background: CanvasText;
    }
    protvista-uniprot .${p}-switch[aria-checked='true'] {
      background: Highlight;
    }
    protvista-uniprot .${p}-switch[aria-checked='true'] .${p}-switch__thumb {
      background: HighlightText;
    }
  }

  protvista-uniprot .${p}-row-control svg {
    width: 12px;
    height: 12px;
  }

  protvista-uniprot .${p}-row-control__icon {
    display: inline-flex;
  }


  /* The move-down button is the move-up chevron, turned over. */
  protvista-uniprot .${p}-row-control--down svg {
    transform: rotate(180deg);
  }

  /* The collapse control is the *same solid caret* as the default view, not
     a chevron. A rotated chevron was indistinguishable from the move-down
     button sitting next to it — identical glyph, identical box — so the two
     differ by form now, and the affordance is learned once across both
     views. It also drops the button chrome: this is a disclosure, not a
     third action, and it should not carry an action's visual weight. */
  /* Kept to roughly the footprint of the ::before caret it stands in for, so
     a group label sits about where it does in the default view rather than
     stepping ~24px sideways when the mode opens. Exact parity is not on
     offer: that caret is itself 5px wide collapsed and 10px expanded. The
     24px pointer target (WCAG 2.5.8) comes from the ::after expander below
     rather than from inflating the artwork. */
  protvista-uniprot .${p}-row-collapse {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 10px;
    height: 10px;
    margin-right: 5px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
  }

  protvista-uniprot .${p}-row-collapse::after {
    content: '';
    position: absolute;
    inset: -7px;
  }

  protvista-uniprot .${p}-row-collapse:focus-visible {
    outline: 2px solid var(--protvista-color-accent, #0053d6);
    outline-offset: 2px;
  }

  protvista-uniprot .${p}-row-collapse::before {
    content: '';
    display: inline-block;
    width: 0;
    height: 0;
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
    border-left: 5px solid var(--protvista-caret-color, #5b6169);
  }

  protvista-uniprot .${p}-row-collapse[aria-expanded='true']::before {
    border-top: 5px solid var(--protvista-caret-color, #5b6169);
    border-bottom: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
  }

  /* The label cell is a plain container while customizing (it holds real
     buttons, so it cannot be one), so drop the button affordances the
     collapse control now carries. */
  protvista-uniprot .${p}--customizing .${p}-group-label {
    cursor: default;
  }

  protvista-uniprot .${p}--customizing .${p}-group-label::before {
    content: none;
  }

  /* ── Hidden rows and stubs ────────────────────────────────── */

  /* A hidden or dataless row still shows in customize mode so it can be
     restored — muted and italic, never colour alone (WCAG 1.4.1); the
     control beside it reads "Show" in words. The muted colour is the
     *label* one, not the global one: on a dark themed label cell the
     global muted grey is as unreadable as the body text it replaces, so a
     themed viewer derives this from the label colour (see applyTheme).
     Group and track are split because a theme can leave them at different
     lightnesses — one muted colour cannot read on both. */
  protvista-uniprot .${p}-row--hidden .${p}-track-label,
  protvista-uniprot .${p}-row--hidden .${p}-group-label {
    font-style: italic;
  }

  protvista-uniprot .${p}-row--hidden .${p}-track-label {
    color: ${ref('--protvista-track-label-color-muted')};
  }

  protvista-uniprot .${p}-row--hidden .${p}-group-label {
    color: ${ref('--protvista-group-label-color-muted')};
  }

  /* A hidden row keeps drawing its features while customizing, desaturated
     and faded, so the user can see what Show would bring back — and so a
     hidden row never looks identical to one that simply has no data.

     Greyscale as well as opacity, deliberately: fading alone would leave
     faint feature colours in the lane, competing with the live rows next to
     it, which is the very thing the neutral chrome was protecting. Removing
     the hue takes the row out of the colour conversation entirely, so it
     reads as inactive rather than as quiet data.

     Pointer events are off because it is a preview, not live data — it must
     not answer clicks or raise tooltips. */
  protvista-uniprot .${p}-row--ghost .${p}-track-content {
    filter: grayscale(1) opacity(0.35);
    pointer-events: none;
  }

  protvista-uniprot .${p}-row--stub .${p}-track-content {
    min-height: 20px;
  }

  /* ── Just-moved highlight ─────────────────────────────────── */

  /* Reordering is button-only, so a row can jump a long way in one press —
     sometimes out of view. Marking where it landed is the difference between
     a move you can follow and one you have to hunt for. */
  protvista-uniprot .${p}-row--moved {
    outline: 2px solid var(--protvista-color-accent, #0053d6);
    outline-offset: -2px;
    border-radius: var(--protvista-radius, 4px);
    animation: ${unsafeCSS(CSS_PREFIX)}-moved-fade 2s ease-out;
  }

  @keyframes ${unsafeCSS(CSS_PREFIX)}-moved-fade {
    from {
      background: var(--protvista-color-bg-active, #e6f3ff);
    }
    to {
      background: transparent;
    }
  }

  /* The outline still marks the row; only the fade is dropped. */
  @media (prefers-reduced-motion: reduce) {
    protvista-uniprot .${p}-row--moved {
      animation: none;
    }
  }

  /* ── All-hidden empty state ───────────────────────────────── */

  protvista-uniprot .${p}-all-hidden {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    color: var(--protvista-color-text-muted, #4a5056);
    font-family: var(--protvista-font-family, inherit);
    font-size: var(--protvista-font-size, 0.8rem);
  }

  protvista-uniprot .${p}-all-hidden p {
    margin: 0;
  }

  /* ── Live region ──────────────────────────────────────────── */

  /* Visually hidden but readable by screen readers: announces the outcome of
     a move or toggle, which is otherwise only visible far off in the canvas
     or (for a hide) removes the row that had focus. */
  protvista-uniprot .${p}-live-region {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  /* The label column keeps its width while customizing. Widening it was the
     obvious move — the controls and the label share the cell — but it
     narrows the track-content column, and the Nightingale canvases do not
     redraw on that resize, so every track blanks out the moment the mode
     opens. The controls are compact and the label ellipsizes instead
     (see .${p}-track-label below); its full text stays in the title
     attribute and in each control's aria-label. */

  /* A group's header row is display:none until its aggregate has data, and
     is revealed imperatively after the fetch (see protvista-styles.ts and
     _loadDataInComponents). That header is where the row's controls live, so
     while customizing every group must show it — otherwise a group whose
     aggregate never loaded would be impossible to move or hide. */
  protvista-uniprot nightingale-manager.${p}--customizing .${p}-group {
    display: flex;
  }
`;
