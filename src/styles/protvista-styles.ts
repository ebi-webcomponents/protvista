import { css } from 'lit';

export default css`
  .track-content {
    width: 80vw;
  }

  .track-content__coloured-sequence {
    display: flex;
    align-items: center;
  }

  .nav-container,
  .group__track {
    display: flex;
    margin-bottom: 0.1rem;
  }

  .group {
    display: none;
    margin-bottom: 0.1rem;
  }

  .group-label,
  .track-label,
  .nav-track-label,
  .credits {
    min-width: 20vw;
    max-width: 20vw;
    padding: 0.5em;
    line-height: normal;
  }

  .group-label {
    background-color: #b2f5ff;
    cursor: pointer;
  }

  .group-label::before {
    content: ' ';
    display: inline-block;
    width: 0;
    height: 0;
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
    border-left: 5px solid #333;
    margin-right: 5px;
    -webkit-transition: all 0.1s;
    /* Safari */
    -o-transition: all 0.1s;
    transition: all 0.1s;
  }

  .group-label.open::before {
    content: ' ';
    display: inline-block;
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 5px solid #333;
    margin-right: 5px;
  }

  .track-label {
    background-color: #d9faff;
  }

  nightingale-track-canvas {
    border-top: 1px solid #d9faff;
  }

  nightingale-navigation {
    .handle {
      fill: darkgrey;
      stroke: black;
      stroke-width: 0.5px;
      height: 19px;
    }
  }

  nightingale-filter {
    font-size: 0.8rem;
  }

  .feature {
    cursor: pointer;
  }

  .proforma {
    padding-left: 4em;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .mod-link {
    white-space: nowrap;
  }

  /* -------------------------------------------------------------------------
   * Click-tooltip popover (installed by src/tooltips/popover.ts).
   *
   * The popover is a plain <div role="tooltip"> attached to the host's
   * light DOM. Floating UI handles positioning via an inline
   * \`transform\`; everything else is themable here.
   *
   * Layout: the resolver emits a flat \`<h5>Label</h5><p>value</p>\`
   * stream per field. We turn that into a dense two-column grid
   * (label | value) using CSS grid + \`grid-auto-flow: row dense\`, so
   * authors don't have to change the tooltip HTML shape to get a
   * compact definition-list look.
   * ------------------------------------------------------------------------- */
  .protvista-tooltip {
    background: #fff;
    color: #222;
    border: 1px solid #c5c8cc;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 0.5em 0.75em;
    font-size: 0.8rem;
    line-height: 1.35;
    max-width: 320px;
  }

  .protvista-tooltip .content {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 0.6em;
    row-gap: 0.15em;
    align-items: baseline;
  }

  .protvista-tooltip .content h5 {
    grid-column: 1;
    margin: 0;
    padding: 0;
    font-size: inherit;
    font-weight: 600;
    color: #4a5056;
    white-space: nowrap;
  }

  .protvista-tooltip .content h5::after {
    content: ':';
  }

  .protvista-tooltip .content p {
    grid-column: 2;
    margin: 0;
    padding: 0;
    word-break: break-word;
  }

  /* Anything the resolver emits that isn't an <h5>/<p> pair (e.g.
     markdown tooltips, custom render output, auto-fallback) falls back
     to spanning the full width of the grid. */
  .protvista-tooltip .content > *:not(h5):not(p) {
    grid-column: 1 / -1;
    margin: 0;
  }

  /* Arrow borders are placement-dependent. The arrow is an 8×8 div
     rotated 45° into a diamond; only the two slanted edges that face
     *away* from the tooltip body should carry a border. Which pair of
     the unrotated square's edges that corresponds to depends on which
     side of the tooltip the arrow sits on — which is the opposite of
     Floating UI's resolved placement. We key off a data-placement
     attribute written by popover.ts on each reposition. The ^=
     selector matches plain sides plus the -start / -end variants
     flip() can produce. */
  .protvista-tooltip .arrow {
    background: #fff;
  }
  .protvista-tooltip[data-placement^='top'] .arrow {
    border-right: 1px solid #c5c8cc;
    border-bottom: 1px solid #c5c8cc;
  }
  .protvista-tooltip[data-placement^='bottom'] .arrow {
    border-left: 1px solid #c5c8cc;
    border-top: 1px solid #c5c8cc;
  }
  .protvista-tooltip[data-placement^='left'] .arrow {
    border-top: 1px solid #c5c8cc;
    border-right: 1px solid #c5c8cc;
  }
  .protvista-tooltip[data-placement^='right'] .arrow {
    border-bottom: 1px solid #c5c8cc;
    border-left: 1px solid #c5c8cc;
  }
`;
