import { css, unsafeCSS } from 'lit';
import { CSS_PREFIX } from './css-prefix';

/**
 * Styles for the user-facing error surfaces: the mount-level alert panel
 * and the per-track / per-group `⚠` badges.
 *
 * Conventions match `protvista-styles.ts`: internal class names carry
 * the collision-proof `CSS_PREFIX` hash and every rule is scoped under
 * the `protvista-uniprot` element tag (light DOM — see
 * `createRenderRoot()` in `protvista-uniprot.ts`). Colours reuse the
 * existing palette (panel chrome mirrors the tooltip: `#fff` bg, `1px
 * solid #c5c8cc` border, `4px` radius, `rgba(0,0,0,.15)` shadow); the
 * one addition is a warn/error red, since the palette has no error hue
 * and the codebase uses no CSS-custom-property token system.
 */
const p = unsafeCSS(CSS_PREFIX);

export default css`
  protvista-uniprot .${p}-error-panel {
    box-sizing: border-box;
    margin: 0.5rem 0;
    padding: 0.75rem 1rem;
    background: #fff;
    color: #222;
    border: 1px solid #c5c8cc;
    border-left: 4px solid #b3261e;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    font-size: 0.85rem;
    line-height: 1.4;
    outline: none;
  }

  protvista-uniprot .${p}-error-panel__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  protvista-uniprot .${p}-error-panel__summary {
    margin: 0;
    font-weight: 600;
    color: #b3261e;
  }

  protvista-uniprot .${p}-error-panel__actions {
    display: flex;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  protvista-uniprot .${p}-error-panel__actions button {
    font: inherit;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    color: #4a5056;
    background: #fff;
    border: 1px solid #c5c8cc;
    border-radius: 3px;
    cursor: pointer;
  }

  protvista-uniprot .${p}-error-panel__actions button:hover {
    background: #f2f4f6;
  }

  protvista-uniprot .${p}-error-issues {
    margin: 0.5rem 0 0;
  }

  protvista-uniprot .${p}-error-issues > summary {
    cursor: pointer;
    color: #4a5056;
  }

  protvista-uniprot .${p}-error-issue {
    margin: 0.35rem 0 0;
    padding-left: 0.5rem;
    border-left: 2px solid #e4e8eb;
  }

  protvista-uniprot .${p}-error-issue__path {
    font-family: monospace;
    color: #4a5056;
  }

  protvista-uniprot .${p}-error-issue__code {
    color: #4a5056;
    font-size: 0.75rem;
  }

  protvista-uniprot .${p}-error-badge {
    display: inline-block;
    margin-left: 0.35em;
    color: #b3261e;
    cursor: help;
  }

  protvista-uniprot .${p}-error-badge:focus-visible {
    outline: 2px solid #b3261e;
    outline-offset: 1px;
  }

  protvista-uniprot .${p}-error-retry {
    margin-left: 0.35em;
    font: inherit;
    font-size: 0.7rem;
    line-height: 1.2;
    padding: 0 0.4em;
    color: #4a5056;
    background: #fff;
    border: 1px solid #c5c8cc;
    border-radius: 3px;
    cursor: pointer;
    vertical-align: middle;
  }

  protvista-uniprot .${p}-error-retry:hover {
    background: #f2f4f6;
  }

  protvista-uniprot .${p}-visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
`;
