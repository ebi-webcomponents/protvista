# The GitHub Pages site: structure and roadmap

This document maps the GitHub Pages site and the set of interconnected "Documentation and training" deliverables it hosts (ROADMAP Q2). It is a guide for developers picking up the parts that are still to be built. It describes what exists today, where each future piece slots in, and how the pieces cross-link.

## How the site is built and deployed

The site is a **multi-page Vite build**. `yarn build:demo` (config: `vite.demo.config.mjs`) compiles every HTML entry listed under `build.rollupOptions.input` into the `demo/` directory with a relative base (`base: './'`). The `Test and Deploy` workflow (`.github/workflows/test-and-deploy.yml`) uploads `demo/` to GitHub Pages, but only on a push to `next` (this is the published branch — see the `publish-next` change). Pull requests build the library (`yarn build`) but do not publish the site, so playground/site changes are only visible on Pages after they land on `next`. To preview the whole site locally: `yarn build:demo && npx vite preview --config vite.demo.config.mjs`.

Adding a page = add one HTML file at the repo root and one entry to `rollupOptions.input`. Nothing else in the workflow needs to change.

The demo build also copies `public/` into `demo/` (Vite's default `copyPublicDir`, which the library build in `vite.config.mjs` disables but this build does not), so the published JSON Schema at `public/schema/v1/config.schema.json` is served alongside the site at `/schema/v1/config.schema.json` — matching the `$schema` URL baked into `src/default-config.yaml`. Keep that default on: dropping `public/` would 404 the schema that external editors resolve for autocomplete.

## Page inventory

| Page | Role | Status |
| --- | --- | --- |
| `index.html` | Landing hub. Intro + links to every other part (playground, demo, docs, Starter Kit, source). The connective tissue for the deliverables below. | Done |
| `playground.html` | Interactive configuration playground (#210): edit a YAML/JSON config, validate live, render a `<protvista-uniprot>` preview on Run, share via URL. | Done |
| `demo.html` | Human-facing accession demo. Reads `?accession=` (default P05067) and renders the default viewer. Carries the commented gallery of test accessions. Free to evolve. | Done |
| `bench.html` | Minimal, **stable** Lighthouse harness for `bench/lighthouserc.cjs`. Deliberately bare (no fonts/chrome) so baseline numbers stay comparable. Do not add demo content here — that perturbs the measurement and invalidates `bench/baselines/`. | Done |

`bench.html` and `demo.html` are split on purpose: the demo is the page humans look at and may grow richer over time; the benchmark harness must stay minimal and unchanged so performance baselines remain comparable. Keep that separation.

## Playground internals

All playground code lives under `src/playground/`. The modules are deliberately layered so that everything except the editor itself is framework-free and unit-testable under jsdom:

- `format.ts` — JSON-vs-YAML content detection (mirrors the private heuristic in `src/schema/parse.ts`).
- `url-state.ts` — shareable-link (de)serialisation. State is `{ preset? | config?, accession }` stored in the URL **hash**. An unedited preset serialises to `preset=<id>` (short link); edited text serialises to `config=<base64>`. Pure and DOM-free; covered by `__spec__/url-state.spec.ts`.
- `presets.ts` — the seed configs offered by the picker, loaded verbatim from the canonical `examples/` directory and `src/default-config.yaml` (see below).
- `lint.ts` — runs editor text through the shipped `parseConfigText` + `validateConfig` (the one source of truth — no schema is re-declared) and maps the result to diagnostics. Uses a local `Diagnostic`-shaped type so it depends on no CodeMirror package; covered by `__spec__/lint.spec.ts`.
- `editor.ts` — the only CodeMirror 6 module (editor construction, YAML/JSON language, lint gutter, `aria-label`).
- `index.ts` — page controller. Two separate paths, deliberately decoupled: **typing** debounces into `refreshDiagnostics()` (gutter markers + `aria-live` error list + shareable URL + a "preview out of date" flag) and never touches the preview; **Run** (the button, Ctrl/Cmd+Enter, a preset selection, or an accession change) calls `run()`, the *only* path that mounts the preview. `run()` renders by **recreating** the `<protvista-uniprot>` element (the component intentionally does not re-run its pipeline on a `viewerConfig` change — see the `updated()` gate in `src/protvista-uniprot.ts`). Mounting is gated behind Run because `<protvista-uniprot>` is heavy (Nightingale/Mol*); re-mounting it on every keystroke exhausts memory.

### CodeMirror prerequisite

The editor depends on CodeMirror 6, listed in `devDependencies` (`codemirror`, `@codemirror/state`, `@codemirror/lang-yaml`, `@codemirror/lang-json`, `@codemirror/lint`). They are build-time only — the shipped `<protvista-uniprot>` library bundle (`vite.config.mjs`) never imports them, so bundle-size and Lighthouse budgets are unaffected. Run `yarn install` before building the demo.

### Presets and the `examples/` directory

`presets.ts` loads preset config text verbatim (via `?raw` imports) from the canonical `examples/` directory and `src/default-config.yaml` — the same CI-validated samples the Starter Kit, tutorial, and docs are meant to share (`examples/README.md`). Adding a preset is one entry in the `PRESETS` array; `__spec__/presets.spec.ts` loads every preset through `loadConfig`, so a broken seed cannot ship.

Which examples are surfaced is curated for a single hosted page (the rationale is in the `presets.ts` header):

- `basic` and `inline-data` render fully standalone.
- `csv` and `json` are bring-your-own-file. On the deployed one-page playground their `data: ./hotspots.*` path resolves against the page, not the config's directory (see the path-resolution caveat in `examples/README.md`), so the file 404s and the track is hidden — the config still validates and the group renders. They demonstrate the file shape; actually hosting the data alongside the page is what the Starter Kit is for.
- `extend-default` is omitted: it `extends: /src/default-config.yaml`, which the built `demo/` bundle does not serve, so it can only load under the dev server. `tsv` (same shape as `csv`) and `bed` (niche) are omitted for brevity — add them to `PRESETS` if wanted.

## Deliverables still to build

These are the remaining Q2 "Documentation and training" pieces. The hub (`index.html`) already links to each one's eventual home, so wiring them up is mostly authoring content and pointing the existing links at it.

### User guide (#214)

Task-oriented guide in `docs/`: embedding the viewer, authoring a config, the built-in track kinds, loading your own data (CSV/TSV/JSON), and troubleshooting. Cross-link `docs/theming.md`, `docs/data-tooltip.md`, the tutorial, and the playground. The hub's "User guide" card currently points at the README Configuration section — repoint it once the guide exists. Licensed CC BY 4.0.

### Tutorial (#215)

End-to-end onboarding in `docs/`: add the component, point it at an accession, `extends` a config to add a custom track from a local CSV/TSV, then style it via tokens / `::part`. Reuse the `extends` example from `specs/config-approach.md` and the Starter Kit as the running example. Because the tutorial and the playground share the same config surface, the tutorial can deep-link into the playground with a shareable-link URL (a `#config=…` or `#preset=…` hash) so readers open the exact config being discussed. Author this **last** among the docs, after the config-surface renames settle. Licensed CC BY 4.0.

### Starter Kit (#211)

A separate template repository (`ebi-webcomponents/protvista-starter-kit`), not part of this repo: a no-build `index.html` loading the component from a pinned CDN, a commented `config.yaml`, and `data/` samples. It edits the **same config surface** the playground edits, so the two reinforce each other — the playground is where you experiment, the Starter Kit is where you start a real project. The hub already links out to it. An "Open in Playground" link (a shareable-link hash seeded from a starter config) is a natural addition once both exist.

### Publishing the docs on Pages (decision deferred)

The `docs/*.md` files are not currently rendered into the Pages site; the hub links to them on GitHub. If/when we want them rendered as HTML pages on Pages, add a Markdown→HTML step to the demo build (the repo already depends on `@markdoc/markdoc`) and repoint the hub cards. This was deliberately deferred — do it when the guide and tutorial content justify it.

## Conventions to preserve

- **One validation path.** The playground validates through `src/schema/validate.ts`, never a duplicated schema. If validation behaviour needs to change, change it in the schema module and the playground follows.
- **Accessibility baseline.** Controls are labelled, the editor has an `aria-label`, and validation errors render as text in an `aria-live` region (not colour-only). Keep new controls keyboard-operable and labelled — this aligns with the WCAG 2.1 AA target in the Q3 audit; the minimum bar is no regression.
- **Test the pure modules.** URL (de)serialisation and the lint mapping are pure and must stay covered (`src/playground/__spec__/`). Keep CodeMirror out of those modules so they test without a DOM editor.
- **Keep `bench.html` minimal.** See above.
