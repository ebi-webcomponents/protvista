# The GitHub Pages site: structure and roadmap

This document maps the GitHub Pages site and the set of interconnected "Documentation and training" deliverables it hosts (ROADMAP Q2). It is a guide for developers picking up the parts that are still to be built. It describes what exists today, where each future piece slots in, and how the pieces cross-link.

## How the site is built and deployed

The site is built by **Astro + Starlight** (the docs, including the playground) plus a small vite build (the `bench.html` harness), all writing into one `site/` directory:

- **Docs** (`yarn docs:build` → `astro build --root docs`, config `docs/astro.config.mjs`) render the Starlight user guide into `site/` at the **root**, base `/protvista/`. The home — `docs/src/content/docs/index.md`, a Starlight splash — is the site's landing page; there is no separate hub. Guide pages live under `docs/src/content/docs/` (each needs `title:` frontmatter). Internal engineering docs (this file, `architecture.md`, …) stay at `docs/` root, outside `src/`, so Astro ignores them.
- **The playground** is a native Astro page (`docs/src/pages/playground.astro`) at `/protvista/playground`, built by `astro build`. Its markup lives in the `.astro`; the heavy client (the `<protvista-uniprot>` component + the `src/playground/` controller) loads client-side only. Astro's `vite.server.fs.allow` lets it import the library source from the repo root. The csv/json presets fetch `/protvista/sample-data/hotspots.*`, served from `docs/public/sample-data/` (copies of `examples/csv|json/hotspots.*`).
- **`bench.html`** is a separate, minimal vite build (`vite.bench.config.mjs` → `yarn bench:build`), merged into `site/` with `emptyOutDir: false`, so its Lighthouse baselines stay isolated from the richer playground. It also copies the repo-root `public/` (the published JSON Schema) into `site/`.

`yarn site:build` runs `docs:build` (Astro — owns `index.html` + the native playground, and empties `site/`) then `bench:build` (vite — adds `bench.html`, merged with `emptyOutDir: false`). `yarn site:preview` (`astro preview`) serves the merged `site/` at `/protvista/`. `yarn start` (= `yarn docs:dev`) is the Astro dev server, with HMR for the docs **and** the playground page. `Test and Deploy` uploads `site/` to GitHub Pages on a push to `next` only; PRs build the library but do not publish.

Adding a **doc page** = one markdown file under `docs/src/content/docs/` (with `title:` frontmatter) + a sidebar entry in `docs/astro.config.mjs`. The playground is a native Astro page under `docs/src/pages/`.

Two build-tooling notes. (1) The repo pins a `js-yaml` 5.x whose ESM entry has **no `default` export**, which several Astro/Starlight internals import as a default; a `postinstall` step (`scripts/patch-js-yaml.mjs`) appends one (the library uses named imports, so it is unaffected). (2) Mermaid fenced blocks are rendered by the `astro-mermaid` integration.

The bench build copies `public/` into `site/` (Vite's default `copyPublicDir`), so the published JSON Schema at `public/schema/v1/config.schema.json` is served at `/schema/v1/config.schema.json` — matching the `$schema` URL in `src/default-config.yaml`. Astro copies `docs/public/` (e.g. `llms.txt`) likewise. Keep `copyPublicDir` on: dropping `public/` 404s the schema external editors resolve for autocomplete.

## Page inventory

| Page | Role | Status |
| --- | --- | --- |
| `docs/` (Astro + Starlight) | The site — the Starlight user guide at the root (`/protvista/`). `src/content/docs/index.md` (a splash) is the home (audience router + links to the playground, Starter Kit, schema, source). Replaced the old `index.html` hub. | Done |
| `docs/src/pages/playground.astro` | The configuration playground (#210) at `/protvista/playground` — a native full-screen Astro page (no Starlight chrome): edit a YAML/JSON config, validate live, render a `<protvista-uniprot>` preview on Run, share via URL. `?dev` adds an "Edge cases" preset group. Replaced the standalone `playground.html` (and, earlier, `demo.html`). | Done |
| `bench.html` | Minimal, **stable** Lighthouse harness for `bench/lighthouserc.cjs`, a separate vite build merged into `site/`. Deliberately bare (no fonts/chrome) so baseline numbers stay comparable. Do not add demo content here — it perturbs the measurement and invalidates `bench/baselines/`. | Done |

`bench.html` is kept deliberately separate from the richer playground: the benchmark harness must stay minimal and unchanged so performance baselines remain comparable, whereas the playground (including its `?dev` examples) is where developers eyeball rendering. Keep that separation.

## Playground internals

All playground code lives under `src/playground/`. The modules are deliberately layered so that everything except the editor itself is framework-free and unit-testable under jsdom:

- `format.ts` — JSON-vs-YAML content detection (mirrors the private heuristic in `src/schema/parse.ts`).
- `url-state.ts` — shareable-link (de)serialisation. State is `{ preset? | config?, accession }` stored in the URL **hash**. An unedited preset serialises to `preset=<id>` (short link); edited text serialises to `config=<base64>`. Pure and DOM-free; covered by `__spec__/url-state.spec.ts`.
- `presets.ts` — the seed configs offered by the picker, loaded verbatim from the canonical `examples/` directory and `src/default-config.yaml` (see below).
- `lint.ts` — runs editor text through the shipped `parseConfigText` + `validateConfig` (the one source of truth — no schema is re-declared) and maps the result to diagnostics. Uses a local `Diagnostic`-shaped type so it depends on no CodeMirror package; covered by `__spec__/lint.spec.ts`.
- `editor.ts` — the only CodeMirror 6 module (editor construction, YAML/JSON language, lint gutter, `aria-label`).
- `diagnostics-view.ts` — owns the config pane's validation footer (summary line + error list); both render paths (live config diagnostics and runtime `protvista-error` issues) go through it, so the pluralised summary and `<li>` construction live in one place.
- `splitter.ts` — makes the divider between the editor and preview panes draggable, storing the split as resize-stable `fr` weights (`--left`/`--right`) on the grid; keyboard-operable ARIA separator.
- `index.ts` — page controller. Both entry points share `validateCurrent()` (debounce-cancel + generation guard + validate + gutter/list/URL). Two decoupled paths: **typing** debounces into `refreshDiagnostics()` (validation only + a "preview out of date" flag) and never touches the preview; **Run** (the button, Ctrl/Cmd+Enter, a preset selection, or an accession change) calls `run()`, the *only* path that mounts the preview. Theming is a config concern, not a playground control: authors set `theme.labelColor` / `theme.accentColor` in the config and the component applies them as `--protvista-*` tokens (see `docs/src/content/docs/theming.md`); the `inline-data` preset demonstrates it. `run()` renders by **recreating** the `<protvista-uniprot>` element (the component intentionally does not re-run its pipeline on a `viewerConfig` change — see the `updated()` gate in `src/protvista-uniprot.ts`). Mounting is gated behind Run because `<protvista-uniprot>` is heavy (Nightingale/Mol*); re-mounting it on every keystroke exhausts memory.

### CodeMirror prerequisite

The editor depends on CodeMirror 6, listed in `devDependencies` (`codemirror`, `@codemirror/state`, `@codemirror/lang-yaml`, `@codemirror/lang-json`, `@codemirror/lint`). They are build-time only — the shipped `<protvista-uniprot>` library bundle (`vite.config.mjs`) never imports them, so bundle-size and Lighthouse budgets are unaffected. Run `yarn install` before building the site.

### Presets and the `examples/` directory

`presets.ts` loads preset config text verbatim (via `?raw` imports) from the canonical `examples/` directory and `src/default-config.yaml` — the same CI-validated samples the Starter Kit, tutorial, and docs are meant to share (`examples/README.md`). Adding a preset is one entry in the `PRESETS` array; `__spec__/presets.spec.ts` loads every preset through `loadConfig`, so a broken seed cannot ship.

Which examples are surfaced is curated for a single hosted page (the rationale is in the `presets.ts` header):

- `basic` and `inline-data` render fully standalone.
- `csv` (a single standalone track — one row, no group) and `json` (a live UniProt API track next to the BYO file) are bring-your-own-file. The examples reference `data: ./hotspots.*`, which the loader resolves against the *page*, not the config's directory (see the path-resolution caveat in `examples/README.md`). So `presets.ts` repoints them at the site-absolute `/protvista/sample-data/hotspots.*`, served from `docs/public/sample-data/` (copies of `examples/csv|json/hotspots.*`). That is what makes the file-backed presets render on the playground page.
- `extend-default` is omitted: it `extends: /src/default-config.yaml`, which the built `site/` bundle does not serve, so it can only load under the dev server. `tsv` (same shape as `csv`) and `bed` (niche) are omitted for brevity — add them to `PRESETS` if wanted.

## Q2 "Documentation and training" deliverables (done)

Both remaining pieces have shipped; the **user guide (#214)** and the **Starlight docs site** are covered in the sections above.

### Tutorial (#215) (done)

`docs/src/content/docs/tutorial.md` — end-to-end onboarding: add the component, point it at an accession, add a custom track from a CSV, `extends` the default viewer, then style it. Its embedded config and CSV blocks are pinned to `examples/csv` and `examples/extend-default` by `src/__spec__/tutorial-doc.spec.ts`, so the samples cannot drift. Each step deep-links into the playground with a `#preset=…` hash. Licensed CC BY 4.0.

### Starter Kit (#211) (done)

Authored at **`starter-kit/` in this repo** and published to the standalone template repository `ebi-webcomponents/protvista-starter-kit` by `.github/workflows/publish-starter-kit.yml` on release. Living here rather than being maintained separately is what makes `src/__spec__/starter-kit.spec.ts` possible: the kit's `config.yaml` and recipes get the same load → data-pipeline → smoke-render treatment `examples.spec.ts` gives `examples/`, so breaking the kit fails `yarn test:unit` in the PR that breaks it. There is no cross-repo sync to go stale.

Resolved shape:

- **Flat and small at the root** — `index.html`, `config.yaml`, `data/`, `recipes/` — so a non-coder sees "the page, the settings, my data". A published template gets clean single-commit history from "Use this template", which is why no history-preserving split (`git subtree split`/`splitsh-lite`) is warranted.
- **One live config, two recipes.** The page has one `config-src`, so the standalone CSV track is `config.yaml` (tutorial Step 2) and `tsv.yaml` / `extend-uniprot.yaml` (Step 3) sit in `recipes/`, previewable via `?config=` without editing anything. Because `data:` resolves against the *page*, every recipe shares one `data/` folder.
- **One version pin.** `index.html` pins the bundle and `recipes/extend-uniprot.yaml` pins `extends:` at the same jsDelivr version; `starter-kit.spec.ts` asserts both equal `package.json`'s version, so a release bump cannot ship a stale kit. That `extends:` URL depends on `src` staying in package.json `files` — pinned by `schema-publishing.spec.ts`.
- **Fail-visible.** `index.html` ships a visible status notice removed only on confirmed success, so a CDN 404, a blocked network, or opening via `file://` can never present as a blank page.
- **Placeholder until 5.0.0 publishes.** npm's latest is 4.9.3, which has no `config-src`, so the pinned CDN URL 404s today. The kit ships anyway, with the state flagged in the README and in the page itself between `protvista:unpublished` markers. The publish workflow queries the npm registry for the pinned version and `sed`-strips those blocks once it is live, so the release that makes the kit work cannot ship a banner saying it does not — no one has to remember. `starter-kit.spec.ts` keeps the markers balanced so that range delete stays reliable.

Not yet done: the deploy key and the "Template repository" flag must be set up before the first publish (see the workflow header), and an "Open in Playground" link seeded from a starter config remains a natural addition.

### Publishing the docs on Pages (done)

The `docs/*.md` are rendered to HTML on Pages by **Astro + Starlight** (`docs/astro.config.mjs`, content collection under `docs/src/content/docs/`), which is now the site itself — the docs home is the site root and the old `index.html` hub is gone. This superseded both the raw-GitHub-markdown links and the earlier VitePress iteration.

## Conventions to preserve

- **One validation path.** The playground validates through `src/schema/validate.ts`, never a duplicated schema. If validation behaviour needs to change, change it in the schema module and the playground follows.
- **Accessibility baseline.** Controls are labelled, the editor has an `aria-label`, and validation errors render as text in an `aria-live` region (not colour-only). Keep new controls keyboard-operable and labelled — this aligns with the WCAG 2.1 AA target in the Q3 audit; the minimum bar is no regression.
- **Test the pure modules.** URL (de)serialisation and the lint mapping are pure and must stay covered (`src/playground/__spec__/`). Keep CodeMirror out of those modules so they test without a DOM editor.
- **Keep `bench.html` minimal.** See above.
