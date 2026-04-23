import { css } from 'lit';

/**
 * Every selector in this file is scoped under the `protvista-uniprot`
 * element tag. Two reasons:
 *
 *   1. Ingress defence. We render in light DOM (see `createRenderRoot()`
 *      in protvista-uniprot.ts) because Mol*. Child components like
 *      `<nightingale-filter>` also render in light DOM and ship their
 *      own unscoped `<style>` blocks into the document at render time
 *      (e.g. nightingale-filter emits `.group { margin-bottom: 2.5rem }`
 *      for its own internal checkbox groupings). Without our tag
 *      scoping, their `.group` rule ties our `.group` on specificity
 *      and wins by source order. Prefixing `protvista-uniprot ` bumps
 *      our specificity from 0,1,0 to 0,1,1 — ours beats any unscoped
 *      third-party `.group` / `.feature` / `.track-label` rule.
 *
 *   2. Egress hygiene. Our rules stop matching any element in the
 *      document that isn't a descendant of `<protvista-uniprot>`.
 *      Consumers embedding us alongside their own components whose
 *      CSS happens to use the same class names (`.group`, `.feature`,
 *      `.track-label`, …) are protected from our styles.
 *
 * If a third-party child component ever ships a *tag-scoped* rule
 * (e.g. `nightingale-filter .group { … }` at 0,1,1), we'll tie on
 * specificity and source order wins again. In that case we'd need to
 * rename our classes with a `pv-` prefix; tracked as a follow-on
 * issue in `next-branch-issues.yml`.
 */
export default css`
  protvista-uniprot .track-content {
    width: 80vw;
  }

  protvista-uniprot .track-content__coloured-sequence {
    display: flex;
    align-items: center;
  }

  protvista-uniprot .nav-container,
  protvista-uniprot .group__track {
    display: flex;
    margin-bottom: 0.1rem;
  }

  protvista-uniprot .group {
    display: none;
    margin-bottom: 0.1rem;
  }

  protvista-uniprot .group-label,
  protvista-uniprot .track-label,
  protvista-uniprot .nav-track-label,
  protvista-uniprot .credits {
    min-width: 20vw;
    max-width: 20vw;
    padding: 0.5em;
    line-height: normal;
  }

  protvista-uniprot .group-label {
    background-color: #b2f5ff;
    cursor: pointer;
  }

  protvista-uniprot .group-label::before {
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

  protvista-uniprot .group-label.open::before {
    content: ' ';
    display: inline-block;
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 5px solid #333;
    margin-right: 5px;
  }

  protvista-uniprot .track-label {
    background-color: #d9faff;
  }

  protvista-uniprot nightingale-track-canvas {
    border-top: 1px solid #d9faff;
  }

  protvista-uniprot nightingale-navigation .handle {
    fill: darkgrey;
    stroke: black;
    stroke-width: 0.5px;
    height: 19px;
  }

  protvista-uniprot nightingale-filter {
    font-size: 0.8rem;
  }

  protvista-uniprot .feature {
    cursor: pointer;
  }

  protvista-uniprot .proforma {
    padding-left: 4em;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  protvista-uniprot .mod-link {
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
  protvista-uniprot .protvista-tooltip {
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

  protvista-uniprot .protvista-tooltip .content {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 0.6em;
    row-gap: 0.15em;
    align-items: baseline;
  }

  protvista-uniprot .protvista-tooltip .content h5 {
    grid-column: 1;
    margin: 0;
    padding: 0;
    font-size: inherit;
    font-weight: 600;
    color: #4a5056;
    white-space: nowrap;
  }

  protvista-uniprot .protvista-tooltip .content h5::after {
    content: ':';
  }

  protvista-uniprot .protvista-tooltip .content p {
    grid-column: 2;
    margin: 0;
    padding: 0;
    word-break: break-word;
  }

  /* Anything the resolver emits that isn't an <h5>/<p> pair (e.g.
     markdown tooltips, custom render output, auto-fallback) falls back
     to spanning the full width of the grid. */
  protvista-uniprot .protvista-tooltip .content > *:not(h5):not(p) {
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
  protvista-uniprot .protvista-tooltip .arrow {
    background: #fff;
  }
  protvista-uniprot .protvista-tooltip[data-placement^='top'] .arrow {
    border-right: 1px solid #c5c8cc;
    border-bottom: 1px solid #c5c8cc;
  }
  protvista-uniprot .protvista-tooltip[data-placement^='bottom'] .arrow {
    border-left: 1px solid #c5c8cc;
    border-top: 1px solid #c5c8cc;
  }
  protvista-uniprot .protvista-tooltip[data-placement^='left'] .arrow {
    border-top: 1px solid #c5c8cc;
    border-right: 1px solid #c5c8cc;
  }
  protvista-uniprot .protvista-tooltip[data-placement^='right'] .arrow {
    border-bottom: 1px solid #c5c8cc;
    border-left: 1px solid #c5c8cc;
  }
`;
