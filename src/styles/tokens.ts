/**
 * Design-token registry — the single source of truth for every themable
 * CSS custom property the viewer exposes to library consumers.
 *
 * Why a structured registry rather than a hand-written CSS string: one
 * typed list is the reference for every place these tokens appear —
 *
 *   1. the light-DOM CSS default block, which is *generated* from this
 *      registry at render time (`tokenDefaults`);
 *   2. the datatable's shadow `:host` defaults and the reference table
 *      in `docs/theming.md`, which are hand-written (the datatable
 *      carries back-compat aliases; the docs add prose) but are held in
 *      lock-step with this registry by drift-guard tests in
 *      `src/styles/__spec__/theming.spec.ts`; and
 *   3. (future) a no-code styling panel, which can enumerate `TOKENS`,
 *      render one typed control per entry, and write overrides with
 *      `element.style.setProperty(name, value)`.
 *
 * Custom properties are runtime-settable and inherit down the tree —
 * including *into* the datatable's shadow root — so a consumer (or that
 * future panel) themes the whole viewer by setting these on `:root`, on
 * the `<protvista-uniprot>` host, or on any ancestor (see
 * `installTokenDefaults` for why the defaults live on `:root`). Defaults
 * equal the historical hardcoded literals, so a viewer with no consumer
 * CSS renders identically.
 *
 * Scope: this covers *chrome/UI* styling only. Data-domain colours
 * (AlphaFold pLDDT / AlphaMissense ramps, variant and PTM-tier colours)
 * are deliberately excluded — they are semantic data encodings themed
 * through the config's `registerTheme()` path, not the interface.
 */

export type TokenType = 'color' | 'length' | 'font' | 'shadow';

export interface TokenDef {
  /** The custom-property name, e.g. `--protvista-color-accent`. */
  name: string;
  /** Grouping for docs / a future panel: the tier or component it themes. */
  group: 'global' | 'viewer' | 'tooltip' | 'datatable';
  /** Coarse value kind, so a no-code UI can pick the right control. */
  type: TokenType;
  /**
   * The default value emitted into the CSS default block. May itself be
   * a `var(--other-token)` reference so a component token inherits from
   * the global tier while still being independently overridable.
   */
  default: string;
  /** One-line description for the docs table / control label. */
  description: string;
}

/**
 * Global tier — the small set of tokens a consumer reaches for first.
 * Component tokens below default *from* these, so overriding one global
 * (e.g. `--protvista-color-accent`) cascades everywhere it is used.
 */
const GLOBAL_TOKENS: TokenDef[] = [
  {
    name: '--protvista-font-family',
    group: 'global',
    type: 'font',
    default: 'inherit',
    description: 'Base font family for viewer chrome (labels, tooltips, table).',
  },
  {
    name: '--protvista-font-size',
    group: 'global',
    type: 'length',
    default: '0.8rem',
    description: 'Base font size for viewer chrome.',
  },
  {
    name: '--protvista-color-accent',
    group: 'global',
    type: 'color',
    default: '#0053d6',
    description: 'Accent colour — focus rings, active-row marker, primary UI.',
  },
  {
    name: '--protvista-color-text',
    group: 'global',
    type: 'color',
    default: '#222222',
    description: 'Default body text colour.',
  },
  {
    name: '--protvista-color-text-muted',
    group: 'global',
    type: 'color',
    default: '#4a5056',
    description: 'Muted/secondary text colour (tooltip labels, captions).',
  },
  {
    name: '--protvista-color-surface',
    group: 'global',
    type: 'color',
    default: '#ffffff',
    description: 'Surface/background colour for popovers and panels.',
  },
  {
    name: '--protvista-color-border',
    group: 'global',
    type: 'color',
    default: '#c5c8cc',
    description: 'Default border colour for popovers and panels.',
  },
  {
    name: '--protvista-color-disabled',
    group: 'global',
    type: 'color',
    default: '#808080',
    description: 'Colour for disabled controls.',
  },
  {
    name: '--protvista-color-bg-hover',
    group: 'global',
    type: 'color',
    default: '#f1f7ff',
    description: 'Background of hovered interactive chrome (buttons, list rows).',
  },
  {
    name: '--protvista-color-bg-active',
    group: 'global',
    type: 'color',
    default: '#e6f3ff',
    description: 'Background of an active/pressed control (toggle buttons).',
  },
  {
    name: '--protvista-radius',
    group: 'global',
    type: 'length',
    default: '4px',
    description: 'Corner radius for popovers and controls.',
  },
  {
    name: '--protvista-shadow-popover',
    group: 'global',
    type: 'shadow',
    default: '0 4px 12px rgb(0 0 0 / 0.15)',
    description: 'Drop shadow for floating popovers (tooltips).',
  },
];

/** Light-DOM viewer chrome — track/group labels, navigation, empty states. */
const VIEWER_TOKENS: TokenDef[] = [
  {
    name: '--protvista-track-content-width',
    group: 'viewer',
    type: 'length',
    default: '80vw',
    description: 'Width of the track-content column (the visualisation area).',
  },
  {
    name: '--protvista-label-width',
    group: 'viewer',
    type: 'length',
    default: '20vw',
    description: 'Width of the label column (group/track/nav labels, credits).',
  },
  {
    name: '--protvista-group-label-bg',
    group: 'viewer',
    type: 'color',
    default: '#f1f3f5',
    description: 'Background of collapsible group labels.',
  },
  {
    name: '--protvista-track-label-bg',
    group: 'viewer',
    type: 'color',
    default: '#ffffff',
    description: 'Background of individual track labels.',
  },
  {
    name: '--protvista-track-border-color',
    group: 'viewer',
    type: 'color',
    default: '#e3e6ea',
    description:
      'Hairline ruling the viewer grid: between stacked rows, and between the label column and the track area.',
  },
  {
    name: '--protvista-caret-color',
    group: 'viewer',
    type: 'color',
    default: '#5b6169',
    description: 'Colour of the group-label expand/collapse caret.',
  },
  {
    name: '--protvista-nav-handle-fill',
    group: 'viewer',
    type: 'color',
    default: 'darkgrey',
    description: 'Fill of the navigation zoom handles.',
  },
  {
    name: '--protvista-nav-handle-stroke',
    group: 'viewer',
    type: 'color',
    default: 'black',
    description: 'Stroke of the navigation zoom handles.',
  },
  {
    name: '--protvista-no-results-bg',
    group: 'viewer',
    type: 'color',
    default: '#e4e8eb',
    description: 'Background of the "no results" empty state.',
  },
];

/** Click-tooltip popover — defaults inherit from the global tier. */
const TOOLTIP_TOKENS: TokenDef[] = [
  {
    name: '--protvista-tooltip-bg',
    group: 'tooltip',
    type: 'color',
    default: 'var(--protvista-color-surface)',
    description: 'Tooltip background.',
  },
  {
    name: '--protvista-tooltip-color',
    group: 'tooltip',
    type: 'color',
    default: 'var(--protvista-color-text)',
    description: 'Tooltip text colour.',
  },
  {
    name: '--protvista-tooltip-border',
    group: 'tooltip',
    type: 'color',
    default: 'var(--protvista-color-border)',
    description: 'Tooltip border and arrow colour.',
  },
  {
    name: '--protvista-tooltip-max-width',
    group: 'tooltip',
    type: 'length',
    default: '320px',
    description: 'Maximum tooltip width before text wraps.',
  },
];

/**
 * Datatable (shadow DOM). These are documented here for reference and a
 * future panel, but the datatable declares its own `:host` defaults
 * (with back-compat aliases for the former `--protvista-dt-*` names);
 * the `default` values below are the effective defaults it resolves to.
 * See `src/protvista-uniprot-datatable.ts`.
 */
const DATATABLE_TOKENS: TokenDef[] = [
  {
    name: '--protvista-datatable-accent',
    group: 'datatable',
    type: 'color',
    default: 'var(--protvista-color-accent)',
    description: 'Datatable accent — focus outline, active-row marker.',
  },
  {
    name: '--protvista-datatable-text-head',
    group: 'datatable',
    type: 'color',
    default: '#1a1a1a',
    description: 'Header-cell text colour.',
  },
  {
    name: '--protvista-datatable-text-body',
    group: 'datatable',
    type: 'color',
    default: '#2c2c2c',
    description: 'Body-cell text colour.',
  },
  {
    name: '--protvista-datatable-text-muted',
    group: 'datatable',
    type: 'color',
    default: '#444444',
    description: 'Muted text (e.g. the no-results message).',
  },
  {
    name: '--protvista-datatable-text-input',
    group: 'datatable',
    type: 'color',
    default: '#333333',
    description: 'Filter <select> text colour.',
  },
  {
    name: '--protvista-datatable-bg-base',
    group: 'datatable',
    type: 'color',
    default: 'var(--protvista-color-surface)',
    description: 'Datatable base background.',
  },
  {
    name: '--protvista-datatable-bg-header',
    group: 'datatable',
    type: 'color',
    default: '#f8f8f8',
    description: 'Sticky header-row background.',
  },
  {
    name: '--protvista-datatable-bg-hover',
    group: 'datatable',
    type: 'color',
    default: '#f1f7ff',
    description: 'Row hover/focus background.',
  },
  {
    name: '--protvista-datatable-bg-active',
    group: 'datatable',
    type: 'color',
    default: '#e6f3ff',
    description: 'Selected/active-row background.',
  },
  {
    name: '--protvista-datatable-border',
    group: 'datatable',
    type: 'color',
    default: '#e0e0e0',
    description: 'Cell and container borders.',
  },
  {
    name: '--protvista-datatable-border-input',
    group: 'datatable',
    type: 'color',
    default: '#767676',
    description: 'Filter <select> border.',
  },
  {
    name: '--protvista-datatable-shadow-header',
    group: 'datatable',
    type: 'color',
    default: '#cccccc',
    description: 'Under-shadow of the sticky header row.',
  },
  {
    name: '--protvista-datatable-max-height',
    group: 'datatable',
    type: 'length',
    default: '400px',
    description: 'Max height of the scroll container before it scrolls.',
  },
];

/** The full, ordered token vocabulary. */
export const TOKENS: readonly TokenDef[] = [
  ...GLOBAL_TOKENS,
  ...VIEWER_TOKENS,
  ...TOOLTIP_TOKENS,
  ...DATATABLE_TOKENS,
];

/**
 * The token defaults that live in the light DOM, i.e. everything except
 * the datatable (which ships its own shadow `:host` defaults). Returns
 * the declaration lines only — the caller wraps them in a selector.
 */
export function tokenDefaults(): string {
  return TOKENS.filter((t) => t.group !== 'datatable')
    .map((t) => `  ${t.name}: ${t.default};`)
    .join('\n');
}

/**
 * A complete CSS rule declaring the light-DOM token defaults on the
 * given selector (the `protvista-uniprot` host tag), so the values
 * inherit to all descendants — including into child components' shadow
 * roots via custom-property inheritance.
 */
export function tokenDefaultsBlock(selector: string): string {
  return `${selector} {\n${tokenDefaults()}\n}`;
}
