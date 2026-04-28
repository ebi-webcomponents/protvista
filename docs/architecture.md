# Codebase architecture

A walking tour for developers landing on this repo for the first time. The README covers consumer-facing concerns (what to install, how to mount the element, the public API). This document covers the inside: where things live, how a config turns into pixels, and where to look when you want to add or change something.

## What ProtVista does

`<protvista-uniprot>` is a Lit-based custom element that renders a stack of [Nightingale](https://github.com/ebi-webcomponents/nightingale) tracks for one protein. It owns three things: a declarative config (which tracks to draw, where to fetch data, how to style), a small fetch / adapter / normalize pipeline, and the lifecycle that wires Nightingale components into the DOM.

The element has no opinion about _which_ protein-data API you point it at. The default config drives the EBI UniProt viewer because the bundled adapters know how to talk to the UniProt Proteins API, AlphaFold, AlphaMissense, and InterPro. Embedders can register their own adapters and ship their own configs without forking.

## Top-level layout

```
src/
  protvista-uniprot.ts           the custom element (Lit class)
  protvista-uniprot-datatable.ts companion table component
  protvista-uniprot-structure.ts companion 3D-structure component
  index.ts                       re-exports + customElements.define
  default-config.yaml            the canonical UniProt viewer, in config form
  load-data.ts                   per-track fetch + adapter pipeline
  filter-config.ts               filter-UI bindings
  renderer/
    render-helpers.ts            rendering glue (group / track DOM)
  schema/                        config-as-data: types, schema, validate, normalize, extends, load
  tooltips/                      declarative tooltip resolver + click-popover
  adapters/                      per-API data shapers
  utils/security.ts              escapeHtml + URL-scheme allowlist
  styles/                        component CSS
specs/                           design notes (intentionally ephemeral)
docs/                            authoring guides (data-tooltip.md, this file)
```

The `src/schema/` and `src/tooltips/` folders are where most config-as-data work happens. The element file (`src/protvista-uniprot.ts`) is small on purpose — it orchestrates the pipeline rather than implementing it.

## How a config becomes pixels

The viewer's pipeline runs in five stages. Each stage has one entry point and one output shape; downstream stages assume the previous one has already happened. The split makes each stage independently testable.

```
                  ┌──────────────┐
                  │ author input │  YAML file, JSON file, or
                  └──────┬───────┘  in-memory object
                         │
              parseConfigText()  src/schema/parse.ts
                         │
              ProtvistaViewerConfig (raw, with extends)
                         │
              mergeExtends()  src/schema/extends.ts
                         │
              ProtvistaViewerConfig (raw, no extends)
                         │
              validateConfig()  src/schema/validate.ts
                         │
              ProtvistaViewerConfig (validated)
                         │
              normalizeConfig()  src/schema/normalize.ts
                         │
              NormalizedConfig
                         │
              loadProtvistaData()  src/load-data.ts
                         │
              { [groupId-trackId]: AdaptedData }
                         │
                       render
```

The element wraps these stages in `loadConfig()` (`src/schema/load.ts`) and `_init()` (`src/protvista-uniprot.ts`).

### 1. Parse

`parseConfigText()` accepts a YAML or JSON string and returns a plain JS object. YAML uses `js-yaml` with `SAFE_SCHEMA` (no `!!js/function`, no surprise tag handlers). The parser is pure — no I/O, no validation.

### 2. Extends

`mergeExtends()` resolves the optional `extends:` chain and merges the chain into one `ProtvistaViewerConfig`. The merger:

- Tracks chain membership by literal extends string and fails fast on cycles (`circular-extends` error code, message names every link in walk order).
- Caps fetched parent configs at 2 MiB per parent (DoS guard).
- Hands off name resolution to a caller-supplied `resolver` first; falls back to URL / file-path fetching for anything resolver-declined that looks like a URL or path; everything else is `cannot-resolve-extends`.
- Strips `extends:` from the output so downstream stages don't have to think about it.

Merge rules: `sources` and `defaults.rendering` merge by key (child wins); `groups` and their `tracks` merge by `id` (child extends in place, new ids append); scalar fields are child-wins.

### 3. Validate

`validateConfig()` runs two passes:

1. **Structural.** Ajv (draft 2020-12) against `src/schema/schema.json`. Catches shape problems — unknown properties, wrong types, missing required fields. A structural failure short-circuits.
2. **Semantic.** Closed-set checks against the runtime registry: every adapter, kind, component, and theme name must resolve. Plus a handful of cross-field checks (unknown `sources` keys, `{accession}` placeholder used without an accession, version in the supported set).

The validator is non-throwing — it returns a `ValidationResult` with an `issues[]` array. The loader (`src/schema/load.ts`) is what turns a failed result into a thrown `ConfigValidationError`. This split keeps the validator trivially unit-testable and lets editor extensions / CI tooling consume the same data.

### 4. Normalize

`normalizeConfig()` canonicalises the validated config into the shape the loader and renderer want:

- `data:` shorthand (string / single descriptor / array of descriptors) collapses to `NormalizedDataSource[]`.
- `from` defaults to `"url"` when omitted, `"inline"` when `inlineData` is set.
- Semantic `kind` resolves through the registry into `(component, adapter, rendering preset)`.
- Rendering cascades: `defaults.rendering → group.rendering → kind preset → track.rendering`. The kind preset sits between group and track so canonical ramps (e.g. AlphaFold confidence) win over group colour but lose to explicit author overrides.
- Group `component` is inferred from child tracks if omitted (all-same → that component; mixed → `nightingale-track-canvas`).
- `label` falls back to a title-cased `id` when omitted.
- Duplicate group / track ids throw at this stage (with the offending id named).
- `source:` references are resolved against the root `sources` map, with the original `source:` field preserved so the validator can produce author-friendly error messages.

Normalize is deliberately non-throwing for unknown names — `validateConfig` is the canonical place for those errors, and running normalize on something already known to fail validation should produce a best-effort output rather than a stack of derived errors.

### 5. Load + render

`loadProtvistaData()` walks the `NormalizedConfig`, fetches each track's URL(s) (or reads `inlineData`), runs the named adapter, applies the per-item tooltip resolver, and writes the result into a `Record<groupId-trackId, data>` map. The element then sets that map as the `data` property on each Nightingale component in the DOM.

Concurrency: `_loadData()` uses an `AbortController` so a re-init (e.g. accession change) cancels in-flight fetches before the new round starts. DOM queries are scoped per-instance via `CSS.escape(this._instanceId)` so two viewers on the same page don't cross-talk.

## Key subsystems

### `src/schema/`

The config-as-data engine. Module-by-module:

| File           | Role                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `types.ts`     | TypeScript surface for `ProtvistaViewerConfig` and friends. Type-only, runtime-free.                   |
| `schema.json`  | JSON Schema (draft 2020-12). Source of truth for structural validation.                                |
| `errors.ts`    | `ValidationIssue`, `ValidationResult`, `ConfigValidationError`, the issue-code union.                  |
| `parse.ts`     | YAML / JSON string → plain object.                                                                     |
| `extends.ts`   | `extends:` chain resolver + merger.                                                                    |
| `validate.ts`  | Two-pass validator (Ajv + semantic).                                                                   |
| `normalize.ts` | Shorthand expansion, inheritance cascade, kind resolution, duplicate-id detection.                     |
| `registry.ts`  | Runtime registry for adapters, semantic kinds, themes. Per-instance, not module-global.                |
| `load.ts`      | Orchestrator: `loadConfig(input, opts) → NormalizedConfig`. Throws `ConfigValidationError` on failure. |
| `index.ts`     | Re-export surface for embedders.                                                                       |

`types.ts` and `schema.json` must stay in lockstep — change one, change the other. The compile-time test in `src/schema/__spec__/types.spec.ts` and the schema-shape tests in `src/schema/__spec__/schema.spec.ts` are what catch drift.

### `src/tooltips/`

The declarative tooltip resolver. Two `kind` variants are supported:

- `kind: 'fields'` — deterministic HTML synthesis from a list of `{ path, label }` rows. Each row becomes `<h5>label</h5><p>HTML-escaped value</p>`.
- `kind: 'markdown'` — Markdoc template rendered against the item's fields plus a `ctx` object carrying `{ accession, trackId, kind }`. Templates use `{% $field %}` for interpolation and `{% if %}` / `{% /if %}` for conditionals.

There is no `kind: 'custom'` and no programmatic per-kind override surface. Rich, interactive, or stateful tooltips (React panels, evidence badges, taxonomy lookups) are a consumer concern — listen for the Nightingale `change` event on the element, mount your own UI, set the `notooltip` attribute on `<protvista-uniprot>` to suppress the built-in popover.

The popover itself (`popover.ts`) is built on `@floating-ui/dom`: click-triggered, with arrow / flip / shift middleware, keyboard Escape, scroll-dismiss, and focus capture / restore.

When a track has no `dataTooltip` and no per-kind default, `resolve.ts` synthesizes a minimal `fields` spec from common feature-shaped fields (`type`, `description`, `start`/`begin`, `end`). Configs that don't author a tooltip therefore still get a sensible one out of the box.

### `src/adapters/`

Per-API data shapers. Each adapter takes a raw response (or several, for multi-URL tracks) and returns the shape a Nightingale component expects. Adapters are named `<source>-<format>`: `uniprot-features-json`, `alphafold-prediction-json`, `interpro-entries-json`, etc. The convention makes coupling explicit at a glance.

Adapters are registered with the runtime registry at boot time by a `registerBuiltinAdapters(registry)` call in `src/load-data.ts`. The registry holds them as `(name → AdapterFunction)` so the validator can close the open-string `adapter:` union and the loader can look the function up at fetch time.

To add a new adapter: write the function, add a case to `KnownAdapterName` in `src/schema/types.ts`, and register it in `registerBuiltinAdapters`. The schema's `adapter` field is open-string (with `(string & {})` as the IntelliSense-preserving suffix), so consumer-registered adapters type-check too.

### `src/utils/security.ts`

`escapeHtml()` and the URL-scheme allowlist (`http:`, `https:`, `mailto:`). Anything author-controlled that ends up in HTML must go through `escapeHtml`, including label values, field paths, and Markdoc-rendered template output. The allowlist drops `javascript:` and `data:` URLs at render time.

The XSS regression suite lives in `src/utils/__spec__/security.spec.ts` — quote-break attempts, `javascript:` href injection, `<img onerror>` payloads, all the usual suspects.

### `src/protvista-uniprot.ts`

The custom element. Roughly:

- **Reactive properties.** `accession`, `configSrc`, `config`, `nostructure`, `notooltip`, `suspend`. Lit watches these and triggers `updated()`.
- **`updated(changedProperties)`.** First mount → `_init()`. `accession` change after mount → re-`_init()` with cancellation of any in-flight `_loadData()`.
- **`_init()`.** Resolves the effective config via `resolveViewerConfig()` (`viewerConfig` property > `configSrc` attribute > bundled default), runs `loadConfig()`, mounts the Nightingale components into the DOM, then calls `_loadData()`.
- **`_loadData()`.** Calls `loadProtvistaData()` and writes the result onto each Nightingale component instance, scoped to this element's `_instanceId` so two viewers on the same page don't cross-talk.
- **Public runtime API.** `setTrackData(groupId, trackId, data)` for `from: 'custom'` tracks, `setConfig(config)` for full re-render, `on(event, callback)` for subscribing to viewer events.

The element is a thin orchestrator. If you find yourself adding business logic here, ask whether it belongs in `schema/`, `tooltips/`, or `load-data.ts` instead.

## Adding things

### A new semantic kind (built-in)

Define it in three places in lockstep:

1. Add to `KnownSemanticKind` in `src/schema/types.ts` (with a one-line JSDoc explaining what data it renders).
2. Add to `BUILTIN_SEMANTIC_KINDS` in `src/schema/registry.ts` with `(component, adapter, rendering?)`.
3. Update `src/schema/__spec__/registry.spec.ts`'s "seeds exactly the N documented semantic kinds" test.

If the kind needs a new colour theme, add it to `BUILTIN_THEMES` in `registry.ts` too.

### A consumer-defined semantic kind (runtime)

Embedders register their own at runtime via the element's `registerSemanticKind(name, def)` API. The validator's open-string `(string & {})` suffix means consumer-defined kinds type-check without widening the closed `KnownSemanticKind` union.

### A new adapter

1. Write the function in `src/adapters/`. Signature: `(...rawResponses: unknown[]) => unknown | Promise<unknown>`.
2. Add to `KnownAdapterName` in `src/schema/types.ts`.
3. Register it in `registerBuiltinAdapters()` in `src/load-data.ts` (or, for consumer adapters, expose `registerAdapter(name, fn)` on the element's runtime API).
4. Add a unit test under `src/adapters/__tests__/` (or `__spec__/`).

### A new colour-scale theme

"Theme" here means a named colour ramp for `colorScale` rendering (e.g. `alphafold-ramp`, `alphamissense-ramp`) — a value referenced from `ColorScaleConfig.theme` in the config. It is **not** a CSS theme for the overall component look-and-feel. CSS theming for the element as a whole is a separate concern handled via the component's stylesheet (`src/styles/protvista-styles.ts`) and any CSS variables it exposes.

For built-in colour ramps: add to `BUILTIN_THEMES` in `src/schema/registry.ts`. For consumer-defined ramps: `element.registerTheme(name, stops)` at runtime. `stops` requires at least two `{ value, color, label? }` entries; values are the numeric thresholds at which each colour applies, in monotonically increasing order.

### A new rendering field

Add to `RenderingOptions` in `src/schema/types.ts` and to `RenderingOptions` in `src/schema/schema.json`. Then thread it through the renderer (`src/renderer/render-helpers.ts`) so it actually maps to a Nightingale component attribute.

## Conventions and gotchas

### Specs are ephemeral

`specs/config-approach.md`, `specs/transform-engine.md`, `specs/generic-format-adapters.md` are working documents. Source code does not point at them — code stands alone. Spec files can point at code, not the other way around. If you find yourself writing `// see specs/X.md` in a `.ts` file, restate the relevant claim in plain English instead.

### `(string & {})` open-union pattern

`SemanticKind`, `ComponentName`, and `AdapterName` are typed as `KnownX | (string & {})`. The `(string & {})` half is what TypeScript needs to keep the literal union's IntelliSense behaviour (autocomplete the known names) while still accepting any consumer-registered string. Don't simplify this to `string` — you lose the autocomplete.

### Conditional-spread for optional output fields

Throughout `normalize.ts` you'll see:

```ts
return {
  id: c.id,
  ...(c.description !== undefined ? { description: c.description } : {}),
  ...
};
```

This is deliberate — it keeps `undefined` fields out of the output object. Downstream code can rely on `'description' in track` rather than `track.description !== undefined`. Match the pattern when adding new optional fields.

### Two viewers on one page

DOM queries are scoped per-instance via `CSS.escape(this._instanceId)`. The registry is per-element, not module-global. If you add code that touches the DOM or holds shared state, scope it the same way — otherwise two `<protvista-uniprot>` elements on the same page will trample each other.

### jsdom CSS warning filter

`src/__spec__/setup.ts` filters out jsdom's "Could not parse CSS stylesheet" warnings. jsdom's CSS parser is CSS2-era and chokes on the nested-selector syntax in `src/styles/protvista-styles.ts`. The stylesheet still attaches correctly; the warning is log noise. Remove the filter when we migrate to happy-dom or jsdom learns native nesting.

### Validator vs. schema responsibilities

The JSON Schema (`src/schema/schema.json`) is for shape. The semantic validator (`src/schema/validate.ts`) is for everything that depends on the runtime registry — unknown adapter, unknown kind, unknown source key, missing accession placeholder, and so on. New rules generally belong in one or the other, not both. The structural pass short-circuits, so don't put structural checks in the semantic pass — they'd never run when they're needed most.

### Error messages are stable

`ValidationIssueCode` is a closed kebab-case union (`unknown-adapter`, `missing-track-renderer`, …). Tools downstream (editor extensions, CI scripts) can switch on the code without parsing English text. Wording can drift; codes cannot. If you change a code, that's a breaking change to the issue-code union.

## Testing

`yarn test` runs lint + types + unit. `yarn test:unit` is the CI-friendly subset. `yarn test:coverage` writes v8 coverage to `./coverage/`. See the README's Testing section for the full list.

Spec files live next to the code they test in `__spec__/` directories, except `src/adapters/__tests__/` (legacy naming, not worth churning). Tests import from `'vitest'` explicitly — `globals: false` is set so `describe` / `it` / `expect` are not module-globals.

## Where to ask

Open an issue, or come to office hours (see `CONTRIBUTING.md`). PRs welcome — see the PR checklist in `CONTRIBUTING.md`.
