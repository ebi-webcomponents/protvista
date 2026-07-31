# ProtVista

A Web Component which uses [Nightingale](https://github.com/ebi-webcomponents/nightingale) components to display protein sequence information.

> ⚠️ **v5 is a beta pre-release.** The current stable release is **`protvista-uniprot@4.9.x`** (npm `latest`) — use that in production. **`5.0.0-beta.1`** ships under the **`beta`** dist-tag for early testing: once released, install it with `npm install protvista-uniprot@beta`. Its schemas and APIs are still evolving; don't depend on them in production yet. Targeted stable release: early 2027.

**Branching model and v5**

> - **`main` (this branch)** is the current-major **4.x** production line. Published on npm as `protvista-uniprot`; custom element `<protvista-uniprot>`. Receives non-breaking changes (security, performance, dependencies, CI). Use this for production.
> - **[`next`](../../tree/next)** is the **v5** development line. It carries any breaking changes that come out of the [SSI RSMF](ROADMAP.md) work: a configuration-driven loader, a published JSON-Schema for viewer configurations, a declarative tooltip resolver. v5 keeps the `protvista-uniprot` package name and the `<protvista-uniprot>` element; a rename to the generic `protvista` remains under consideration for a later cycle, not this one. (The GitHub repository has already been renamed to `protvista` and the old URL auto-redirects — that is the repo only, not the npm package.) **Schemas and APIs on `next` are still evolving — do not depend on them in production yet.** Targeted production release: early 2027.

![ProtVista showing the full default UniProt view of P05067: rows of domains, sites, modifications, variants and structure coverage drawn along the protein sequence.](protvista.png)

## Roadmap & Future Plans

Check out our **[3-Year Roadmap & Sustainability Plan (DRAFT)](ROADMAP.md)** to see our upcoming improvements, including moving towards a configuration-driven architecture, and how you can get involved!

## Monthly Office Hours

Have questions about using or contributing to ProtVista?

We host regular virtual office hours to help with setup, integration, and contributions. Everyone is welcome — no registration required.

See dates and joining details here: [Office Hours](./CONTRIBUTING.md#office-hours)

## Contributing & Security

We welcome contributions!

- Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, an overview of the config-driven architecture (registry and config pipeline), pull request guidelines, and office hours.
- Community standards: [Code of Conduct](./CODE_OF_CONDUCT.md)
- Security issues: please report privately via [SECURITY.md](./SECURITY.md)

## Compatibility

- [protvista-uniprot v3](https://github.com/ebi-webcomponents/protvista-uniprot) is compatible with [nightingale v5](https://github.com/ebi-webcomponents/nightingale)
- [protvista-uniprot v2](https://github.com/ebi-webcomponents/protvista-uniprot/tree/v2) is compatible with [nightingale v3](https://github.com/ebi-webcomponents/nightingale/tree/v3)

## Browser Support

This component requires a modern browser with support for [ES2021](https://caniuse.com/?search=ES2021) and [Web Components (Custom Elements v1)](https://caniuse.com/custom-elementsv1).

| Browser | Minimum version |
| ------- | --------------- |
| Chrome  | 92+             |
| Edge    | 92+             |
| Firefox | 90+             |
| Safari  | 15+             |

Older browsers are not supported.

## Usage

### Use within an HTML file

Create an [ES module](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) import within a static HTML file:

```html
<script type="module" src="./protvista-uniprot.mjs"></script>
```

Then display the component:

```html
<protvista-uniprot accession="P05067"></protvista-uniprot>
```

### Importing as a module

```js
// The element self-registers as <protvista-uniprot> on import.
import 'protvista-uniprot';
```

You can then use it like this:

```html
<protvista-uniprot accession="P05067"></protvista-uniprot>
```

### Importing the variant config without the element

The variant filter and colour config are available from a side-effect-free `protvista-uniprot/config` subpath:

```js
import { filterConfig, colorConfig } from 'protvista-uniprot/config';
```

Import these from `protvista-uniprot/config`, not the package root. The root self-registers `<protvista-uniprot>` on load, so importing anything from it makes a bundler keep the whole viewer (Lit, the Nightingale tracks, Mol*). The `./config` subpath reaches none of that, so a consumer that only needs the filter data can tree-shake the element away.

## API

Reactive properties on the `<protvista-uniprot>` element (HTML attribute name in brackets where it differs from the JS property name):

- `accession` [`accession`]: `string` — UniProt accession to display. Takes precedence over the `accession` field in `config` if both are set.
- `configSrc` [`config-src`]: `string` — URL or file path to a YAML or JSON config. Fetched and parsed at mount time. See [Configuration](#configuration).
- `viewerConfig`: `ProtvistaViewerConfig` — a parsed config object (or a YAML/JSON string), assigned as a JS property (no matching HTML attribute). Alternative to `config-src` when the embedder already has the config in memory.
- `nostructure` [`nostructure`]: `boolean` (default `false`) — suppresses the PDBe 3D structure group.
- `notooltip` [`notooltip`]: `boolean` (default `false`) — suppresses the built-in click tooltip. Typically set by embedders rendering their own overlay. See [React host integration](https://ebi-webcomponents.github.io/protvista/react-integration) for the consumer-side pattern.
- `suspend` [`suspend`]: `boolean` (default `false`) — pauses rendering. Useful when the accession is about to change and you want to avoid a flash of intermediate state.
- `noPersistLayout` [`no-persist-layout`]: `boolean` (default `false`) — opts out of layout persistence (a user's reorder/show-hide is neither restored on mount nor saved to localStorage or the `?layout=` URL). See [Customize the layout](https://ebi-webcomponents.github.io/protvista/customize-layout).

### Layout (Customize layout)

End users can reorder rows (with move-up/down buttons), reorder tracks within a group, and show/hide either, using controls that appear on the rows themselves in **Customize** mode; the same layout can be driven programmatically. A layout edit rewrites the viewer's config, so `getConfig()` exports exactly what the user arranged. Each method emits a `protvista-layout-change` event (see [Events](#events)).

- `setRowOrder(order: string[])`: reorder the rows by id.
- `setTrackOrder(rowId: string, order: string[])`: reorder the tracks within one row. Movement is two-level — a track cannot leave its group, because a nested config has no way to record where it went.
- `setRowVisibility(rowId: string, visible: boolean)`: show/hide a whole lane (group or standalone track).
- `setTrackVisibility(groupId: string, trackId: string, visible: boolean)`: show/hide one track within a group.
- `resetLayout()`: restore the authored config (drop every reorder + show/hide).
- `getConfig(): ProtvistaViewerConfig | undefined`: the arranged view as an authored config — save it, share it, or hand it back to `setConfig()`.
- `getLayout(): { order: string[] | null; tracks: Record<string, string[]>; hidden: { rows: Record<string, boolean>; tracks: Record<string, Record<string, boolean>> } }`: the compact diff from the authored config, which is what persistence stores.

A layout persists per-config in localStorage and in a shareable `?layout=` URL parameter. See [Customize the layout](https://ebi-webcomponents.github.io/protvista/customize-layout) for the controls, the `hidden` field, accessibility, and persistence.

## Development

Run:

```bash
yarn install
yarn start
```

to install dependencies and start the Astro dev server (`yarn start` =
`yarn docs:dev`) — it serves the docs **and** the native playground page (the
docs are the site home). Use `yarn site:build && yarn site:preview` to preview
the whole site (docs + playground + bench) exactly as GitHub Pages serves it.

## Testing

Tests run under [Vitest](https://vitest.dev/) with a `jsdom` DOM environment. All APIs (`describe`, `it`, `expect`, `vi`, …) must be imported explicitly from `'vitest'` — `globals` is off.

A small setup file at `src/__spec__/setup.ts` filters out jsdom's benign "Could not parse CSS stylesheet" warnings; jsdom's CSS parser is CSS2-era and chokes on the nested-selector syntax used in `src/protvista-styles.ts`. The stylesheet still attaches correctly — it's log noise only. Every other `console.error` passes through untouched. Remove the filter if we ever migrate to happy-dom (which parses modern CSS natively) or jsdom gains native-nesting support.

```bash
# Run the full pipeline (lint + types + unit)
yarn test

# Unit tests only (CI-friendly, non-zero exit on failure)
yarn test:unit

# Watch mode
yarn test:watch

# Coverage (writes text + html + lcov to ./coverage/)
yarn test:coverage
```

Coverage output is for local use only and is not committed. Open `coverage/index.html` after `yarn test:coverage` to inspect.

### Continuous integration

Every push and pull request runs three steps via [`.github/workflows/test-and-deploy.yml`](./.github/workflows/test-and-deploy.yml): `yarn test:lint`, `yarn test:types`, and `yarn test:coverage`, under Node 24 on `ubuntu-latest`. The coverage step runs the full unit suite and enforces the coverage floor (see below), so a PR that drops coverage below the floor fails CI. A separate `build` job runs `yarn build` (and, on `next`, `yarn site:build`, which builds the Astro + Starlight docs — including the playground page — plus the bench page into `site/`) and deploys that to GitHub Pages.

### Coverage

Coverage is gated by a fixed floor (a coverage ratchet) configured under `test.coverage.thresholds` in [`vite.config.mjs`](./vite.config.mjs) and enforced by the CI coverage step. The floor is bumped up manually as coverage improves and is never lowered without justification.

Captured 2026-07-24 via `yarn test:coverage` (v8 instrumentation, 727 tests across 53 spec files):

| Metric     | Coverage % | Floor |
| ---------- | ---------- | ----- |
| Statements | 82.45      | 80    |
| Branches   | 75.60      | 74    |
| Functions  | 80.24      | 78    |
| Lines      | 83.91      | 81    |

## Performance benchmarks

A `bench/` workflow captures repeatable performance baselines for the demo across three layers: library bundle size, Lighthouse CI against a fixed set of UniProt scenarios, and DOM-observed custom milestones (`fetch-and-parse`, `render`, `total`). Run `yarn bench` to produce `bench/results/summary.md`. Reference snapshots live under `bench/baselines/` and are committed; per-run output is gitignored.

See [`bench/README.md`](./bench/README.md) for scenarios, capture procedure, and methodology notes.

## Configuration

The viewer is driven by a declarative configuration — a document that lists the rows to display, the tracks within each row, and where their data comes from. Authors write against a schema of high-level domain concepts (`kind: features`, `kind: variants`, `kind: confidence-score`, …) and never need to name Nightingale components or adapters directly. Two authoring forms are supported:

- **YAML** (recommended) — passed via the `config-src` attribute pointing at a URL or file path.
- **JSON** — assigned to the `viewerConfig` property on the element.

### Minimal config

```yaml
# my-config.yaml
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

Mount with:

```html
<protvista-uniprot config-src="./my-config.yaml"></protvista-uniprot>
```

The viewer renders a single collapsible group "Domains" (label title-cased from the id), containing one track "Domain", populated by the `features` URL (with `{accession}` substituted at fetch time) and filtered to items with `type === "DOMAIN"`. No `version`, no explicit `component:` / `adapter:`, no `label:` — minimal configs collapse to the minimum.

### Learning more

- **Tutorial.** The guided [end-to-end tutorial](https://ebi-webcomponents.github.io/protvista/tutorial) — add the component, point it at an accession, add your own track from a CSV, `extends` the default viewer, and theme it. The best starting point for newcomers.
- **User guide.** The task-oriented [ProtVista user guide](https://ebi-webcomponents.github.io/protvista/) — embedding the viewer, authoring a config, built-in track kinds, loading your own data (CSV/TSV/JSON/BED), troubleshooting, and escape hatches. Rendered from [`docs/`](./docs).
- **Configuration vs data.** [Configuration vs data](https://ebi-webcomponents.github.io/protvista/configuration-vs-data) explains the boundary between what your config controls and what a data provider must supply — the Intent/Representation split, with a diagram and a paired example.
- **Schema reference.** [`specs/config-approach.md`](./specs/config-approach.md) documents every field (`rows`, `tracks`, `sources`, `defaults`, `extends`, `kind`, `data`, `rendering`, `dataTooltip`) with worked examples and edge-case semantics. This is the normative source.
- **Canonical default.** [`src/default-config.yaml`](./src/default-config.yaml) is the UniProt viewer itself, authored in the new schema. Useful as a reference.
- **Worked examples.** [`examples/`](./examples) is the canonical, CI-validated set of runnable example configs — one per generic-format adapter (CSV/TSV/JSON/BED), inline data, a minimal URL-sourced config, and an `extends:`-based config that layers a custom track on the shipped default. See [`examples/README.md`](./examples/README.md).
- **Adapter reference.** [Adapter reference](https://ebi-webcomponents.github.io/protvista/adapter-reference) lists the expected payload shape and fields for every built-in kind and adapter, generated from the adapter code and drift-tested. A machine-readable schema for the bring-your-own feature record is served at [`feature-record.schema.json`](./public/schema/v1/feature-record.schema.json).
- **Authoring `dataTooltip`.** [Author tooltips](https://ebi-webcomponents.github.io/protvista/data-tooltip) covers the three authoring forms (bare string, `kind: fields`, `kind: markdown`) with examples.
- **React host integration.** [Rich tooltips in React](https://ebi-webcomponents.github.io/protvista/react-integration) shows how a React host owns its own rich tooltips via the `change` event + `notooltip`, with a minimal worked example. The normative contract is [`specs/config-approach.md`](./specs/config-approach.md#react-host-integration).
- **Customize the layout.** [Customize the layout](https://ebi-webcomponents.github.io/protvista/customize-layout) covers the end-user "Customize layout" controls (reorder + show/hide), the authored `hidden: true` default for shipping a group/track hidden on first mount, the runtime layout API, and per-config persistence + the shareable `?layout=` URL.

## Events

A custom `protvista-event` is emitted:

- When at least one of the tracks returns data

Example event detail:

```js
detail: {
  hasData: true;
}
```

A `protvista-layout-change` event is emitted whenever the user (or the
runtime API) reorders or shows/hides a track. Its `detail` is the current
layout overlay, the same shape `getLayout()` returns:

```js
detail: {
  // row ids in the user's order, or null for the authored order
  order: ['VARIATION', 'DOMAINS_AND_SITES', 'MOLECULE_PROCESSING'],
  // per-row track order, keyed by row id (rows left as authored are omitted)
  tracks: { DOMAINS_AND_SITES: ['domain', 'region'] },
  // show/hide overrides — whole rows, and tracks within a row
  hidden: { rows: { MOLECULE_PROCESSING: true }, tracks: {} }
}
```

See [Customize the layout](https://ebi-webcomponents.github.io/protvista/customize-layout) for the full layout API and persistence model.

## Publishing

```bash
npm login
rm -rf node_modules dist
yarn
yarn build
yarn publish
git push
```

## Licensing

ProtVista source code is licensed under the MIT License (see `LICENSE`).

Documentation and other written materials in this repository are licensed
under the Creative Commons Attribution 4.0 International (CC BY 4.0),
unless otherwise stated (see `LICENSE-docs`).

## Funding

This work was supported by the Research Software Maintenance Fund, managed by the Software Sustainability Institute and funded by UKRI grant reference AH/Z000114/1.
