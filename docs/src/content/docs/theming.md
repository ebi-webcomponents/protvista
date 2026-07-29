---
title: Theming ProtVista
---

`<protvista-uniprot>` exposes a documented styling API built on two
native web standards, so you can match the viewer to your application
with **plain CSS and no JavaScript**:

- **CSS custom properties** (`--protvista-*` design tokens) for colours,
  sizes and other themable values. This is the primary surface.
- **`::part`** for targeting structural elements of the shadow-DOM
  datatable (rows, cells, header, filter controls).

Overriding these is the supported way to customise the interface.
Internal class names (the hash-prefixed `.pv-*` classes) are **not** a
public API and may change between releases — theme through the tokens
and parts below instead.

## Why two mechanisms?

The main viewer and the structure panel render in the **light DOM**
(required by the embedded Mol\* structure viewer), so their themable
values are exposed as custom properties, which you set on the element or
any ancestor. The datatable renders in a **shadow root**, so in addition
to custom properties (which pierce the boundary through inheritance) it
also exposes `::part` hooks for structural styling that a custom
property alone can't express.

## Quick start

```css
/* Theme every ProtVista instance on the page. */
:root {
  --protvista-color-accent: #7b2d8e;
  --protvista-group-label-bg: #efe6f5;
  --protvista-radius: 8px;
}

/* Theme one instance. */
protvista-uniprot#my-viewer {
  --protvista-track-label-bg: #f2f2f2;
}

/* Reach into the datatable's shadow DOM with ::part. */
protvista-uniprot-datatable::part(row-active) {
  outline: 2px solid #7b2d8e;
}
```

Because tokens are ordinary custom properties, they are also settable at
runtime — `element.style.setProperty('--protvista-color-accent', …)` —
which is how an interactive controls panel can drive live theming.

## No-code theming from the config

For authors who don't write CSS, a subset of the chrome colours can be set
directly in the viewer config via the optional top-level `theme:` block:

```yaml
theme:
  labelColor: '#e8f5e9' # row-label side panel (group + track labels)
  accentColor: '#0053d6' # focus rings + datatable active-row marker
```

The component applies each as the matching `--protvista-*` custom property
**inline on the host element** at mount. Because an inline declaration
beats both the `:where(:root)` default and ordinary page CSS (an inherited
`:root` value or an element-selector rule), a config `theme` **takes
precedence over page CSS**: a host that needs to override a config-supplied
theme must use `!important` (e.g. `protvista-uniprot { --protvista-color-accent: #7b2d8e !important }`)
or set the token inline on the element itself. `theme.labelColor` maps to
`--protvista-group-label-bg` / `--protvista-track-label-bg`;
`theme.accentColor` maps to `--protvista-color-accent`. For anything beyond
these — or when the *page* should win over the config — use the CSS tokens
directly and don't set `theme` in the config.

## Design tokens

Every token has a sensible default (shown below), so a viewer with no
custom CSS renders exactly as it always has. Component tokens whose
default is written as `var(--protvista-…)` inherit from the global tier,
so overriding one global token (e.g. `--protvista-color-accent`)
cascades everywhere it is used.

### Global

| Token | Type | Default | Purpose |
| --- | --- | --- | --- |
| `--protvista-font-family` | font | `inherit` | Base font family for viewer chrome. |
| `--protvista-font-size` | length | `0.8rem` | Base font size for viewer chrome. |
| `--protvista-color-accent` | color | `#0053d6` | Accent — focus rings, active-row marker, primary UI. |
| `--protvista-color-text` | color | `#222222` | Default body text colour. |
| `--protvista-color-text-muted` | color | `#4a5056` | Muted/secondary text (tooltip labels, captions). |
| `--protvista-color-surface` | color | `#ffffff` | Surface/background for popovers and panels. |
| `--protvista-color-border` | color | `#c5c8cc` | Default border for popovers and panels. |
| `--protvista-color-disabled` | color | `#808080` | Disabled controls. |
| `--protvista-color-bg-hover` | color | `#f1f7ff` | Background of hovered interactive chrome (buttons, list rows). |
| `--protvista-color-bg-active` | color | `#e6f3ff` | Background of an active/pressed control (toggle buttons). |
| `--protvista-radius` | length | `4px` | Corner radius for popovers and controls. |
| `--protvista-shadow-popover` | shadow | `0 4px 12px rgb(0 0 0 / 0.15)` | Drop shadow for floating popovers. |

### Viewer (labels, navigation, empty states)

| Token | Type | Default | Purpose |
| --- | --- | --- | --- |
| `--protvista-track-content-width` | length | `80vw` | Width of the track-content (visualisation) column. |
| `--protvista-label-width` | length | `20vw` | Width of the label column (group/track/nav labels, credits). |
| `--protvista-group-label-bg` | color | `#f1f3f5` | Background of collapsible group labels. |
| `--protvista-track-label-bg` | color | `#ffffff` | Background of individual track labels. |
| `--protvista-track-border-color` | color | `#e3e6ea` | Hairline ruling the viewer grid: between rows, and between the label column and the track area. |
| `--protvista-caret-color` | color | `#5b6169` | Group-label expand/collapse caret. |
| `--protvista-nav-handle-fill` | color | `darkgrey` | Fill of the navigation zoom handles. |
| `--protvista-nav-handle-stroke` | color | `black` | Stroke of the navigation zoom handles. |
| `--protvista-no-results-bg` | color | `#e4e8eb` | Background of the "no results" empty state. |

### Tooltip

| Token | Type | Default | Purpose |
| --- | --- | --- | --- |
| `--protvista-tooltip-bg` | color | `var(--protvista-color-surface)` | Tooltip background. |
| `--protvista-tooltip-color` | color | `var(--protvista-color-text)` | Tooltip text colour. |
| `--protvista-tooltip-border` | color | `var(--protvista-color-border)` | Tooltip border and arrow colour. |
| `--protvista-tooltip-max-width` | length | `320px` | Maximum tooltip width before text wraps. |

### Datatable

| Token | Type | Default | Purpose |
| --- | --- | --- | --- |
| `--protvista-datatable-accent` | color | `var(--protvista-color-accent)` | Accent — focus outline, active-row marker. |
| `--protvista-datatable-text-head` | color | `#1a1a1a` | Header-cell text colour. |
| `--protvista-datatable-text-body` | color | `#2c2c2c` | Body-cell text colour. |
| `--protvista-datatable-text-muted` | color | `#444444` | Muted text (e.g. the no-results message). |
| `--protvista-datatable-text-input` | color | `#333333` | Filter `<select>` text colour. |
| `--protvista-datatable-bg-base` | color | `var(--protvista-color-surface)` | Datatable base background. |
| `--protvista-datatable-bg-header` | color | `#f8f8f8` | Sticky header-row background. |
| `--protvista-datatable-bg-hover` | color | `#f1f7ff` | Row hover/focus background. |
| `--protvista-datatable-bg-active` | color | `#e6f3ff` | Selected/active-row background. |
| `--protvista-datatable-border` | color | `#e0e0e0` | Cell and container borders. |
| `--protvista-datatable-border-input` | color | `#767676` | Filter `<select>` border. |
| `--protvista-datatable-shadow-header` | color | `#cccccc` | Under-shadow of the sticky header row. |
| `--protvista-datatable-max-height` | length | `400px` | Max height of the scroll container before it scrolls. |

> **Migrating from `--protvista-dt-*`:** the datatable tokens were
> previously named `--protvista-dt-*`. Those names still work as aliases
> for one major cycle — an existing `--protvista-dt-primary` override, for
> example, is honoured by `--protvista-datatable-accent` — but new code
> should use the `--protvista-datatable-*` names.

## Datatable `::part`

The datatable (`<protvista-uniprot-datatable>`, used inside the
structure panel) exposes these parts:

| Part | Element |
| --- | --- |
| `scroll-container` | The scrolling wrapper around the table. |
| `table` | The `<table>` element. |
| `header` | The `<thead>` header section. |
| `header-cell` | Each header `<th>`. |
| `filter-select` | Each column filter `<select>`. |
| `row` | Every body row. |
| `row-active` | The selected row (in addition to `row`). |
| `cell` | Every body `<td>`. |
| `no-results` | The empty-state cell shown when a filter matches nothing. |

```css
protvista-uniprot-datatable::part(header) {
  background: #1a1a2e;
  color: #fff;
}
protvista-uniprot-datatable::part(row):hover {
  background: #fff7e6;
}
```

## What is *not* themable here

- **Data-domain colours** — the AlphaFold pLDDT and AlphaMissense
  pathogenicity ramps, and variant/PTM colours — are semantic data
  encodings, not interface chrome. They are themed through the viewer
  configuration (`registerTheme()` / rendering presets), not these
  tokens.
- **Nightingale track internals** — the track canvases are rendered by
  the upstream `@nightingale-elements/*` components; only the properties
  those components choose to expose can be set from here.

## On the roadmap

- **Dark mode** — a `prefers-color-scheme` default token set. The token
  layer above is the substrate; the palette itself is planned follow-on.
- **Colour-blind-friendly palettes** — part of the viewer's WCAG
  accessibility work; likewise a token-swap on top of this layer.
- **No-code styling panel** — the interactive playground will let
  non-developers adjust these tokens with live preview.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
