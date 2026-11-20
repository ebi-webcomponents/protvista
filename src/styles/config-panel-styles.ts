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

     Stacked in rows: the toggle shares its line with every customize
     action (Toggle all, Reset to default), and the change status —
     what is different from the default — sits alone on the line below. */
  /* Stretched, not left-aligned: each toolbar row needs to span the full
     label column, or it shrink-wraps to its own content and the actions'
     margin-left: auto (.customize-actions) has no column width left to
     push into. */
  protvista-uniprot .${p}-nav-track-label {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: 0.3rem;
  }

  protvista-uniprot .${p}-toolbar-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
  }

  /* The status row is always laid out, and merely made invisible when there
     is nothing to report, so a first change adds no height and the
     navigation ruler does not step down. */
  /* The Customize line keeps Toggle all and Reset to default beside the
     toggle at usual label-column widths. The column is a size container so
     the line can tighten itself to fit (see the @container rules below);
     only when even that is not enough do the actions wrap below the toggle,
     rather than run past the column under the ruler. */
  protvista-uniprot .${p}-nav-track-label {
    container-type: inline-size;
    container-name: ${p}-toolbar;
  }

  /* Customize and its actions are one unit, laid out identically in both
     modes: the actions are always there, merely invisible outside customize
     mode (.customize-actions--inactive), and the toggle keeps the width of
     "Customize" while it reads "Done" (below). So whether the line wraps
     never depends on the mode, and opening Customize cannot change the nav
     cell's height or move the tracks.

     The unit grows into the space the top-bar notes (ⓘ) leave — so the
     actions sit at its right edge — and the notes stay on the same line
     rather than drop to a line of their own. The unit shrinks instead, and
     wraps the actions inside itself. */
  protvista-uniprot .${p}-customize-line {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }

  protvista-uniprot .${p}-toolbar-row--customize {
    flex-wrap: nowrap;
  }

  protvista-uniprot .${p}-customize-line {
    flex: 1 1 auto;
  }

  protvista-uniprot .${p}-toolbar-row--customize > :not(.${p}-customize-line) {
    flex: none;
  }

  /* Toggle all reads "on" or "off" by what the press will do, and the two
     labels differ in width. Invisible copies of both sit with the label at
     zero height, so the button — and with it whether the line
     wraps — never changes as tracks are hidden or shown, or between modes. */
  protvista-uniprot .${p}-customize-action__label {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
  }

  protvista-uniprot .${p}-customize-action--toggle-all .${p}-customize-action__label::before,
  protvista-uniprot .${p}-customize-action--toggle-all .${p}-customize-action__label::after {
    content: 'Toggle all on';
    display: block;
    height: 0;
    overflow: hidden;
    visibility: hidden;
  }

  protvista-uniprot .${p}-customize-action--toggle-all .${p}-customize-action__label::after {
    content: 'Toggle all off';
  }

  /* Outside customize mode: holds its space, shows and announces nothing
     (also aria-hidden and inert in the markup). */
  protvista-uniprot .${p}-customize-actions--inactive {
    visibility: hidden;
  }

  /* "Done" is narrower than the icon plus "Customize", which would let the
     line fit while customizing yet wrap outside it. An invisible copy of
     the wider label sits under the text at zero height, so the button keeps
     its outside-mode width without growing taller. Generated content,
     hidden: it is not in textContent and not in the accessible name. */
  /* The same box in both modes, so only the reserved width differs. At
     least the icon's 16px tall, so "Done" (which drops the icon) is not a
     fraction shorter than "Customize". */
  protvista-uniprot .${p}-customize-toggle__text {
    min-height: 16px;
    justify-content: center;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
  }

  protvista-uniprot .${p}--customizing .${p}-customize-toggle__text::after {
    content: 'Customize';
    display: block;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    /* The icon (16px) and the button's gap, which "Done" drops. */
    padding-left: calc(16px + 0.4rem);
  }

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

  /* A run of actions beside the toggle; they wrap as a group on a narrow
     label column rather than overflowing it. */
  protvista-uniprot .${p}-customize-action {
    white-space: nowrap;
  }

  protvista-uniprot .${p}-customize-action[disabled] {
    opacity: 0.5;
    cursor: default;
  }

  /* The customize actions, pushed together to the far right of the
     Customize line. A column too narrow first tightens them (below); past
     that they wrap — as a unit below the toggle, then one per line — rather
     than overflow the column. */
  protvista-uniprot .${p}-customize-actions {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 0.3rem;
    margin-left: auto;
    min-width: 0;
  }

  /* Tightening, in steps, as the label column narrows, so all three buttons
     stay on the Customize line as long as they can. First the padding and gaps give way, then
     the type steps down. (While customizing the toggle reads "Done" and
     drops its icon, which already keeps the line short.) */
  @container ${p}-toolbar (max-width: 380px) {
    protvista-uniprot .${p}-customize-line,
    protvista-uniprot .${p}-customize-actions {
      gap: 0.2rem;
    }
    protvista-uniprot .${p}-customize-line .${p}-customize-toggle,
    protvista-uniprot .${p}-customize-line .${p}-customize-action {
      padding: 0.2rem 0.3rem;
    }
  }

  @container ${p}-toolbar (max-width: 260px) {
    protvista-uniprot .${p}-customize-line,
    protvista-uniprot .${p}-customize-actions {
      gap: 0.15rem;
    }
    protvista-uniprot .${p}-customize-line .${p}-customize-toggle,
    protvista-uniprot .${p}-customize-line .${p}-customize-action {
      font-size: 0.65rem;
      padding: 0.15rem 0.2rem;
    }
  }

  protvista-uniprot .${p}-customize-toggle:focus-visible,
  protvista-uniprot .${p}-customize-action:focus-visible,
  protvista-uniprot .${p}-switch:focus-visible,
  protvista-uniprot .${p}-row-control:focus-visible {
    outline: 2px solid var(--protvista-color-accent, #0053d6);
    outline-offset: 2px;
  }

  /* Customize mode active (the toggle reads "Done"): accent border + tinted
     background. The label change carries the state, not colour alone. */
  protvista-uniprot .${p}--customizing .${p}-customize-toggle {
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

  /* The change status: plain text while customizing, a "Modified view"
     button outside it. Neither has a background of its own, so they sit on
     the nav cell's. Once a consumer retints that cell they set its text
     token too, and the status follows it; until then it keeps the muted
     grey. */
  protvista-uniprot .${p}-change-status {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 24px;
    padding: 0 0.1rem;
    font-family: var(--protvista-font-family, inherit);
    font-size: var(--protvista-font-size, 0.8rem);
    color: var(
      --protvista-chrome-cell-color,
      var(--protvista-color-text-muted, #4a5056)
    );
  }

  /* The status text, while customizing: one line, however many parts it
     has. The row is reserved for one line, so wrapping would grow the nav
     cell and move the tracks down as changes pile up; it is cut with an
     ellipsis instead (the full text is in its title). */
  protvista-uniprot .${p}-change-status--text {
    display: block;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    line-height: 24px;
  }

  protvista-uniprot .${p}-change-status--text .${p}-moved-mark {
    vertical-align: middle;
  }

  protvista-uniprot .${p}-change-status--button {
    padding: 0.2rem 0.4rem;
    border: 0;
    border-radius: var(--protvista-radius, 4px);
    background: none;
    text-decoration: underline dotted;
    cursor: pointer;
  }

  protvista-uniprot .${p}-change-status--button:hover {
    background: var(--protvista-color-bg-hover, #f1f7ff);
  }

  protvista-uniprot .${p}-change-status--button:focus-visible {
    outline: 2px solid var(--protvista-color-accent, #0053d6);
    outline-offset: 2px;
  }

  /* The moved asterisk — in the status line as its key, and beside each
     moved row's controls. A flex box of its own so the glyph is centred on
     the switch beside it rather than riding high on the text baseline. */
  protvista-uniprot .${p}-moved-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    height: 14px;
    line-height: 1;
    font-weight: bold;
    color: var(--protvista-color-accent, #0053d6);
  }

  protvista-uniprot .${p}-row-controls .${p}-moved-mark {
    /* Sits immediately left of the switch / not-applicable sign, with a
       small gap before it. */
    margin-right: 0.25rem;
    font-size: 1rem;
    /* An asterisk's ink sits in the top half of its em box; nudge it down
       so its centre, not its box, lines up with the switch's. */
    padding-top: 0.3em;
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

  /* No data: a not-applicable sign (⊘) in place of the switch, the same footprint so
     the move buttons beside it stay in column. Muted — it is information,
     not a control. */
  protvista-uniprot .${p}-no-data {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 26px;
    height: 14px;
    margin: 0 0.4rem 0 0;
    color: var(--protvista-color-text-muted, #4a5056);
    cursor: help;
  }

  protvista-uniprot .${p}-no-data svg {
    width: 14px;
    height: 14px;
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
