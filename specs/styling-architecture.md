# Styling architecture — modernisation design

Design for a single, standards-based styling architecture for
`protvista-uniprot` built on **CSS custom properties** (design tokens)
and **`::part`**, replacing three divergent ad-hoc styling mechanisms
with one documented theming contract that library consumers can
customise without forking.

**Status: the Q2 core slice is implemented** (token registry, all three
components migrated, datatable `::part`, inline styles removed, unified
injection, `docs/theming.md`). Dark mode, colour-blind palettes, and a
no-code styling panel are deliberately deferred — see
[Roadmap alignment & Q2 delivery](#roadmap-alignment--q2-delivery).

It is scoped to the *chrome/UI* styling of the viewer (labels,
tooltips, tables, legends, loaders, empty states) and deliberately
excludes data-domain colour ramps (pLDDT, AlphaMissense, disease
variants), which already have their own theming path — see
[Scope boundaries](#scope-boundaries).

## Audience

This surface serves **developer-integrators** — people embedding
`<protvista-uniprot>` in an application who want it to match their design
system. That is exactly the "customise the interface" of ROADMAP.md
line 59 ("allow *library users* to customise"). It is deliberately
*not* the same as two adjacent, distinct pieces of work:

- the **no-code track-configuration UI** (reorder / show / hide tracks)
  for non-technical end-users (ROADMAP line 60), and
- the **non-coding bench scientists** the Starter Kit targets.

Theming here is a write-CSS surface *by design*: overriding a token or a
`::part` rule is a developer action. The registry (`src/styles/tokens.ts`)
is nonetheless the **substrate** a future no-code styling panel can drive
— it can enumerate the typed tokens and write overrides via
`host.style.setProperty(...)` — so building that panel does not require
re-plumbing anything here.

## Purpose

Today a consumer who embeds `<protvista-uniprot>` cannot recolour a
group label, restyle a tooltip, or match the datatable to their app's
design system without overriding undocumented, explicitly-unstable
internal class names. The three components style themselves three
different ways, colours and spacing are hardcoded as literals in a
dozen places, and the structure component scatters inline `style=`
attributes that no consumer can reach and that fight a strict CSP.

This is technical debt on two axes:

- **Maintenance.** The same colour (`#0053d6`, `#d9faff`, …) is
  restated across files; there is no single place to change the
  viewer's look; three injection paths must each be understood and
  kept working.
- **Extensibility.** ProtVista's grant goal is to become a
  *low-friction, embeddable* tool (see
  [`specs/config-approach.md`](./config-approach.md)). A viewer an
  external lab cannot make look like *their* viewer is a viewer they
  will fork or abandon. Customisation is a first-class adopter need,
  not a nice-to-have.

The fix is a documented theming contract built from web-native
primitives, so consumers customise the viewer with plain CSS and no
JavaScript.

## Current state

Three components, three mechanisms — inventoried against the baseline
tree so the removal target is concrete.

| Component | Render root | Style mechanism | Customisation surface |
| --- | --- | --- | --- |
| `protvista-uniprot` (main) | **Light DOM** (`createRenderRoot() → this`, forced by Mol\*) | Lit `css` templates in `src/styles/{protvista,loader}-styles.ts`, `.toString()`-ed into one global `<style data-protvista-uniprot>` in `<head>` via `addStyles()`. Classes carry the `CSS_PREFIX` hash (`pv-cecb45`) and are tag-scoped under `protvista-uniprot`. | **None.** All colours hardcoded (`#b2f5ff`, `#d9faff`, `#333`, tooltip `#fff/#222/#c5c8cc`). No custom properties. Class names explicitly *not* part of the compat contract (audit §C). |
| `protvista-uniprot-structure` | **Light DOM** (`createRenderRoot() → this`) | `get cssStyle()` `css` template injected as a global `<style id=…>` in `<head>`, **plus** inline `style="…"` attributes on legend swatches and icons with hardcoded `rgb()` / `#808080`. | **None.** Inline styles are unreachable and CSP-hostile. |
| `protvista-uniprot-datatable` | **Shadow DOM** (`static styles`) | Real encapsulation. Already uses custom properties (`--protvista-dt-*` on `:host`) plus `--protvista-datatable-max-height`. | **Partial.** Custom properties pierce the shadow boundary so a consumer *can* override colours — but they are undocumented, inconsistently namespaced, and there are **no `part` attributes**, so structural elements (rows, header, cells, filter selects) can't be targeted. |

Hardcoded UI colour/spacing literals to migrate live in
`src/styles/protvista-styles.ts`, `src/styles/loader-styles.ts`, and
`src/protvista-uniprot-structure.ts` (both the `cssStyle` block and the
inline attributes). The datatable's `:host` block is already
token-shaped and becomes the naming reference the other two adopt.

## Design principles

1. **Web-native, no framework.** Only CSS custom properties, `::part`,
   `@media (prefers-color-scheme)`, and the cascade. No CSS-in-JS
   theming runtime, no build-time preprocessor, no new dependency.
2. **The customisation primitive follows the render root.** This is the
   load-bearing constraint and the reason a naïve "just add `::part`
   everywhere" plan fails:
   - **Shadow DOM (datatable)** → expose internals with **`part`
     attributes** so consumers write `protvista-uniprot-datatable::part(row)`,
     *and* accept themable **custom properties** (they pierce the
     boundary).
   - **Light DOM (main, structure)** → `::part` does **not** apply
     (there is no shadow boundary to cross). The stable, documented
     surface is **CSS custom properties**. Internal class names remain
     private (audit §C) and must *not* be promoted to public API; the
     hash prefix stays as collision defence.
3. **One token vocabulary, defaults included.** A single
   `--protvista-*` namespace, defined once with fallback defaults at
   the point of use (`var(--protvista-x, <default>)`), so the viewer
   looks identical with zero consumer CSS and fully retheme-able with a
   few declarations.
4. **Semantic tokens, not raw values.** Consumers set intent
   (`--protvista-color-accent`) not implementation
   (`--protvista-group-label-bg: #b2f5ff` derives from the accent).
   Two tiers: a small **global** set and per-component tokens that
   default *from* the global set.
5. **Defaults are a contract; internals are not.** The documented token
   names and `part` names become part of the v-cycle compatibility
   surface (audit §C). Everything else stays free to change.

## Target architecture

### 1. A design-token layer

Introduce `src/styles/tokens.ts` exporting a single `css` block that
defines defaults on the `protvista-uniprot` host (and re-declared on
the datatable `:host` so shadow-encapsulated defaults still resolve).
Proposed vocabulary (illustrative, finalise during implementation):

```
/* Global — the small set consumers reach for first */
--protvista-font-family        (default: inherit)
--protvista-font-size          (default: 0.8rem)
--protvista-color-accent       (default: #0053d6)   /* datatable primary, focus rings */
--protvista-color-text         (default: #222)
--protvista-color-text-muted   (default: #4a5056)
--protvista-color-surface      (default: #fff)
--protvista-color-border       (default: #c5c8cc)
--protvista-radius             (default: 4px)
--protvista-shadow-popover     (default: 0 4px 12px rgb(0 0 0 / .15))
--protvista-z-structure        (default: 40000)

/* Component — default FROM the global set, override for fine control */
--protvista-group-label-bg     (default: #b2f5ff)
--protvista-track-label-bg     (default: #d9faff)
--protvista-tooltip-bg         (default: var(--protvista-color-surface))
--protvista-tooltip-border     (default: var(--protvista-color-border))
--protvista-datatable-*        (rename/alias of today's --protvista-dt-*)
```

Every hardcoded literal in the three UI style sources is replaced with
`var(--protvista-…, <current-literal-as-default>)`. The inline
`style=` attributes in the structure component move into the `cssStyle`
block as classed rules that read tokens (removing the CSP-hostile
inline styles). Data-domain swatch colours that are genuinely data
(the AF/AM legend fills) stay as values but are sourced from the same
ramp definitions the tracks use, not restated — see scope.

### 2. `::part` on shadow-DOM components

Add `part` attributes to the datatable's rendered elements so consumers
can target structure, not just colour:

```
part="scroll-container" | "table" | "header" | "header-cell"
part="filter-select" | "row" | "row-active" | "cell" | "no-results"
```

Documented as the datatable's public styling API alongside its
`--protvista-datatable-*` tokens. This is the template for any future
shadow-DOM component. (The two light-DOM components get no `part`
attributes — see principle 2.)

### 3. Unify style injection

Collapse the two global-`<style>`-into-`<head>` paths (main +
structure) into one shared helper that (a) installs the token layer
once, (b) is idempotent per stylesheet (extend the existing
`data-protvista-uniprot` guard), and (c) keeps the datatable on
`static styles` in its shadow root. Net result: one token source of
truth, one injection code path for light-DOM chrome, standard shadow
styling for the encapsulated component.

### 4. Theming entry points (documented)

Consumers override tokens at any level above the component:

```css
/* App-wide */
:root { --protvista-color-accent: #7b2d8e; --protvista-radius: 8px; }

/* One instance */
protvista-uniprot#my-viewer { --protvista-group-label-bg: #eee; }

/* Datatable structure via ::part */
protvista-uniprot-datatable::part(row-active) { outline: 2px solid hotpink; }
```

Optional stretch: ship a `@media (prefers-color-scheme: dark)` default
token set so the viewer is dark-mode-aware out of the box. Gated behind
verifying legibility of Nightingale-owned track canvases (audit §C2:
those are upstream-owned and out of our styling reach) — recommend
scoping dark mode as a follow-on, not MVP.

## Scope boundaries

**In scope** — UI/chrome styling authored in this package: group &
track labels, the collapse caret, nav/credits rows, the click-tooltip
popover, the loader and no-results/empty states, the structure
component's meta panel and legend layout, and the datatable.

**Out of scope** — *data-domain* colours, which already have a theming
mechanism and must not be conflated with UI tokens:

- AlphaFold pLDDT and AlphaMissense ramps
  (`src/renderer/render-helpers.ts`, `amColorScale`) — themable via the
  config's `registerTheme()` path (audit §A7).
- Variant/disease/PTM-tier colours (`src/filter-config.ts`,
  `ptm-exchange-adapter.ts`) — semantic data encodings owned by the
  adapter/filter layer.
- Nightingale child components' own internal styling — upstream package
  boundary (audit §C2). We can only set custom properties they choose
  to expose; we do not restyle their shadow internals.

Keeping these out prevents the token layer from ballooning into a
data-visualisation theming system, which is a separate concern.

## Roadmap alignment & Q2 delivery

This work maps to **ROADMAP.md, Q2 (Months 4–6), line 59** —
"Modernise the styling architecture, using native web standards like CSS
`::part` and custom properties, to reduce technical debt and allow
library users to customise the interface." It is a roadmap line, not a
panel-scored grant deliverable (those are the functional beta, the
webinar, and the playground beta), so it was scoped tightly to
*reinforce* those items rather than compete with them near the 31 July
Q2 boundary. It advances two grant themes directly: **reducing technical
debt** (three ad-hoc mechanisms → one token layer) and providing the
**substrate** for both the interactive playground and the WCAG
colour-blind-palette accessibility commitment.

**Shipped this quarter (additive, backward-compatible, defaults ==
prior literals → zero visual change):**

- `src/styles/tokens.ts` — the structured token registry.
- All three components migrated to `var(--protvista-*)`; the structure
  component's inline `style=` attributes removed.
- `::part` on the datatable; `--protvista-dt-*` → `--protvista-datatable-*`
  with back-compat aliases.
- Unified light-DOM injection (`src/styles/inject.ts`).
- `docs/theming.md` (CC BY 4.0), plus a `theming.spec.ts` guard.

**Deferred (tracked as `next`-label issues, per the grant's
scheduling-risk mitigation):**

- **Dark mode** — a `prefers-color-scheme` default set. Depends on
  Nightingale-owned track-canvas legibility we don't control (§C2); the
  registry makes it a later token-swap.
- **Colour-blind-friendly palettes** — part of the **Q3 WCAG
  accessibility** deliverable (ROADMAP line 82). The token layer is the
  hand-off point: shipping accessible palettes becomes a token-set swap
  on top of this foundation, not a re-architecture.
- **Live no-code styling panel** — belongs with the Q2 track-config-UI /
  playground workstream; the registry is the ready substrate.

The `docs/theming.md` reference is published under CC BY 4.0 (Q2/Q4
documentation outputs); its typed token vocabulary also serves as the
kind of clear, machine-readable boundary the grant argues aids
AI-assisted maintenance.

## Backwards compatibility

- **New public surface.** The documented `--protvista-*` tokens and the
  datatable `part` names become part of the compatibility contract for
  the current major cycle (audit §C). Adding this surface is
  non-breaking: with no consumer CSS the rendered output is
  pixel-identical (defaults equal today's literals).
- **Datatable token rename.** `--protvista-dt-*` →
  `--protvista-datatable-*` for namespace consistency. Keep the old
  names as `var()` aliases for one major cycle; announce via the `next`
  label per the audit's mitigation policy.
- **Internal class names stay private.** The `CSS_PREFIX` hash and
  tag-scoping are retained; nothing here promotes a class name to
  public API (audit §C explicitly excludes class names).
- **Injected `<style>` marker changed.** Unifying injection replaced the
  old `data-protvista-uniprot` marker attribute (and the structure
  component's `id="protvista-styles"`) with keyed `data-protvista-style`
  nodes. Like the class names, this marker is an internal implementation
  detail, not part of the compatibility contract; there are no in-repo
  consumers.
- **Token defaults live on `:root`.** They are declared on
  `:where(:root)` (specificity 0), not on the host tags, so that a
  consumer's `:root { --protvista-…: … }` / ancestor / per-instance
  override wins — a value declared directly on the host would shadow an
  inherited override. See `installTokenDefaults`.
- **Shared sheets are page-lifetime.** The install-once token/loader/
  component `<style>` nodes back every instance and are never removed on
  disconnect — removing one would strip styling from other live viewers.
- **Snapshot tests.** In practice the snapshots did **not** churn:
  `render-target.spec.ts` captures the main component's light DOM (whose
  structure is unchanged — token migration alters CSS text, not markup),
  and the datatable/structure are mocked there, so the new `part`
  attributes don't appear. All unit tests pass unchanged; a new
  `src/styles/__spec__/theming.spec.ts` guards the registry, the
  light-DOM defaults, the datatable's `::part` surface, and drift between
  the registry and both the datatable `:host` defaults and the docs.

## Work breakdown

1. **Token vocabulary.** Land `src/styles/tokens.ts` with the global +
   component token defaults; wire it into the injection path. No visual
   change yet (defaults == literals).
2. **Main component.** Replace literals in `protvista-styles.ts` /
   `loader-styles.ts` with `var()` references. Update snapshots.
3. **Structure component.** Move inline `style=` attributes into
   token-reading classed rules in `cssStyle`; replace literals.
4. **Datatable.** Rename tokens (+ aliases), add `part` attributes,
   confirm existing `:host` defaults resolve from the global tier.
5. **Injection unification.** Single idempotent helper for the two
   light-DOM paths.
6. **Docs.** New `docs/theming.md` — token reference table, `::part`
   list, copy-paste theming recipes; link from `README.md` and the
   architecture audit (updating the B9-adjacent styling-debt note).
7. **(Stretch) dark mode.** `prefers-color-scheme` default set, gated
   on track-canvas legibility.

## Testing & acceptance

- **Visual parity.** With zero consumer CSS, snapshot and a manual
  render (`yarn start`) show no visual change from baseline. This is
  the primary safety check — defaults must equal today's literals.
- **Customisation works.** A test fixture sets `--protvista-color-accent`
  and a `::part(row-active)` rule and asserts the override takes
  effect (unit assertion on computed style + a demo page in the
  fixtures).
- **No inline styles remain** in the structure component's template
  (grep gate in CI or a unit assertion) — proves the CSP-hostile path
  is gone.
- **Single token source.** Grep gate: no raw UI colour hex literals
  outside `tokens.ts` in the three UI style sources (data-domain files
  excluded).
- `yarn test` (lint + types + unit) green; snapshots updated with a
  reviewed, intentional diff.

## Acceptance criteria

- One documented `--protvista-*` token layer with defaults, consumed by
  all three components.
- Datatable internals reachable via `::part`.
- Structure component free of inline `style=` attributes.
- `docs/theming.md` published with a token reference, part list, and
  working recipes.
- Byte-for-byte visual parity at defaults; overrides demonstrably work.
- Backwards-compatible: no class-name promotion, datatable tokens
  aliased.

## Open questions

1. **Token granularity.** How fine-grained should component tokens go —
   every colour, or only the handful adopters actually ask to change?
   Recommend starting from the global tier + the datatable set already
   in use, and adding component tokens on demonstrated demand.
2. **Dark mode in this cycle or next?** Recommend next — it depends on
   Nightingale-owned canvas legibility we don't control (§C2).
3. **`--protvista-dt-*` alias lifetime.** One major cycle is proposed;
   confirm against the team's deprecation policy in the audit's
   mitigation section.

## Cross-references

- [`docs/architecture-audit.md`](../docs/architecture-audit.md) — §A14
  (global `<style>` scoping), §C (compatibility surface; class names
  are *not* contract), §C2 (Nightingale styling is upstream-owned).
- [`specs/config-approach.md`](./config-approach.md) — the
  low-friction-embedding goal this serves.
- `src/styles/` — the three UI style sources this consolidates.
- `src/protvista-uniprot-datatable.ts` — the existing token/`:host`
  pattern that becomes the naming reference.
