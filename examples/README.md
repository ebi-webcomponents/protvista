# ProtVista example configs

This directory is the canonical, CI-validated set of example ProtVista
viewer configurations. Every subdirectory here is a self-contained
example — its own `config.yaml` plus any sample data it needs — and is
automatically schema-validated and smoke-rendered on every push and
pull request by [`src/__spec__/examples.spec.ts`](../src/__spec__/examples.spec.ts)
(run via `yarn test:unit`, wired into
[`.github/workflows/test-and-deploy.yml`](../.github/workflows/test-and-deploy.yml)).
Adding a new `examples/<name>/config.yaml` directory picks it up
automatically — no separate list to update.

This is meant to become the single source of truth that the
playground, Starter Kit, tutorial, and docs eventually all point at,
rather than each maintaining their own divergent samples.

## What's here

| Directory | Demonstrates |
| --- | --- |
| [`basic/`](./basic) | Minimal config: one group, one URL-sourced track against the real UniProt API |
| [`inline-data/`](./inline-data) | `from: inline` — no network fetch for track data — plus a `theme:` block recolouring the row-label panel (no-code theming) |
| [`csv/`](./csv) | Bring-your-own CSV file as a **single standalone track** (one `rows:` entry, no group wrapper) — `features-csv` adapter, inferred from the `.csv` extension |
| [`tsv/`](./tsv) | Bring-your-own TSV file — `features-tsv` adapter, inferred from the `.tsv` extension |
| [`json/`](./json) | A live **UniProt** API track next to a bring-your-own JSON file — `features-json` adapter, inferred from the `.json` extension |
| [`bed/`](./bed) | Bring-your-own BED file — `bed` adapter, inferred from the `.bed` extension |
| [`extend-default/`](./extend-default) | `extends:` the shipped canonical UniProt config and layers one custom CSV-backed track on top |

Column/shape conventions for the four generic-format adapters (CSV,
TSV, JSON, BED) are documented in
[`specs/generic-format-adapters.md`](../specs/generic-format-adapters.md).
The expected payload shape for every built-in kind and adapter — plus
the config-vs-payload boundary — is in
[the adapter reference](https://ebi-webcomponents.github.io/protvista/adapter-reference) and
[configuration vs data](https://ebi-webcomponents.github.io/protvista/configuration-vs-data).
The full config schema is documented in
[`specs/config-approach.md`](../specs/config-approach.md), which is
the normative source these examples are drawn from.

## Why every example declares `accession: P05067`

`<protvista-uniprot>` gates its entire load pipeline — including
purely local or inline track data — behind a truthy `accession`
(the element fetches the sequence for the accession before loading
any track). Without an `accession`, even a fully-offline example like
`inline-data/` would render nothing when mounted standalone. Every
example here bakes in `P05067` (Amyloid precursor protein — the
reference accession used across this repo's test suite) purely so it
is genuinely runnable on its own.

One consequence worth knowing: because of this, mounting even the
"offline" examples (`inline-data/`, `csv/`, `tsv/`, `json/`, `bed/`)
for real still performs one network call — the element's top-level
sequence fetch for `P05067` — even though their own track data never
touches the network. This is an existing architectural characteristic
of the element, not something specific to these examples.

## Running an example

Point the `config-src` attribute at any example's config file:

```html
<protvista-uniprot config-src="./examples/basic/config.yaml"></protvista-uniprot>
```

or paste the config into the [playground](https://ebi-webcomponents.github.io/protvista/playground/)
to see it render live (run `yarn docs:dev` and open `/protvista/playground` locally).

**Path-resolution caveat.** `<protvista-uniprot>` fetches `config-src`
itself relative to the hosting page, but everything *inside* the
fetched config — a track's `data: ./hotspots.csv` shorthand, an
`extends:` reference — is resolved by the loader's default fetcher as
a bare `fetch(url)`, which the browser resolves against the *hosting
page's* URL, not the config file's own directory. This is transparent
for `basic/` and `inline-data/` (neither references another file), so
"point `config-src` at any example" is literally true only for those
two. For the file-backed examples (`csv/`, `tsv/`, `json/`, `bed/`,
`extend-default/`), the snippet above only resolves correctly when
the hosting page itself lives in that example's own directory (e.g.
serve from `examples/csv/` and use `config-src="./config.yaml"`) — a
page at the repo root loading `config-src="./examples/csv/config.yaml"`
will fetch `./hotspots.csv` against the repo root instead and render
that group empty. `extend-default/config.yaml` sidesteps this for its
own `extends:` target by using an origin-absolute path
(`/src/default-config.yaml`, see the comment in that file) — but its
`data: ./hotspots.csv` track is still page-relative like every other
file-backed example.
