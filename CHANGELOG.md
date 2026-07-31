# Changelog

## 5.0.0-beta.1 — 2026-07-30

First public beta of v5, published on the `beta` dist-tag. The stable 4.x line
stays on `latest`: `npm install protvista-uniprot` still resolves 4.9.x, and
this release is opt-in via `npm install protvista-uniprot@beta`. Schemas and
APIs may still change before 5.0.0.

The theme of the release is removing hardcoded assumptions. A viewer used to be
whatever `src/config.ts` said it was, against data sources fixed at EBI. It is
now driven by a configuration document you supply, over sources you choose,
arranged by whoever is looking at it.

With thanks to the contributors from outside the core team:
[**Jishanahmed AR Shaikh**](https://github.com/jishanahmed-shaikh), whose
[#137](https://github.com/ebi-webcomponents/protvista/pull/137) forbade `any`
across the codebase and turned on `noImplicitAny` and `strictNullChecks`
(closing [#133](https://github.com/ebi-webcomponents/protvista/issues/133)),
through two rounds of review; and [**Epi-Lo**](https://github.com/Epi-Lo), who
took on the same problem in parallel.

### Added — configuration-driven loading

A viewer is now described by a YAML or JSON configuration document rather than
compiled-in TypeScript. Point the element at one:

```html
<protvista-uniprot config-src="./my-config.yaml"></protvista-uniprot>
```

or assign an already-parsed object to the `viewerConfig` property. The document
declares its own data sources, the rows to draw, and how each is rendered:

```yaml
accession: P05067
sources:
  features: https://www.ebi.ac.uk/proteins/api/features/{accession}
rows:
  - id: DOMAINS
    tracks:
      - id: domain
        kind: features
        filter: DOMAIN
        data: features
```

This replaces a 912-line hand-written `src/config.ts` that enumerated 15 groups
and roughly 40 tracks with four EBI web addresses baked into it (deleted in
`945ca9f`). Consequences worth knowing:

- **The data sources are yours.** Nothing in the loader assumes EBI. A
  deployment can point every row at its own endpoints.
- **`extends:`** pulls in another config — including the canonical UniProt one,
  published at
  `https://cdn.jsdelivr.net/npm/protvista-uniprot@<version>/dist/default-config.yaml` —
  so "the default viewer plus my track" is a few lines, not a fork.
- **No build step.** Changing what a viewer shows no longer means editing source
  and rebuilding.

### Added — a published JSON Schema for viewer configurations

Configs are validated against a schema published at a stable URL, so a config
can be checked before it ever reaches a browser:

- `https://ebi-webcomponents.github.io/protvista/schema/v1/config.schema.json`
- `https://ebi-webcomponents.github.io/protvista/schema/v1/feature-record.schema.json`

Validation runs at load time and reports failures through the error surfaces
below rather than rendering a blank viewer. The schema is versioned under
`/v1/`, and the copy under `public/schema/v1/` is pinned byte-identical to the
authored source by a test, so the hosted document cannot drift from the code.

### Added — load your own data from CSV, TSV, JSON, or BED

A `features` row can read a data file directly. The extension picks the parser,
so there is no adapter to configure:

```yaml
rows:
  - id: hotspots
    label: Hotspots
    kind: features
    data: ./hotspots.csv
```

`.csv`, `.tsv`, `.json`, and `.bed` are recognised (`src/schema/file-formats.ts`).
A feature record's required columns are `type`, `start`, `end`, and
`description`; `score` is optional. Paths resolve against the hosting **page**,
not the config file.

The built-in adapters for UniProt's own payload shapes — variation, proteomics,
PTM-Exchange, InterPro, RNA editing, structure coverage, AlphaFold confidence,
AlphaMissense — are now selected by name from the config rather than wired in
code, and are listed in the published adapter reference.

### Added — Customize mode: reorder, show, and hide without code

Every viewer now carries a **Customize** control. In that mode each row grows
move-up / move-down buttons and a show/hide toggle: rows can be reordered and
hidden, and tracks reordered within their group or hidden individually. There is
no drag gesture — every control is operable by mouse, touch, and keyboard alike.

The same arrangement is available programmatically, and a layout edit rewrites
the viewer's config, so `getConfig()` exports exactly what the user arranged:

- `setRowOrder(order)`, `setTrackOrder(rowId, order)`
- `setRowVisibility(rowId, visible)`, `setTrackVisibility(groupId, trackId, visible)`
- `resetLayout()`, `getConfig()`, `getLayout()`

Each emits a `protvista-layout-change` event.

A layout **persists per configuration** — keyed on a hash of the config's row and
track ids, not on the accession — so it applies to every protein viewed with the
same config. It is stored in `localStorage` and encoded in a shareable `?layout=`
URL parameter. Set `no-persist-layout` to opt out of all of it.

### Added — declarative tooltips

Per-datapoint tooltips are authored as Markdoc templates in the config
(`dataTooltip`) instead of assembled as HTML strings in code:

```yaml
dataTooltip: "### {% $name %}\n\n**Score:** `{% $score %}`"
```

This replaces five files of hand-built markup that carried UniProt-specific
lookup tables into every consumer's bundle, and it means a tooltip for your own
data needs no JavaScript.

### Added — extension points for cases the config cannot express

The configuration covers the common ground; these escape hatches cover the rest,
without forking. Each registers against the element before it loads:

- `registerAdapter(name, fn)` — transform a payload shape the built-ins don't know.
- `registerComponent(name, ctor)` — render with your own custom element.
- `registerSemanticKind(name, def)` — define a new `kind:` for configs to use.
- `registerTheme(name, stops)` — add a named colour scale.

### Changed — dense tracks render on canvas

Feature and variant tracks, which can carry thousands of annotations on one
protein, now draw on HTML canvas rather than SVG
(`nightingale-track-canvas`, `nightingale-variation-canvas`,
`nightingale-colored-sequence`, `nightingale-sequence-heatmap`). This keeps
interaction responsive on densely annotated proteins and on modest hardware.

### Added — accessibility work and an automated baseline

The Customize controls are buttons rather than a drag interaction, carry 24×24px
targets, never signal state by colour alone, and announce each move through a
polite live region (for example "Domains moved to position 2 of 12"). A
browser-mode test layer drives real Chromium with axe-core assertions, and
reports no violations with Customize mode active.

This is a baseline, not a conformance claim: the manual WCAG audit is a later
deliverable, and `docs/accessibility-baseline.md` records both what is covered
and the residual gaps.

### Added — side-effect-free `protvista-uniprot/config` subpath

The variant `filterConfig` and `colorConfig` now have a dedicated,
side-effect-free entry point:

```js
import { filterConfig, colorConfig } from 'protvista-uniprot/config';
```

Importing them from the package root still works but pulls the whole viewer:
the root self-registers `<protvista-uniprot>` on load, so a bundler must keep
it (and Lit, every Nightingale track, Mol*) whenever the module is reached.
The `./config` subpath is built as its own output (`dist/config.mjs`) that
reaches none of that, so a consumer importing only the filter data can
tree-shake the element away. The element bundle imports the same chunk, so
the config is not duplicated.

`filter-config.ts` reaches nothing at runtime for this to hold — its
`@nightingale-elements/nightingale-variation-canvas` imports are now
type-only — and a spec walks the subpath's import graph and fails if it ever
reaches a custom-element registration.

The subpath's declarations are also mapped through `typesVersions` so the
classic (node10) resolver — which predates `exports` and would otherwise not
find them — resolves the types; modern resolvers ignore it and use `exports`.

### Fixed — packaging: `import 'protvista-uniprot'` survives bundling

The package declared `"sideEffects": false`, promising bundlers that no
module here does anything on load. That was untrue: `<protvista-uniprot>` is
registered by a `@customElement` decorator, so evaluating the entry module
*is* the registration. The promise let production bundlers delete the
documented binding-less `import 'protvista-uniprot';`, after which the tag
silently stayed undefined and the element rendered as an empty box. Dev
servers evaluate eagerly, so it only ever surfaced in a shipped build. The
field is now removed, restoring the default assumption that a module may
act on load.

Consequence worth knowing: importing only the named exports
(`filterConfig`, `colorConfig`, `ProtvistaUniprotStructure`) from the package
root can no longer shake the component out, so those consumers now pay the
full bundle. For `filterConfig` / `colorConfig`, the new side-effect-free
`protvista-uniprot/config` subpath (above) restores tree-shaking.

Also in this release:

- Removed the `main` field. It pointed at `dist/protvista-uniprot.js`, which
  no build has emitted since the move to Vite (ES output only) — any
  resolver falling through to it got a missing file. `module` and `exports`
  cover every live resolver.
- Added `types` and `default` conditions to `exports`. With only an `import`
  condition, TypeScript on `moduleResolution: "bundler"` or `"node16"`
  resolved *through* `exports` and never found `dist/types/index.d.ts`, so
  consumers got no declarations.
- Added `"type": "module"`. Everything shipped is ESM, but without the field
  two things read as CommonJS: the lazy `import()` chunks Vite emits as
  `dist/*.js`, which Node had to sniff and reparse (`MODULE_TYPELESS_PACKAGE_JSON`),
  and `dist/types/*.d.ts`, which TypeScript treated as a CJS declaration
  describing an ESM file — reported by `attw` as "masquerading as CJS" on
  both `node16` resolution modes.
- The built element entry is code-split: `dist/protvista-uniprot.mjs` loads
  sibling chunks — `errors.js` and the shared `filter-config.js` statically,
  `format.js` / `js-yaml.js` lazily — from the same directory. Bundlers and
  CDNs (jsDelivr, unpkg) resolve these automatically, so the npm and CDN paths
  need no change; a consumer copying the build to serve it directly must copy
  the whole `dist/` folder, not the `.mjs` alone.
- This package's own declarations now resolve under `node16`/`nodenext`.
  `moduleResolution: "bundler"` permits extensionless relative imports, the
  emitted `.d.ts` reproduced them faithfully, and they then failed to resolve
  for consumers using Node's ESM rules — degrading their types to errors.
  Relative specifiers in `src` now carry explicit `.js` extensions, so what
  is emitted is resolvable. No API change; imports of this package are
  unaffected. Types re-exported from `@nightingale-elements` packages may
  still degrade under Node ESM resolution — those ship the same defect
  upstream; see the `moduleResolution` note in `tsconfig.json`.
- The published `dist/` no longer carries two copies of the declarations.
  `tsc` and `vite-plugin-dts` were both emitting them, into different trees
  because the plugin's output directory was misconfigured, so `dist/` shipped
  both — and `yarn test` after `yarn build` changed what a subsequent
  `npm publish` would ship. `tsc` is now `noEmit` (`yarn test:types` is a
  check, not a build step) and the plugin owns `dist/types`. Declarations for
  test files are no longer shipped.
- `files` is now `["dist"]`. The tarball previously carried 139 source files
  — the entire test suite included — that no consumer could import, because
  `exports` gates every subpath. The sourcemap already embeds the sources for
  debugging. Unpacked size drops from ~1.15 MB to the build output alone.
- Added `prepack` so `npm pack`/`npm publish` build first. `dist/` is
  gitignored, so publishing without a prior `yarn build` shipped a package
  whose every declared entry point was missing.
- Dropped `core-js` and `lodash-es` from `dependencies` (and `@types/lodash-es`
  from dev) — nothing in the codebase has referenced them since the move off
  the Babel build.
- Runtime dependencies now use caret ranges instead of exact pins. Exact pins
  stop a consumer's resolver deduplicating, which for `lit` means a second
  copy of `ReactiveElement` in the same page.
- Added `repository`, `bugs`, `homepage` and `keywords`, and set
  `publishConfig.tag` to `beta` so a v5 publish cannot take the `latest` tag
  from the 4.x production line.
- `src/playground/**` is excluded from the emitted declarations. It is a
  docs-site page rather than public API, and its types referenced `codemirror`
  and `@codemirror/lint` — devDependencies a consumer cannot resolve.
- `scripts/clearCDNcaches.sh` purged `dist/protvista-uniprot.js`, a pre-Vite
  name no build emits, making the jsDelivr purge a no-op; it now purges the
  `.mjs` entry and its map. Note the lazy `dist/*.js` chunks carry no content
  hash and are still not purged.
- `yarn test:pack` runs `publint` and `attw` against the packed tarball, and
  CI runs it after the build. Nothing previously checked the exports map or
  the emitted declarations the way a consumer resolves them.

### Breaking — `label` is now a Markdoc string; `helpPage` and `labelUrl` removed

Group and track `label` is now a Markdoc **inline** source string rendered
through the same `@markdoc/markdoc` pipeline as `dataTooltip`. This collapses
the previous three-field label surface (`label` + `helpPage` + `labelUrl`) into
one: write Markdown, including a link if you want one. `{accession}` is
interpolated into the label before rendering (same substitution `labelUrl`
used). The allowed surface is inline only — emphasis, code, links, and a
registered `{% help %}` custom tag; block-level markup (headings, lists, code
fences, tables) is rejected with a console warning and degrades to inline text.

The `helpPage` and `labelUrl` fields have been **removed** from the schema
(`ConfigDefaults`, `GroupConfig`, `TrackConfig`).

**Migration.** Rewrite affected labels:

| Before                                                        | After                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `label: Signal peptide`<br>`helpPage: signal`                 | `label: '{% help slug="signal" %}Signal peptide{% /help %}'`                |
| `label: AlphaFold Confidence`<br>`labelUrl: https://x/{accession}` | `label: '[AlphaFold Confidence](https://x/{accession})'`               |

The `{% help slug="…" %}…{% /help %}` tag renders
`<span data-article-id="…">…</span>` — byte-identical to what `helpPage`
produced. External `http(s)` links in a label open in a new tab
(`target="_blank" rel="noopener noreferrer"`), matching the old `labelUrl`
anchor. `slug` is restricted to `^[a-zA-Z0-9_#-]+$`.

**uniprot.org embedders:** the in-page help popover keeps working **only if the
`{% help %}` tag stays registered** (it is, by default, in this package's label
renderer). The `data-article-id` DOM your help-article controller listens for is
unchanged. If you strip or fail to register the tag, help spans stop rendering
and the popovers break — that is the one visible DOM regression to watch for.

### Removed (breaking) — the top-level `groups:` config field is now `rows:`

The top-level entry list is `rows:`, and the deprecated `groups:` alias is
**removed** (no fold, no warning — a leftover `groups:` is now an unknown
property and fails validation). That array has held two kinds of entry
since standalone single-row tracks landed — a group (a collapsible
cluster, has `tracks:`) and a standalone track (one row on its own, has
`data:`) — so `groups:` named it dishonestly. Every top-level entry is one
vertical lane; a group is simply an expandable lane.

**Migration.** Rename the field. Nothing else about the entries changes:

```yaml
# Before                     # After
groups:                      rows:
  - id: DOMAINS                - id: DOMAINS
    tracks: [...]                tracks: [...]
```

**Not affected:** `tracks:` nested inside a group keeps its name — only
the top-level field is renamed. The post-load `NormalizedConfig` model
exposes `rows` / `NormalizedRow`, so the authoring field and the resolved
model agree.

### Added — no-code theming via the config `theme:` field

A new optional top-level `theme: { labelColor?, accentColor? }` recolours
the viewer chrome from the config — no CSS required. `labelColor` sets the
row-label side panel; `accentColor` sets focus rings and the datatable
active-row marker. Each maps to a `--protvista-*` design token the
component sets inline on the host at mount, so a config `theme` takes
precedence over the token defaults and ordinary page CSS (a host overrides
it only with `!important`). See `docs/theming.md`.

### Breaking — internal CSS classes and DOM ids are now hash-prefixed

`<protvista-uniprot>` renders in light DOM (required by Mol*), so its
stylesheet lives in the document's global selector scope. To make its
class names collision-proof against consumer and child-component styles,
every internal class name and wrapper/wiring DOM id now carries a
package-specific hash prefix, `pv-cecb45-` (derived from
`sha1('protvista-uniprot@' + <release version>)` — the base version, ignoring
any pre-release suffix, so it is stable across the 5.0.0 line — exposed as
`CSS_PREFIX` in
`src/styles/css-prefix.ts`). The rules remain tag-scoped under
`protvista-uniprot` as defence-in-depth.

**Migration.** If you override ProtVista's styling from your own
stylesheet, update the selectors:

| Before                             | After                                          |
| ---------------------------------- | ---------------------------------------------- |
| `.group`                           | `.pv-cecb45-group`                             |
| `.group-label`                     | `.pv-cecb45-group-label`                       |
| `.group__track`                    | `.pv-cecb45-group__track`                      |
| `.track-label`                     | `.pv-cecb45-track-label`                       |
| `.track-content`                   | `.pv-cecb45-track-content`                     |
| `.track-content__coloured-sequence`| `.pv-cecb45-track-content__coloured-sequence` |
| `.nav-container`                   | `.pv-cecb45-nav-container`                     |
| `.nav-track-label`                 | `.pv-cecb45-nav-track-label`                   |
| `.credits`                         | `.pv-cecb45-credits`                           |
| `.aggregate-track-content`         | `.pv-cecb45-aggregate-track-content`          |

Wrapper element ids (`group_<id>`, `track_<id>`) and the Nightingale
wiring ids (`track-<id>`) gained the same prefix (e.g.
`#pv-cecb45-group_DOMAINS`). The `<id>` portion — which comes from your
config — is unchanged.

**Not affected:**

- `.feature` is unchanged. The host never applies this class itself (it
  styles feature glyphs rendered by Nightingale child components), so
  prefixing it would simply stop it matching.
- The `.proforma` and `.mod-link` rules were **removed** — they were
  dead (their emitter, `src/tooltips/feature-tooltip.ts`, was deleted in
  the tooltip refactor).
- The `data-group-toggle` / `data-article-id` attributes, the
  `.protvista-tooltip` popover classes, and the loader/no-results
  classes are unchanged.

### Added — user-facing error surfaces

Errors no longer dead-end at `console.*` behind a silent blank render.
Three user-facing channels sit on top of the unchanged developer
`console.*` output (all routed through one shared reporter so the message
text stays in lockstep):

- **Mount-level error panel.** A config-validation failure or a
  sequence-fetch failure now renders a visible `role="alert"` panel
  (one-line summary and a collapsible per-issue list with `path` /
  `message` / `code`) instead of a blank element. Focus moves to the
  panel on appear. A fatal error (bad config / no sequence — nothing to
  reveal) offers no dismiss; a warning promoted under `strict` is
  dismissible, and dismissing restores focus and reveals the viewer.
  The top-level **sequence** fetch now applies the same broken-vs-missing
  distinction as per-track fetches: a **broken** fetch (`network` / HTTP
  `5xx` / unparseable) shows _"the UniProt data service is unreachable or
  failing…"_ with a **Retry** button that re-runs the mount in place,
  while a **missing** entry (HTTP `4xx`, or a `2xx` with no `sequence`)
  shows _"No UniProt entry found for 'X'. Check that the accession is
  correct."_ with no Retry. Previously every sequence failure — server
  down, offline, or a genuine typo — showed one identical "check the
  identifier" message with no way to retry. The `sequence` event now
  carries `context.errorKind` (+ `status`).
- **Per-track error badge.** The distinction is *broken* vs *missing*. A
  track whose data is **broken** shows a keyboard-focusable `⚠` badge
  (detail via `aria-describedby` and `title`). Failures are classified:
  `network` (unreachable — blocked, offline, DNS, CORS, timeout), `http`
  (a 4xx/5xx response), or `parse` (a 2xx body that failed to parse).
  "Broken" is `network`, `parse`, and HTTP `5xx` — a real transport or
  server problem the user should know about; these always surface, with
  no opt-in. Recoverable ones (`network`, HTTP `5xx`) also get a **Retry**
  button that re-fetches only that track; a `parse` failure is
  deterministic, so its badge carries no Retry. A track whose data is
  merely **missing** — an HTTP `4xx` such as a 404 "no data for this
  accession" — is treated exactly like an empty 2xx response: the track
  is hidden, with no badge, no `protvista-error` event, and no panel.
  There is no flag to surface 4xx; "missing" is deliberately invisible. A
  collapsed group whose tracks (all or some) are broken shows a summary
  badge on its header, so failures aren't hidden behind the collapse.
- **`protvista-error` event.** A bubbling `CustomEvent('protvista-error',
  { detail: { phase, issues, context } })` fires for every *broken* error
  (a 4xx "missing" fires nothing), so embedders route errors into their
  own UI with one listener. `phase` is one of `config` / `sequence` /
  `track-fetch` / `set-track-data` / `transform-calculate` /
  `tooltip-field-miss`; for `track-fetch`, `context.errorKind` carries
  the `network` / `http` / `parse` classification.

Also adds `strict?: boolean` (promote every warning to the mount panel;
default `false`) and a tree-shakeable, lazily-loaded `src/errors/format.ts`
issue formatter (its own ~0.3 kB gzip chunk — the happy path never loads
it). See the _Error events_ section in `specs/config-approach.md`.

Two fixes make the per-track error surfacing actually reach the screen:

- **Error-only groups are now revealed.** Groups render `display: none` by
  default and are shown imperatively only once they have data. A group
  whose data all failed to load (e.g. Variants when its API is blocked)
  therefore rendered its header + ⚠ badge into the DOM but stayed
  `display: none` — it looked like the group had vanished. `updated()`
  now also reveals any group with a visible fetch error.
- **The loader is resilient to a throwing adapter.** The per-track
  pipeline is isolated in `loadProtvistaData`, so an adapter that throws
  on an unexpected payload (e.g. the empty body a blocked/failed fetch
  leaves — the AlphaFold/AlphaMissense parsers are prone to this)
  degrades just that track to empty instead of rejecting the whole load.
  Previously one throwing adapter aborted the batch before the
  error-correlation pass, suppressing *all* badges and events. (Hardening
  those parsers at the source is tracked in
  `specs/alphafold-alphamissense-adapter-hardening.md`.)

### Fixed — `js-yaml` pinned to 4.x; install-time patch removed

A routine dependency refresh had bumped `js-yaml` to 5.2.1, a major that
replaced the package's named/default export shape and removed `Type`,
`DEFAULT_SCHEMA`, and several loader/dumper options. `astro`,
`@astrojs/starlight`, and `@astrojs/internal-helpers` all declare
`js-yaml ^4.1.1`, so the docs build broke on the missing `default`
export, and a `postinstall` step had been added to write one into the
installed package inside `node_modules`.

`js-yaml` is now pinned to **4.3.0**, which satisfies that same
`^4.1.1` range — the tree dedupes to a single copy and the patch is
gone, along with the `postinstall` hook and `scripts/patch-js-yaml.mjs`.
This also removes two hazards: writing into `node_modules` corrupts the
shared global store under package managers that hardlink from it (pnpm),
and because `scripts/` is not in `files`, publishing with a `postinstall`
would have failed every consumer's install on a missing file.

One behavioural change follows. A YAML document with no content — blank,
whitespace, or comments only — is handled differently by the two majors
(4.x returns `undefined`/`null`, 5.x throws). `parseConfigText` now pins
this itself and rejects with a `SyntaxError`, so the contract no longer
depends on which `js-yaml` is installed. A bare `---` still parses to
`null` and is rejected by validation, as before.

Also corrected: the parser was documented as pinning `SAFE_SCHEMA`, a
name that exists in no shipped `js-yaml`. It has always used
`CORE_SCHEMA` — the narrowest schema available, with no `!!js/*` tags —
which is what the docs and constraint C4 now say, and what a new test
asserts.
