import { css, unsafeCSS } from 'lit';
import { CSS_PREFIX } from './css-prefix';

/**
 * Light-DOM styles for the "Customize layout" chrome: the toolbar and its
 * toggle button. The Track Manager panel itself is a separate shadow-DOM
 * component (`<protvista-track-manager>`) with its own styles; only the
 * host-rendered toolbar lives here.
 *
 * Conventions match `protvista-styles.ts` / `error-styles.ts`: internal
 * class names carry the collision-proof `CSS_PREFIX` hash and every rule is
 * scoped under the `protvista-uniprot` element tag (light DOM — see
 * `createRenderRoot()` in `protvista-uniprot.ts`). Colours flow through the
 * shared `--protvista-*` theming tokens (see `styles/tokens.ts`) with a
 * literal fallback, so the control restyles with the rest of the viewer.
 */
const p = unsafeCSS(CSS_PREFIX);

export default css`
  protvista-uniprot .${p}-toolbar {
    display: flex;
    justify-content: flex-start;
    margin: 0 0 0.5rem;
  }

  protvista-uniprot .${p}-customize-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 28px;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--protvista-color-border, #c5c8cc);
    border-radius: var(--protvista-radius, 4px);
    background: var(--protvista-color-surface, #ffffff);
    color: var(--protvista-color-text, #222222);
    font-family: var(--protvista-font-family, inherit);
    font-size: var(--protvista-font-size, 0.8rem);
    cursor: pointer;
  }

  protvista-uniprot .${p}-customize-toggle:hover {
    background: var(--protvista-color-bg-hover, #f1f7ff);
  }

  protvista-uniprot .${p}-customize-toggle:focus-visible {
    outline: 2px solid var(--protvista-color-accent, #0053d6);
    outline-offset: 2px;
  }

  /* Pressed (customize mode active): accent border + tinted background so
     state is conveyed by more than colour (also the aria-pressed state). */
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
`;
