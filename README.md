# ProtVista

A Web Component which uses [Nightingale](https://github.com/ebi-webcomponents/nightingale) components to display protein sequence information.

**Branching model and v5**

> - **`main` (this branch)** is the current-major **4.x** production line. Published on npm as `protvista-uniprot`; custom element `<protvista-uniprot>`. Receives non-breaking changes (security, performance, dependencies, CI). Use this for production.
> - **[`next`](../../tree/next)** is the **v5** development line. It carries any breaking changes that come out of the [SSI RSMF](ROADMAP.md) work: a configuration-driven loader, a published JSON-Schema for viewer configurations, a declarative tooltip resolver.`v5` will rename the package and element to `protvista`. GitHub has already been renamed and the old URL auto-redirects, and `protvista-uniprot` will remain on npm as a deprecated alias once v5 ships. **Schemas and APIs on `next` are still evolving — do not depend on them in production yet.** Targeted production release: early 2027.

![Image of ProtVista](protvista.png)

## Roadmap & Future Plans

Check out our **[3-Year Roadmap & Sustainability Plan (DRAFT)](ROADMAP.md)** to see our upcoming improvements, including moving towards a configuration-driven architecture, and how you can get involved!

## Monthly Office Hours

Have questions about using or contributing to ProtVista?

We host regular virtual office hours to help with setup, integration, and contributions. Everyone is welcome — no registration required.

See dates and joining details here: [Office Hours](./CONTRIBUTING.md#office-hours)

## Contributing & Security

We welcome contributions!

- Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, pull request guidelines, and office hours.
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
import ProtvistaUniprot from 'protvista-uniprot';

window.customElements.define('protvista-uniprot', ProtvistaUniprot);
```

You can then use it like this:

```html
<protvista-uniprot accession="P05067"></protvista-uniprot>
```

## API

- `accession`: `string`
- `config?`: `Array` (see [Configuration](#configuration))
- `nostructure?`: `boolean` (default: `false`)

## Development

Run:

```bash
yarn install
yarn start
```

to install dependencies and start the local development server.

## Testing

Tests run under [Vitest](https://vitest.dev/) with a `jsdom` DOM environment. All APIs (`describe`, `it`, `expect`, `vi`, …) must be imported explicitly from `'vitest'` — `globals` is off.

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

Every push and pull request runs the same three steps as `yarn test` via [`.github/workflows/test-and-deploy.yml`](./.github/workflows/test-and-deploy.yml): `yarn test:lint`, `yarn test:types`, and `yarn test:unit`, under Node 24 on `ubuntu-latest`. A separate `build` job runs `yarn build` (and, on `main`, `yarn build:demo`) and deploys the demo to GitHub Pages. Coverage is not collected in CI today — run `yarn test:coverage` locally when you need a coverage signal.

### Coverage

Captured 2026-04-20 via `yarn test:coverage` (v8 instrumentation, 29 tests across 3 spec files):

| Metric     | Coverage |
| ---------- | -------- |
| Statements | 10.33%   |
| Branches   | 5.99%    |
| Functions  | 13.19%   |
| Lines      | 9.66%    |

## Performance benchmarks

A `bench/` workflow captures repeatable performance baselines for the demo across three layers: library bundle size, Lighthouse CI against a fixed set of UniProt scenarios, and DOM-observed custom milestones (`fetch-and-parse`, `render`, `total`). Run `yarn bench` to produce `bench/results/summary.md`. Reference snapshots live under `bench/baselines/` and are committed; per-run output is gitignored.

See [`bench/README.md`](./bench/README.md) for scenarios, capture procedure, and methodology notes.

## Configuration

You can pass your own configuration to the component using the `config` attribute/property.

```json
{
  "categories": [
    {
      "name": "string",
      "label": "string",
      "trackType": "nightingale-track-canvas|nightingale-linegraph-track|nightingale-variation-canvas,
      "adapter": "feature-adapter|structure-adapter|proteomics-adapter|variation-adapter",
      "url": "string",
      "tracks": [
        {
          "name": "string",
          "label": "string",
          "filter": "string",
          "trackType": "nightingale-track-canvas|nightingale-linegraph-track|nightingale-variation-canvas,
          "tooltip": "string"
        }
      ]
    }
  ]
}
```

## Events

A custom `protvista-event` is emitted:

- When at least one of the tracks returns data

Example event detail:

```js
detail: {
  hasData: true;
}
```

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
