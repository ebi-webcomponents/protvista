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

Merge rules: `sources` and `defaults.rendering` merge by key (child wins); top-level `rows` entries — groups and standalone tracks alike, one shared id namespace — and a group's `tracks` merge by `id` (child extends in place, new ids append); scalar fields are child-wins. A base and a child may be authored with different spellings of the row list (`rows:` vs the deprecated `groups:`); the alias is resolved on every config entering the merger, so both sides match against one canonical `rows` list. Entry shape is read from the child's own keys, never from absence: a child that *positively* declares the other shape (a `tracks:` block over a base track, or a `data:` track over a base group) is a deliberate flip and replaces the base entry wholesale — child wins, no field merge — so a stale `tracks:` array or group `component` can't bleed onto the wrong shape. A child that declares *neither* `tracks:` nor `data:` is a scalar-only partial override: it inherits the base's shape and field-merges, so the base `tracks:` / `data:` it omits survive (e.g. overriding a group's `label` without restating its `tracks:` keeps them).

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
- Duplicate ids throw at this stage (with the offending id named). Top-level ids share one namespace across groups and standalone tracks; track ids are unique within their group.
- A **standalone top-level track** (a `rows:` entry with no `tracks:`) is wrapped in a synthetic single-track `NormalizedRow` flagged `standalone`, so downstream code stays on one uniform `NormalizedRow[]` path. A standalone track **bypasses the group-rendering layer**: its cascade is `defaults.rendering → kind preset → track.rendering` (no group block in between). Wrapping was chosen over a bare-`NormalizedTrack` union because it keeps the data loader and renderer from having to branch on entry shape; the cost is a synthetic group object whose `label` mirrors the track's.
- `source:` references are resolved against the root `sources` map, with the original `source:` field preserved so the validator can produce author-friendly error messages.

Normalize is deliberately non-throwing for unknown names — `validateConfig` is the canonical place for those errors, and running normalize on something already known to fail validation should produce a best-effort output rather than a stack of derived errors.

### 5. Load + render

`loadProtvistaData()` walks the `NormalizedConfig`, fetches each track's URL(s) (or reads `inlineData`), runs the named adapter, applies the per-item tooltip resolver, and writes the result into a `Record<groupId-trackId, data>` map. The element then sets that map as the `data` property on each Nightingale component in the DOM.

The renderer draws each `NormalizedRow` as a collapsible header plus its child-track rows. A group flagged `standalone` (the synthetic wrapper around an authored standalone track) is drawn instead as a single row with a plain, non-clickable track label and no collapse affordance — it reuses the same `group_<id>` container and `track-<id>-<id>` element id as a grouped track, so the shared visibility / data-binding code needs no special case. A genuine one-track group keeps its collapse header; the difference is author-controlled (presence of `tracks:`), never auto-collapsed.

Concurrency: `_loadData()` uses an `AbortController` so a re-init (e.g. accession change) cancels in-flight fetches before the new round starts. DOM queries are scoped per-instance via `CSS.escape(this._instanceId)` so two viewers on the same page don't cross-talk.

## Key subsystems

### `src/schema/`

The config-as-data engine. Module-by-module:

| File           | Role                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `types.ts`     | TypeScript surface for `ProtvistaViewerConfig` and friends. Type-only, runtime-free.                   |
| `schema.json`  | JSON Schema (draft 2020-12). Source of truth for structural validation.                                |
| `discriminate.ts` | `isGroupConfig` — the one predicate distinguishing a group from a standalone track in a `rows:` entry. |
| `rows-alias.ts` | `resolveRowsAlias` — folds the deprecated `groups:` spelling into `rows:` (warning once per process) so no later stage carries an alias branch. |
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

When a track has no `dataTooltip` and no per-kind default, `resolve.ts` synthesizes a compact Markdoc tooltip from common adapted payload fields (`type`, `description`, position, variant details, significance, score, xrefs, evidences, and remaining scalar fields). Configs that don't author a tooltip therefore still get a useful safety-net tooltip out of the box.

### `src/adapters/`

Per-API data shapers. Each adapter takes a raw response (or several, for multi-URL tracks) and returns the shape a Nightingale component expects. Adapters are named `<source>-<format>`: `uniprot-features-json`, `alphafold-prediction-json`, `interpro-entries-json`, etc. The convention makes coupling explicit at a glance.

These reach the loader as a plain `AdapterMap`: `src/protvista-uniprot.ts` collects them into an `adapters` object and passes it into `loadProtvistaData()`, which looks the function up by name at fetch time. They do not go through the runtime registry.

The registry's adapter bucket is a separate, consumer-facing surface. `createRegistry()` seeds it by calling `registerBuiltinAdapters(registry)` (`src/schema/registry.ts`), which walks the `BUILTIN_ADAPTERS` table in `src/schema/adapters/`. That table is the aggregation point for adapters that ship with the library and are usable without EBI-specific API plumbing — the generic-format adapters (`features-json`, `features-csv`, `features-tsv`, `bed`) land there, one ticket at a time. It is empty today.

Seeding runs through the same public `registerAdapter()` a consumer calls, so both share one namespace with defined precedence: **built-ins register first, and a consumer's later `registerAdapter()` of the same name overrides.** That override is permitted once — registering a name that is not a built-in twice still throws `RegistryCollisionError`, so a consumer colliding with their own adapter is still caught. Themes and semantic kinds have no override path; registering over those built-ins always throws.

To add a built-in adapter: write the module in `src/schema/adapters/`, add a case to `KnownAdapterName` in `src/schema/types.ts`, and add one line to `BUILTIN_ADAPTERS`. The schema's `adapter` field is open-string (with `(string & {})` as the IntelliSense-preserving suffix), so consumer-registered adapters type-check too.

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

Signature in every case: `(...rawResponses: unknown[]) => unknown | Promise<unknown>`.

For a **UniProt-API adapter** (the `<source>-<format>` family):

1. Write the function in `src/adapters/`.
2. Add to `KnownAdapterName` in `src/schema/types.ts`.
3. Add it to the `adapters` map in `src/protvista-uniprot.ts` so the loader can resolve it.
4. Add a unit test under `src/adapters/__tests__/`.

For a **built-in generic adapter** (no EBI API coupling — registry-seeded):

1. Write the module in `src/schema/adapters/`.
2. Add to `KnownAdapterName` in `src/schema/types.ts`.
3. Add one line to `BUILTIN_ADAPTERS` in `src/schema/adapters/index.ts`. `registerBuiltinAdapters()` needs no change, and `src/schema/__spec__/registry.spec.ts` asserts against the table, so it picks the new entry up automatically.
4. Add a unit test under `src/schema/__spec__/`.

For a **consumer adapter**, no library change is needed: call `registerAdapter(name, fn)` on the element's runtime API. It overrides a built-in of the same name.

### A new colour-scale theme

"Theme" here means a named colour ramp for `colorScale` rendering (e.g. `alphafold-ramp`, `alphamissense-ramp`) — a value referenced from `ColorScaleConfig.theme` in the config. It is **not** a CSS theme for the overall component look-and-feel. CSS theming for the element as a whole is a separate concern handled via the component's stylesheet (`src/styles/protvista-styles.ts`) and any CSS variables it exposes.

For built-in colour ramps: add to `BUILTIN_THEMES` in `src/schema/registry.ts`. For consumer-defined ramps: `element.registerTheme(name, stops)` at runtime. `stops` requires at least two `{ value, color, label? }` entries; values are the numeric thresholds at which each colour applies, in monotonically increasing order.

### A new rendering field

Add to `RenderingOptions` in `src/schema/types.ts` and to `RenderingOptions` in `src/schema/schema.json`. Then thread it through the renderer (`src/renderer/render-helpers.ts`) so it actually maps to a Nightingale component attribute.

## Conventions and gotchas

### One id namespace for top-level entries

The config's `rows:` array holds a discriminated union of `GroupConfig` (has `tracks:`) and standalone `TrackConfig` (has `data:`, no `tracks:`) — `isGroupConfig` in `src/schema/discriminate.ts` is the single source of truth for the discrimination, mirrored structurally by the `oneOf` in `schema.json`. The two shapes share **one id namespace**: a standalone track's `id` may not collide with a group's `id` (normalize throws `Duplicate top-level id '…'`). Track ids only need to be unique within their own group. When you add a code path that walks `config.rows`, route the shape check through `isGroupConfig` rather than hand-rolling a `'tracks' in entry` test, so all three stages (validate / normalize / extends) stay in lockstep.

The list was originally called `groups:`, which stopped being honest once it began holding standalone tracks alongside real groups. `rows:` is the canonical name — every entry is one vertical lane, and a group is simply an expandable lane. `groups:` survives as a deprecated alias for one cycle: `resolveRowsAlias` (`src/schema/rows-alias.ts`) folds it into `rows:` at the front of the pipeline and warns once per process, so nothing downstream of parse ever sees it. Setting both is a validation error rather than a silent preference.

The vocabulary is the same on both sides of the normalize boundary: an authored `rows:` entry becomes a `NormalizedRow`, and `config.rows` stays `config.rows`. Nothing downstream is called a "group" when it might actually be a standalone track. The one place the old word survives is the **rendered DOM** — a standalone row deliberately reuses the `group_<id>` element id and the `.group` / `.group--standalone` classes so the shared visibility and data-binding code needs no special case. That is markup, not vocabulary, and renaming it would be a breaking change for anyone styling or querying the output.

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
