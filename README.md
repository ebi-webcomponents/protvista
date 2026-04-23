# ProtVista

A Web Component which uses [Nightingale](https://github.com/ebi-webcomponents/nightingale) components to display protein sequence information.

![Image of protvista-uniprot](protvista.png)

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

Every push and pull request runs the same three steps as `yarn test` via [`.github/workflows/test-and-deploy.yml`](./.github/workflows/test-and-deploy.yml): `yarn test:lint`, `yarn test:types`, and `yarn test:unit`, under Node 24 on `ubuntu-latest`. A separate `build` job runs `yarn build` (and, on `main`, `yarn build:demo`) and deploys the demo to GitHub Pages. Coverage is not collected in CI today — run `yarn test:coverage` locally when you need a coverage signal.

### Coverage

Captured 2026-04-20 via `yarn test:coverage` (v8 instrumentation, 29 tests across 3 spec files):

| Metric     | Coverage % |
| ---------- | ---------- |
| Statements | 71.41      |
| Branches   | 70.77      |
| Functions  | 68.63      |
| Lines      | 71.78      |

## Configuration

You can pass your own configuration to the component using the `config` attribute/property.

```json
{
  "groups": [
    {
      "name": "string",
      "label": "string",
      "trackType": "nightingale-track-canvas|nightingale-linegraph-track|nightingale-variation",
      "adapter": "feature-adapter|structure-adapter|proteomics-adapter|variation-adapter",
      "url": "string",
      "tracks": [
        {
          "name": "string",
          "label": "string",
          "filter": "string",
          "trackType": "nightingale-track-canvas|nightingale-linegraph-track|nightingale-variation",
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
