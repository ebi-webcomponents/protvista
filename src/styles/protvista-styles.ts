import { css, unsafeCSS } from 'lit';
import { CSS_PREFIX } from './css-prefix.js';
import { tokenRef } from './tokens.js';

/**
 * Our internal class names carry a collision-proof hash prefix
 * (`CSS_PREFIX`, e.g. `.pv-cecb45-group`) AND every rule is scoped under
 * the `protvista-uniprot` element tag. Two overlapping defences:
 *
 *   1. Hash prefix. We render in light DOM (see `createRenderRoot()`
 *      in protvista-uniprot.ts) because Mol*, so this stylesheet lives
 *      in the document's global selector scope. Child components like
 *      `<nightingale-filter>` also render in light DOM and ship their
 *      own `<style>` blocks into the document at render time (e.g.
 *      nightingale-filter emits `.group { margin-bottom: 2.5rem }` for
 *      its own internal checkbox groupings). The hash prefix means no
 *      third-party class name — scoped or unscoped — can match ours, so
 *      the cascade never has to arbitrate the collision in the first
 *      place. This is the primary defence.
 *
 *   2. Tag scoping (`protvista-uniprot `). Kept as defence-in-depth and
 *      for egress hygiene: our rules stop matching any element that
 *      isn't a descendant of `<protvista-uniprot>`, so we can't bleed
 *      onto a consumer's own elements anywhere else on the page.
 *
 * Colours, sizes, and other themable values are read from the
 * `--protvista-*` design tokens (see `src/styles/tokens.ts`); their
 * defaults are injected on the document root at render time and inherit
 * here, so consumers retheme by overriding a token rather than by
 * targeting these (private, hash-prefixed) class names.
 *
 * The single exception is `.feature` (below): it is deliberately left
 * unprefixed because the component never *applies* that class itself —
 * the rule styles feature glyphs rendered by Nightingale child
 * components. Prefixing it would simply stop it matching anything.
 */
const p = unsafeCSS(CSS_PREFIX);

/**
 * Read a token whose default is another token (`--protvista-tooltip-bg`
 * from `--protvista-color-surface`, say). Such a token is absent from
 * the `:root` default block on purpose, and carries its default chain
 * here at the point of use — see `tokenRef` in tokens.ts for why. Tokens
 * with a literal default are read as a plain `var(…)` below.
 */
const ref = (name: string) => unsafeCSS(tokenRef(name));

export default css`
  protvista-uniprot .${p}-track-content {
    width: var(--protvista-track-content-width);
  }

  protvista-uniprot .${p}-track-content__coloured-sequence {
    display: flex;
    align-items: center;
  }

  /* Rows are ruled, not spaced. The 0.1rem gap this replaces only read as a
     separator because the labels were filled with colour; on a neutral
     surface a hairline is what makes a row legible as a row, and it carries
     the eye across from the label to the features on the same line. */
  protvista-uniprot .${p}-nav-container,
  protvista-uniprot .${p}-group__track {
    display: flex;
    border-bottom: 1px solid var(--protvista-track-border-color);
  }

  protvista-uniprot .${p}-group {
    display: none;
    border-bottom: 1px solid var(--protvista-track-border-color);
  }

  /* The closing ruler row ends the grid, so it takes no rule of its own — a
     trailing hairline under the last row reads as an unfinished table. */
  protvista-uniprot .${p}-nav-container--footer {
    border-bottom: 0;
  }

  protvista-uniprot .${p}-group-label,
  protvista-uniprot .${p}-track-label,
  protvista-uniprot .${p}-nav-track-label,
  protvista-uniprot .${p}-credits {
    /* border-box so padding sits *inside* the fixed column width. Without
       it, indenting one row's label would widen that cell and slide its
       canvas out of line with the ruler and every other row. */
    box-sizing: border-box;
    min-width: var(--protvista-label-width);
    max-width: var(--protvista-label-width);
    padding: 0.5em;
    line-height: normal;
  }

  /* Only the data-row labels carry the label *background* tokens. The
     navigation label cell and the credits cell are neutral chrome, not
     rows — painting them with the track-label colour made a theme tint
     bleed above and below the rows it describes, so they sit on their own
     neutral pair of tokens, which default to the global surface and text.

     The split is backgrounds only. Text comes from a token in all four
     cells: leaving these two to inherit the page's colour while their
     neighbours resolved a token put two text colours in one column.

     The chrome cells carry their own pair of tokens rather than reading
     the global surface and text directly, so a consumer who wants the
     whole column one colour can retint these two without repainting
     every popover, tooltip and panel on the page. They default from the
     global tier, so an untouched viewer is unchanged. */
  protvista-uniprot .${p}-track-label {
    background-color: var(--protvista-track-label-bg);
    color: ${ref('--protvista-track-label-color')};
  }

  protvista-uniprot .${p}-nav-track-label,
  protvista-uniprot .${p}-credits {
    background-color: ${ref('--protvista-chrome-cell-bg')};
    color: ${ref('--protvista-chrome-cell-color')};
  }

  /* The one vertical rule in the viewer: it marks where the label column ends
     and the sequence coordinate space begins, which is the boundary the eye
     needs, and is why no other vertical divider is required.

     It belongs to the data rows only. Carrying it through the navigation
     spacer above and the credits cell below drew a line into space where
     there is no row to divide, which read as a stray stroke rather than as
     structure. */
  protvista-uniprot .${p}-group-label,
  protvista-uniprot .${p}-track-label {
    border-right: 1px solid var(--protvista-track-border-color);
  }

  /* A track inside a group is indented to show it belongs to the header
     above it. The indent is padding *within* the label cell — never a
     margin on the row — so the track area stays aligned across every row.
     The same rule covers customize mode, where the control cluster sits in
     that padding and shifts with it. */
  protvista-uniprot .${p}-track--nested .${p}-track-label {
    padding-left: 1.25em;
  }

  /* A group header reads as a header through weight and a slightly recessed
     surface, not through a saturated fill — chrome stays neutral so colour
     can mean data. */
  protvista-uniprot .${p}-group-label {
    background-color: var(--protvista-group-label-bg);
    color: ${ref('--protvista-group-label-color')};
    font-weight: 600;
    cursor: pointer;
  }

  /* Hover is its own token rather than the global hover blue, because a
     config theme may have made this cell dark: swapping in a near-white
     background under text that was flipped to white for that dark fill
     would erase the label on hover. A themed viewer derives this from the
     label colour (see applyTheme); unthemed, it is the global hover. */
  protvista-uniprot .${p}-group-label:hover {
    background-color: ${ref('--protvista-group-label-hover-bg')};
  }

  protvista-uniprot .${p}-group-label::before {
    content: ' ';
    display: inline-block;
    width: 0;
    height: 0;
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
    border-left: 5px solid var(--protvista-caret-color);
    margin-right: 5px;
    -webkit-transition: all 0.1s;
    /* Safari */
    -o-transition: all 0.1s;
    transition: all 0.1s;
  }

  protvista-uniprot .${p}-group-label.open::before {
    content: ' ';
    display: inline-block;
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 5px solid var(--protvista-caret-color);
    margin-right: 5px;
  }

  /* A split group's non-collapsible bracket header: no caret, not clickable. */
  protvista-uniprot .${p}-group-label--partial {
    cursor: default;
  }

  protvista-uniprot .${p}-group-label--partial::before {
    display: none;
  }

  protvista-uniprot nightingale-navigation .handle {
    fill: var(--protvista-nav-handle-fill);
    stroke: var(--protvista-nav-handle-stroke);
    stroke-width: 0.5px;
    height: 19px;
  }

  protvista-uniprot nightingale-filter {
    font-size: var(--protvista-font-size);
  }

  /* Intentionally unprefixed: styles feature glyphs rendered by
     Nightingale child components, which the host does not apply the
     class to itself. See the header comment. */
  protvista-uniprot .feature {
    cursor: pointer;
  }

  /* -------------------------------------------------------------------------
   * Click-tooltip popover (installed by src/tooltips/popover.ts).
   *
   * The popover is a plain <div role="tooltip"> attached to the host's
   * light DOM. Floating UI handles positioning via an inline
   * \`transform\`; everything else is themable via \`--protvista-tooltip-*\`.
   *
   * Layout: the resolver emits a flat \`<h5>Label</h5><p>value</p>\`
   * stream per field. We turn that into a dense two-column grid
   * (label | value) using CSS grid + \`grid-auto-flow: row dense\`, so
   * authors don't have to change the tooltip HTML shape to get a
   * compact definition-list look.
   * ------------------------------------------------------------------------- */
  protvista-uniprot .protvista-tooltip {
    background: ${ref('--protvista-tooltip-bg')};
    color: ${ref('--protvista-tooltip-color')};
    border: 1px solid ${ref('--protvista-tooltip-border')};
    border-radius: var(--protvista-radius);
    box-shadow: var(--protvista-shadow-popover);
    padding: 0.5em 0.75em;
    font-size: var(--protvista-font-size);
    line-height: 1.35;
    max-width: var(--protvista-tooltip-max-width);
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
    color: var(--protvista-color-text-muted);
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
    background: ${ref('--protvista-tooltip-bg')};
  }
  protvista-uniprot .protvista-tooltip[data-placement^='top'] .arrow {
    border-right: 1px solid ${ref('--protvista-tooltip-border')};
    border-bottom: 1px solid ${ref('--protvista-tooltip-border')};
  }
  protvista-uniprot .protvista-tooltip[data-placement^='bottom'] .arrow {
    border-left: 1px solid ${ref('--protvista-tooltip-border')};
    border-top: 1px solid ${ref('--protvista-tooltip-border')};
  }
  protvista-uniprot .protvista-tooltip[data-placement^='left'] .arrow {
    border-top: 1px solid ${ref('--protvista-tooltip-border')};
    border-right: 1px solid ${ref('--protvista-tooltip-border')};
  }
  protvista-uniprot .protvista-tooltip[data-placement^='right'] .arrow {
    border-bottom: 1px solid ${ref('--protvista-tooltip-border')};
    border-left: 1px solid ${ref('--protvista-tooltip-border')};
  }
`;
