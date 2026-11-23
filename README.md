# ProtVista

A Web Component which uses [Nightingale](https://github.com/ebi-webcomponents/nightingale) components to display protein sequence information.

> **v5 is the stable release.** **`5.0.0`** is on npm `latest`: install it with `npm install protvista-uniprot`, or load it from `https://cdn.jsdelivr.net/npm/protvista-uniprot@5.0.0/dist/protvista-uniprot.mjs`. v5 is a breaking change from 4.x; see [CHANGELOG.md](./CHANGELOG.md) before upgrading. The 4.x line stays on npm as **`protvista-uniprot@4`** and on the [`main`](https://github.com/ebi-webcomponents/protvista/tree/main) branch for critical fixes.

**Branching model and v5**

> - **[`next`](https://github.com/ebi-webcomponents/protvista/tree/next)** is the **v5** development line, and the branch this README describes. It is where all v5 work happens, **including the hackathon**: branch from `next` and open pull requests against `next`. It carries the breaking changes that came out of the [SSI RSMF](ROADMAP.md) work: a configuration-driven loader, a published JSON-Schema for viewer configurations, a declarative tooltip resolver. v5 keeps the `protvista-uniprot` package name and the `<protvista-uniprot>` element; a rename to the generic `protvista` remains under consideration for a later cycle, not this one. (The GitHub repository has already been renamed to `protvista` and the old URL auto-redirects — that is the repo only, not the npm package.) v5 follows semver from 5.0.0: breaking changes to the config schema or the element's API wait for a major version.
> - **[`main`](https://github.com/ebi-webcomponents/protvista/tree/main)** is the repository's default branch and the previous-major **4.x** line. It receives critical fixes only (security, dependencies) and publishes them under the npm `legacy-v4` dist-tag, never `latest`. Contribute to it only for a 4.x fix.
>
> This README and the [documentation site](https://ebi-webcomponents.github.io/protvista/) describe `next` as it is today, which can be ahead of the latest release on npm. The `## Unreleased` section of [CHANGELOG.md](./CHANGELOG.md) lists what hasn't shipped yet.

## ProtVista hackathon, 7–9 October 2026

Taking part? Start with **[Contributing via a fork](./CONTRIBUTING.md#contributing-via-a-fork)** and the **[hackathon notes](./CONTRIBUTING.md#hackathon-participants)** in CONTRIBUTING.md. In short: fork with *Copy the `main` branch only* **unticked**, work on a branch made from `next`, and open your pull request against `next`. Want to bring your own data without writing code? Use the **[Starter Kit](https://github.com/ebi-webcomponents/protvista-starter-kit)** or the **[playground](https://ebi-webcomponents.github.io/protvista/playground/)**.

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

- protvista-uniprot v5 ([`next`](https://github.com/ebi-webcomponents/protvista/tree/next)) is compatible with [nightingale](https://github.com/ebi-webcomponents/nightingale) v5.11 and later
- protvista-uniprot v4 ([`main`](https://github.com/ebi-webcomponents/protvista/tree/main)) is compatible with [nightingale v5](https://github.com/ebi-webcomponents/nightingale)
- [protvista-uniprot v3](https://github.com/ebi-webcomponents/protvista/tree/v3.0.9) is compatible with [nightingale v5](https://github.com/ebi-webcomponents/nightingale)
- [protvista-uniprot v2](https://github.com/ebi-webcomponents/protvista/tree/v2.5.5) is compatible with [nightingale v3](https://github.com/ebi-webcomponents/nightingale/tree/v3)

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

Import these from `protvista-uniprot/config`, not the package root. The root self-registers `<protvista-uniprot>` on load, so importing anything from it makes a bundler keep the whole viewer (Lit, the Nightingale tracks, Mol\*). The `./config` subpath reaches none of that, so a consumer that only needs the filter data can tree-shake the element away.

Two more subpaths load less than the root:

- `protvista-uniprot/structure` — defines `<protvista-uniprot-structure>` alone, without the track viewer.
- `protvista-uniprot/react` — types only: JSX declarations for both elements, with attribute spellings (`import type {} from 'protvista-uniprot/react'`).

## API

Reactive properties on the `<protvista-uniprot>` element (HTML attribute name in brackets where it differs from the JS property name):

- `accession` [`accession`]: `string` — UniProt accession to display. Takes precedence over the `accession` field in `config` if both are set. Leave it off for a config that sets `sequence:` ([Proteins outside UniProt](https://ebi-webcomponents.github.io/protvista/sequence-only)); the two together are an error (`accession-and-sequence`).
- `configSrc` [`config-src`]: `string` — URL or file path to a YAML or JSON config. Fetched and parsed at mount time. See [Configuration](#configuration).
- `viewerConfig`: `ProtvistaViewerConfig` — a parsed config object (or a YAML/JSON string), assigned as a JS property (no matching HTML attribute). Alternative to `config-src` when the embedder already has the config in memory.
- `nostructure` [`nostructure`]: `boolean` (default `false`) — suppresses the PDBe 3D structure group.
- `notooltip` [`notooltip`]: `boolean` (default `false`) — suppresses the built-in click tooltip. Typically set by embedders rendering their own overlay. See [React host integration](https://ebi-webcomponents.github.io/protvista/react-integration) for the consumer-side pattern.
- `suspend` [`suspend`]: `boolean` (default `false`) — holds off loading and rendering until cleared. Useful when the accession is about to change and you want to avoid a flash of intermediate state.
- `adapters`: `Record<string, AdapterFunction>` — adapters to register by name, assigned as a JS property (no HTML attribute); the declarative form of `registerAdapter()`. May be set before the element is defined; applied before loading starts.
- `noPersistLayout` [`no-persist-layout`]: `boolean` (default `false`) — opts out of layout persistence (a user's reorder/show-hide is neither restored on mount nor saved to localStorage or the `?layout=` URL). See [Customize the layout](https://ebi-webcomponents.github.io/protvista/customize-layout).
- `quietNotices` [`quiet-notices`]: `boolean` (default `false`) — turns off the visitor notices, the quiet ⓘ that tells a visitor when the view is incomplete or misleading. The `protvista-error` event is unaffected. See [What visitors and authors see](https://ebi-webcomponents.github.io/protvista/troubleshooting#what-visitors-and-authors-see).
- `showWarnings` [`show-warnings`]: `boolean` (default `false`) — author mode: lists every warning on its track or the viewer, with the console's text, and expands error badges and the error panel into their full detail. Equivalent to `showWarnings: true` in the config; either turns it on.

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

You need Node 24 and pnpm; [CONTRIBUTING.md](./CONTRIBUTING.md#prerequisites) covers installing both, on Windows too. Then run:

```bash
pnpm install
pnpm exec playwright install chromium
pnpm start
```

to install dependencies, fetch the headless Chromium that the browser tests run
in (once, and again after any `playwright` version bump; see
[Testing](#testing)), and start the Astro dev server (`pnpm start` =
`pnpm docs:dev`). It serves the docs **and** the native playground page at
<http://localhost:4321/protvista/> and <http://localhost:4321/protvista/playground/>.
To preview the whole site (docs + playground + bench) exactly as GitHub Pages
serves it, run `pnpm site:build`, then `pnpm site:preview`.

## Testing

Tests run under [Vitest](https://vitest.dev/), split into two projects: `unit` (a `jsdom` DOM environment) and `browser` (real headless Chromium via [Playwright](https://playwright.dev/)). All APIs (`describe`, `it`, `expect`, `vi`, …) must be imported explicitly from `'vitest'` — `globals` is off.

The `browser` project needs the Playwright Chromium binary, which `pnpm install` does not download. Run `pnpm exec playwright install chromium` once after cloning, and again whenever the `playwright` version in `package.json` changes — otherwise `pnpm test:browser` fails at startup with `browserType.launch: Executable doesn't exist at …`. See [CONTRIBUTING.md](./CONTRIBUTING.md#browser-tests-need-a-playwright-browser) for details.

A small setup file at `src/__spec__/setup.ts` filters out jsdom's benign "Could not parse CSS stylesheet" warnings; jsdom's CSS parser is CSS2-era and chokes on the nested-selector syntax used in `src/styles/protvista-styles.ts`. The stylesheet still attaches correctly — it's log noise only. Every other `console.error` passes through untouched. Remove the filter if we ever migrate to happy-dom (which parses modern CSS natively) or jsdom gains native-nesting support.

| Command | What it runs |
| --- | --- |
| `pnpm test` | The full pipeline: lint + types + unit + browser |
| `pnpm test:unit` | Unit tests only (jsdom; no Playwright browser needed). The quickest check that your setup works. |
| `pnpm test:browser` | Browser component tests only (needs the Playwright browser, see above) |
| `pnpm test:watch` | Watch mode |
| `pnpm test:coverage` | Both projects, with coverage written to `./coverage/` (text + html + lcov). This is the gate CI enforces. |

Coverage output is for local use only and is not committed. Open `coverage/index.html` after `pnpm test:coverage` to inspect.

### Continuous integration

Every push and pull request runs [`.github/workflows/test-and-deploy.yml`](./.github/workflows/test-and-deploy.yml) under Node 24:

- **Test** (`ubuntu-latest`): `pnpm test:lint`, `pnpm test:types`, `pnpm test:unit`, and — after `pnpm exec playwright install --with-deps chromium chromium-headless-shell` — `pnpm test:coverage`. The coverage step runs both the unit and browser suites and enforces the coverage floor (see below), so a PR that drops coverage below the floor fails CI.
- **Test (Windows)** (`windows-latest`): `pnpm test:lint`, `pnpm test:types` and `pnpm test:unit`, so a change that breaks contributors on Windows shows up in the PR.
- **Build**: `pnpm test:pack` (build + publint + attw) and the packaging-contract spec against `dist/`. On a push to `next` it also runs `pnpm site:build` (the Astro + Starlight docs, including the playground page, plus the bench page, into `site/`) and deploys that to GitHub Pages.

Pull requests from forks: GitHub holds a first-time contributor's workflow runs until a maintainer approves them, so your PR's checks may show *Approval required* for a while. Run `pnpm test:unit` (and, if you can, `pnpm test:coverage`) locally first.

### Coverage

Coverage is gated by a fixed floor (a coverage ratchet) configured under `test.coverage.thresholds` in [`vite.config.mjs`](./vite.config.mjs) and enforced by the CI coverage step. The floor is bumped up manually as coverage improves and is never lowered without justification.

The current floor (v8 instrumentation):

| Metric     | Floor |
| ---------- | ----- |
| Statements | 80    |
| Branches   | 74    |
| Functions  | 78    |
| Lines      | 81    |

Run `pnpm test:coverage` for today's figures; when your change raises them, bump the floor in the same PR (see [CONTRIBUTING.md](./CONTRIBUTING.md#writing-tests)).

## Performance benchmarks

A `bench/` workflow captures repeatable performance baselines for the demo across three layers: library bundle size, Lighthouse CI against a fixed set of UniProt scenarios, and DOM-observed custom milestones (`fetch-and-parse`, `render`, `total`). Run `pnpm bench` to produce `bench/results/summary.md`. Reference snapshots live under `bench/baselines/` and are committed; per-run output is gitignored.

See [`bench/README.md`](./bench/README.md) for scenarios, capture procedure, and methodology notes.

## Configuration

The viewer is driven by a declarative configuration — a document that lists the rows to display, the tracks within each row, and where their data comes from. Authors write against a schema of high-level domain concepts (`kind: features`, `kind: variants`, `kind: alphafold-confidence`, …) and never need to name Nightingale components or adapters directly. Two authoring forms are supported:

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

### Variables

Any `{token}` in a data URL is filled in at fetch time — not just `{accession}`. Values come from three places, and later ones override earlier ones:

1. a top-level `variables:` block in the config — baseline defaults shared by every page that mounts it;
2. `data-*` attributes on the element — per-page values;
3. the `accession` attribute (or the config's `accession:`), which always supplies `{accession}`. A `data-accession` attribute has no effect on the element.

```yaml
variables:
  species: human # default when the page sets no data-species
sources:
  features: https://api.example.org/{species}/features/{accession}
```

```html
<protvista-uniprot
  accession="P05067"
  data-species="mouse"
  config-src="./my-config.yaml"
></protvista-uniprot>
```

This fetches `https://api.example.org/mouse/features/P05067`. Changing `data-species` on the live element reloads the data. Multi-word attributes are camelCased, as `element.dataset` reports them: `data-dataset-id` fills `{datasetId}`. Values are URL-encoded. A value of exactly `.` or `..`, or one containing malformed Unicode, is refused: its URL is not fetched, and a console warning names the token. A token that nothing defines is a `missing-variable` validation warning, and its URL is not fetched.

### Learning more

- **Tutorial.** The guided [end-to-end tutorial](https://ebi-webcomponents.github.io/protvista/tutorial) — add the component, point it at an accession, add your own track from a CSV, `extends` the default viewer, and theme it. The best starting point for newcomers.
- **User guide.** The task-oriented [ProtVista user guide](https://ebi-webcomponents.github.io/protvista/) — embedding the viewer, authoring a config, built-in track kinds, loading your own data (CSV/TSV/JSON/BED), troubleshooting, and escape hatches. Rendered from [`docs/`](./docs).
- **Configuration vs data.** [Configuration vs data](https://ebi-webcomponents.github.io/protvista/configuration-vs-data) explains the boundary between what your config controls and what a data provider must supply — the Intent/Representation split, with a diagram and a paired example.
- **Schema reference.** [`specs/config-approach.md`](./specs/config-approach.md) documents every field (`rows`, `tracks`, `sources`, `defaults`, `extends`, `kind`, `data`, `rendering`, `dataTooltip`) with worked examples and edge-case semantics. This is the normative source.
- **Canonical default.** [`src/default-config.yaml`](./src/default-config.yaml) is the UniProt viewer itself, authored in the new schema. Useful as a reference.
- **Worked examples.** [`examples/`](./examples) is the canonical, CI-validated set of runnable example configs — one per generic-format adapter (CSV/TSV/JSON/BED), inline data, a minimal URL-sourced config, a no-network `sequence-only/` config, and an `extends:`-based config that layers a custom track on the shipped default. See [`examples/README.md`](./examples/README.md).
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
  order: ['VARIATION', 'DOMAINS', 'MOLECULE_PROCESSING'],
  // per-row track order, keyed by row id (rows left as authored are omitted)
  tracks: { DOMAINS: ['domain', 'region'] },
  // show/hide overrides — whole rows, and tracks within a row
  hidden: { rows: { MOLECULE_PROCESSING: true }, tracks: {} }
}
```

See [Customize the layout](https://ebi-webcomponents.github.io/protvista/customize-layout) for the full layout API and persistence model.

## Publishing

Maintainers only: see [RELEASING.md](./RELEASING.md). On `next`, `pnpm release:next` cuts the next v5 release.

## Citation

If you use ProtVista in your research, please cite:

> Watkins X, Garcia LJ, Pundir S, Martin MJ, UniProt Consortium. ProtVista: visualization of protein sequence annotations. *Bioinformatics*. 2017;33(13):2040–2041. doi:[10.1093/bioinformatics/btx120](https://doi.org/10.1093/bioinformatics/btx120)

GitHub's **Cite this repository** button (from [`CITATION.cff`](./CITATION.cff)) gives the same reference in BibTeX and APA.

## Licensing

ProtVista source code is licensed under the MIT License (see `LICENSE`).

Documentation and other written materials in this repository are licensed
under the Creative Commons Attribution 4.0 International (CC BY 4.0),
unless otherwise stated (see `LICENSE-docs`).

## Funding

This work was supported by the Research Software Maintenance Fund, managed by the Software Sustainability Institute and funded by UKRI grant reference AH/Z000114/1.
