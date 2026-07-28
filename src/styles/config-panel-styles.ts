import { css, unsafeCSS } from 'lit';
import { CSS_PREFIX } from './css-prefix';

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

export default css`
  /* The label column doubles as the customize toolbar: the toggle sits in the
     empty cell beside the navigation, in the same column as the per-row
     controls it reveals. */
  protvista-uniprot .${p}-nav-track-label {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
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
    border: 1px solid var(--protvista-color-border, #c5c8cc);
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
    font-family: var(--protvista-font-family, inherit);
    font-size: var(--protvista-font-size, 0.8rem);
    color: var(--protvista-color-text-muted, #5b6169);
  }

  /* ── Per-row controls ─────────────────────────────────────── */

  protvista-uniprot .${p}-row-controls {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    margin-right: 0.35rem;
    vertical-align: middle;
    /* Never let the controls be squeezed — the label gives way instead. */
    flex: 0 0 auto;
  }

  /* Controls and label share a fixed-width cell while customizing, so the
     label takes whatever is left and ellipsizes. Its full text is still on
     the cell's title attribute and in every control's aria-label. */
  protvista-uniprot .${p}--customizing .${p}-track-label,
  protvista-uniprot .${p}--customizing .${p}-group-label {
    display: flex;
    align-items: center;
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
    border: 1px solid var(--protvista-color-border, #c5c8cc);
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

  protvista-uniprot .${p}-row-grip {
    cursor: grab;
  }

  /* Collapsed points right, expanded points down — the same reading as the
     caret this replaces while customizing. */
  protvista-uniprot .${p}-row-collapse svg {
    transform: rotate(90deg);
  }

  protvista-uniprot .${p}-row-collapse[aria-expanded='true'] svg {
    transform: rotate(180deg);
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
     control beside it reads "Show" in words. */
  protvista-uniprot .${p}-row--hidden .${p}-track-label,
  protvista-uniprot .${p}-row--hidden .${p}-group-label {
    font-style: italic;
    color: var(--protvista-color-text-muted, #5b6169);
  }

  protvista-uniprot .${p}-row--stub .${p}-track-content {
    min-height: 20px;
  }

  /* ── Drag placeholder ─────────────────────────────────────── */

  /* Space opens up where the row will land, rather than a thin marker line:
     a gap the size of the moving row makes the outcome legible before the
     drop, which a 2px rule never did. */
  protvista-uniprot .${p}-drop-gap {
    height: 22px;
    margin-bottom: 0.1rem;
    border: 1px dashed var(--protvista-color-accent, #0053d6);
    border-radius: var(--protvista-radius, 4px);
    background: var(--protvista-color-bg-active, #e6f3ff);
    transition: height 120ms ease;
  }

  @media (prefers-reduced-motion: reduce) {
    protvista-uniprot .${p}-drop-gap {
      transition: none;
    }
  }

  /* ── All-hidden empty state ───────────────────────────────── */

  protvista-uniprot .${p}-all-hidden {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    color: var(--protvista-color-text-muted, #5b6169);
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
