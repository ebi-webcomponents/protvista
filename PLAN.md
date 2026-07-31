# Reframe the Q2 blog post: v5 refactor, hackathon first, SSI house style

## Context

`docs/src/content/docs/blog/playground-and-starter-kit.md` is the ROADMAP Q2 community deliverable — *"Publish the first blog post announcing the Starter Kit and playground, targeting clinical researchers and bench scientists"* (ROADMAP.md:73). The RSMF terms confirm it is an expected output type: the fund explicitly covers *"dissemination including blog posts, case studies"*.

Today the post reads as a CSV walkthrough. It needs to lead with what the v5 refactor lets people **do**, put the hackathon and its sign-up link at the top, follow SSI house style, and carry the mandated funding acknowledgement. It also contains seven factual errors against the shipped code.

The merge of `origin/next` (`1fd4f3e`) is clean — the post survived untouched, the `Blog` sidebar entry and home-page blurb both survived next's deletion of them, and `customize-layout.md` arrived under How-to.

**Verification limits, stated plainly.** `node_modules` is not installed, so I could not run `yarn docs:build` or `yarn test`; every code claim below I verified by reading the merged tree directly. Every external claim now comes from a primary source read in full: the SSI editorial style guide and contributors guide, the RSMF Terms and Conditions PDF, The Open Source Way and Red Hat on release announcements, and the live hackathon event page. The only source that eluded me is the SSI blogging page, which 404s on both hosts — its content appears folded into the contributors guide.

**Release gating.** "Are live" is only true once `protvista-uniprot@5.0.0` reaches npm (latest published is 4.9.3). The post keeps v5, so it publishes at or after that release — see **Release sequence** below. Pages deploys from `next` only (docs/pages-site.md), so the post goes live when `blog-post` reaches `next`.

**Hard deadline.** Q2 closes Friday 31 July 2026. Both release-announcement sources advise against Friday publication, but the deliverable date wins; mitigate by re-sharing the following Tuesday. The hackathon's 1 October application deadline leaves two months to fill 30 places, so the Friday timing costs little.

## 1. Funding acknowledgement — compliance gap beyond this post

The RSMF Terms and Conditions, under *Acknowledgment of funding*, state: **"All outputs from the funded project must acknowledge the funding source using the following text"** —

> This work was supported by the Research Software Maintenance Fund, managed by the Software Sustainability Institute and funded by UKRI through their Digital Research Infrastructure programme via grant AH/Z000114/1.

The repo uses a paraphrase everywhere — *"…and funded by UKRI grant reference AH/Z000114/1"* — dropping "through their Digital Research Infrastructure programme via grant". Affected: `ROADMAP.md:249`, `README.md:227`, `starter-kit/README.md:125`, `ADVISORY_BOARD_TOR.md:114`, `specs/config-approach.md:1396`, and the post's own footer (lines 271-273), which paraphrases further still.

Use the mandated text verbatim in the post. I recommend a separate small commit correcting the other five files — say the word and I will include it. Also worth knowing: grantees *"must not include the Software Sustainability Institute as co-authors on publications without explicit prior permission"*, and *"will be requested to allow the use of their software names and logos for the purposes of dissemination and publicity solely related to the RSMF"*.

## 2. Running order — layer the information

Best practice for a release announcement is layering: plain-language summary first, categorised detail below, migration notes for breaking changes. SSI's contributors guide asks for the same shape — keyword-focused title, abstract-style introduction, subheaded body, conclusion with recommendations, and a call to action. The Open Source Way's template agrees and adds a useful constraint: an opening statement of the project's purpose, what it does, then **"notable enhancements (typically three major features in separate paragraphs)"**, then links, then an "About" section. Keeping the post long-form (your call) is compatible with all of that; the fix is ordering, not deletion.

1. **Title** — keyword-focused, naming ProtVista and v5.
2. **Abstract-style opening** — two or three sentences: what shipped, who it is for, why it matters. Front-load.
3. **Hackathon callout** — immediately after the opening, and materially more informative than today's version. The event page is live and carries facts the post omits: **applications close 1 October 2026**, there are **30 places on a first-come, first-served basis**, it is free, and it runs online over Zoom. A capped, deadlined call to action needs both of those numbers in it; the current callout gives only the dates. SSI's date format (`5–7 July 2020`) is what the post already uses.
4. **What you can do now** — the benefits section (§3), shaped as **three** headline enhancements rather than the current four-part numbering: bring your own data; rearrange the view; explore and publish without code (playground plus Starter Kit). Theming folds under the third.
5. **The walkthrough** — the existing detail, largely as-is with the §5 corrections, sitting below the three headlines.
6. **For integrators upgrading** — short migration note (§3).
7. **Conclusion + calls to action** — webinar, office hours, contributing, hackathon again.

Red Hat's guidance adds one structural element the post lacks entirely: after the notable enhancements, a **"complete feature list reference"**. For a v5.0.0 announcement readers will want the full changelog, so link `CHANGELOG.md` explicitly. Red Hat also scales announcement effort by release type — a major (X.0) release gets the fullest treatment and media outreach, with coordination beginning **three weeks ahead**. v5.0.0 is exactly that case, so this post is worth the full treatment rather than a light touch.

Three more points, all cheap and all currently missing:

- **Thank the contributors.** The guidance asks for "gratitude to contributors" and community quotes. The post credits nobody. For a community-building deliverable that is an easy win, and an office-hours or early-adopter quote would strengthen it further.
- **Avoid hyperbole and speculation.** Media outlets "dismiss such claims and may ignore your release entirely". The post is already restrained; this mainly reinforces the two honesty constraints in §3 (no WebGL, no percentage speed-ups).
- **Write to encourage use *and* contribution.** "Tailor release announcements and blogs to encourage both *use* of the software as well as *contributions* to it" — the hackathon and contributor-guide links carry this, so keep both prominent rather than buried in a closing list.

## 3. The refactor, in plain language

Keep this benefit-led, as you asked. Worth knowing while writing it: the RSMF states its own purpose as funding work *"particularly around reducing technical debt, improving user experience and building community"* — so the maintenance story is on-message for the funder. The resolution is plain language, not omission. Aim for roughly three short paragraphs plus one link, not an engineering report.

**Lead with what changed for the reader:**
- Point ProtVista at your own data — a config file, no longer a source edit and rebuild.
- Use it outside UniProt — the data sources are yours to set.
- Restyle it to match your site — no forking.
- Rearrange what you see — no code at all.

**Then one short paragraph of substance,** in plain English, linking to `docs/architecture-audit.md` for anyone who wants the detail. Verified facts you can draw on, sparingly:
- A 912-line hand-written `src/config.ts` listed 15 groups and about 40 tracks, with four EBI web-address constants baked in. That file is gone (deleted in `945ca9f`); a validated config file replaced it.
- `ROADMAP.md:45` records the starting point as two test files. The tree now carries **62** `*.spec.ts` files, with coverage floors enforced in `vite.config.mjs:233-238` (statements 80, branches 74, functions 78, lines 81).
- Tooltips were five files of hand-assembled HTML carrying UniProt-specific lookup tables into every user's bundle; they are now templates (`architecture-audit.md` A9/A10).

**Migration note for integrators** — best practice calls for this and the post has none. The v5 compatibility contract (`architecture-audit.md` §C) covers the element tag, package name, runtime API, `schema.json` field names, the `change` event payload and the default config's track ids; CSS class names and internal module structure are explicitly outside it. Flag the behaviour change: a bare `import 'protvista-uniprot'` is now required to register the element, because the false `"sideEffects": false` promise has been removed.

**Contributors — thank them by name.** Verified in the history:
- **jishanahmed-shaikh**, PR **#137**, merged 1 May 2026: "forbid `any` across codebase, enable `noImplicitAny` + `strictNullChecks`" (closes #133), plus two rounds of review fixes. Squarely on the maintenance theme, so it belongs *inside* the refactor section rather than in a footnote.
- **Epi-Lo** — two PRs, superseded by #137 before merging, so no commits in the history. Thank by name for the contribution without implying the code shipped.

**Two claims to keep honest:**
- **No WebGL.** The proposal says "Adopting Canvas and WebGL"; canvas shipped. `webgl` appears only in `docs/architecture-audit.md` and `docs/architecture.md`, nowhere in `src/`. The post says canvas, with no hedging. **Agreed framing for grant reporting** (kept out of the post): benchmarking showed canvas already met the performance goal for dense annotation tracks, so WebGL was not needed — which is precisely the risk-mitigation clause in the application ("if certain refactoring tasks or new features (e.g. WebGL integration) prove more challenging than expected, we will prioritise core functionalities"). The bundle-size and `render` figures from the benchmark run are the evidence for that, which is a further reason to do the comparison today.
- **Percentages are available after all** — correcting an earlier error in this plan. `14632a3` (29 April 2026) is an ancestor of `main`, not `next`, so `bench/baselines/summary-14632a3.md` and `bundle-size-14632a3.json` **are** the v4 baseline. The "before" exists; only the "after" is missing. v4 bundle: **4,655,449 bytes raw / 1,162,894 gzipped**. Run `yarn bench:bundle` on `next` and the delta is quotable. Caveat on what is comparable: bundle size fully (same script, machine-independent); the component marks `fetch-and-parse` / `render` / `total` broadly (they time the component lifecycle, not the page); Lighthouse page scores **not** apples-to-apples, because `main` measured `index.html` via `vite.demo.config.mjs` while `next` measures the bare `bench.html` via `vite.bench.config.mjs`. Lead with bundle size and the `render` mark. `bench/README.md`'s own rule: treat any single-metric delta under ~5% as noise.

## 4. SSI house style corrections

All verified against the SSI editorial style guide and contributors guide.

| Rule | Current state | Action |
| --- | --- | --- |
| British English, "‑ise not ‑ize" | `visualizing` (line 3), `Customizing` (27, 139), `customizing` (27), `customize` (241), `recolors` (221), `visualization` (241, 248) | Switch prose to `customising`, `visualising`, `visualisation`, `recolours`. **Keep the nine `Customize` occurrences that name the button** — it is the literal control label. Note the repo itself is inconsistent (`customize-layout.md` uses American throughout); worth a separate decision. |
| Acronyms spelled out once unless audience-known | `PTMs` (×2) and `BED` (×2) never expanded | Expand on first use or drop. For bench scientists, `TSV`/`YAML`/`JSON` also warrant a gloss. |
| "Never publish URLs as links… link text should describe the destination" | Line 185 links as `ebi-webcomponents/protvista#240` | Removed anyway (§5.4). Check the rest — all other link text is already descriptive. |
| Avoid passive verbs | 10 instances (lines 41, 80, 126, 128, 141, 150, 156, 190, 245, 274) | Light active-voice pass. |
| Conversational tone, contractions, one thought per sentence | Post is fairly formal ("It presents two panels") | Light pass; readers move ~25% slower on screen, so short sentences and whitespace matter. |
| Sentence case headings, never all caps | Already compliant | No action. |
| Numbers: one to nine in words, 10+ digits | Already compliant | No action. |
| Dates as `7–9 October 2026` | Already compliant | No action. |
| Alt text on every image | No images yet | Required for the cover image. |
| Cover image | None | You are capturing a playground screenshot. Spec: sharp at 400×300px / 72dpi, caption crediting the source, licensed CC BY 4.0 like the rest of the docs, plus alt text. |
| 500–1,000 words | 1,847 words of prose | Staying long-form is your call and fine for your own site. If you want SSI or RSMF to cross-post, a condensed cut will be needed — their guide invites contacting the SSI communications officer to discuss ideas and get feedback on drafts, which is worth doing early. |

## 5. Factual corrections

1. **CSV required columns** (lines 60-69). The post says *"Three columns are required; two are optional"* and marks `description` Optional. The parser requires four header columns — `REQUIRED_COLUMNS = ['type','start','end','description']` (`src/schema/adapters/dsv.ts:124`, pinned by `src/schema/__spec__/adapter-reference.spec.ts:71-75`). Only the *cell* may be blank. Match the wording in `your-data.md`. The example CSV itself is correct.
2. **Layout persistence scope** (lines 175-177). The post says the layout returns *"on the same protein"* — the opposite of what ships. `configIdentity()` (`src/layout-persistence.ts:33-45`) keys `localStorage` on a hash of the config's row and track ids, explicitly *"per-config, not per-accession"*, so a saved layout applies to **every** protein viewed with the same config.
3. **`?layout=` versus playground sharing** (lines 177-179). Not "the same mechanism": the playground stores state in the URL **hash** (`src/playground/url-state.ts`), a layout in a **query parameter** (`LAYOUT_PARAM = 'layout'`, `src/layout-persistence.ts:17`). Drop or soften.
4. **Stale PR #240 link** (lines 181-186). Merged, and the merge brought a user-facing page. Point at `/protvista/customize-layout` — consistent with `01e358b`, which already dropped the other #240 link.
5. **Funding acknowledgement** (lines 271-273) — see §1.
6. **"N hidden" counts tracks, not rows** (lines 163-167). Hiding a six-track group reads "6 hidden" (`src/protvista-uniprot.ts:2383`). Add the exception to *"hidden is not deleted"*: a track whose data never arrived has its Show switch **disabled**, named "Show X — no data".
7. **Accessibility** (lines 156-158). Strengthen, carefully: the Customize UI targets specific WCAG 2.1 AA criteria — buttons rather than drag (2.5.7), a polite live region announcing each move (4.1.3), 24×24px targets (2.5.8), state never carried by colour alone (1.4.1) — and axe reports no violations with the mode active (`docs/accessibility-baseline.md:65-101`). Do **not** claim conformance: the manual audit is a Q3 deliverable and that file lists four residual gaps.

## 6. Blog index instead of a sidebar list

- **New** `docs/src/content/docs/blog/index.md` — a short Starlight page at `/protvista/blog/` listing each post as title plus one-line description, hand-maintained.
- **`docs/astro.config.mjs:134-141`** — replace the `Blog` group and its `items` array with a single `{ label: 'Blog', link: '/blog/' }`.
- **`docs/src/content/docs/index.md:32-33`** — repoint the home splash at the index.

Auto-generating from `getCollection()` in a native `.astro` page is the scalable alternative but needs Starlight chrome wiring I could not verify without installed deps. Do **not** create both an `index.md` and a `pages/blog.astro` at the same route — they collide.

Nothing is published yet, so this is also the moment to rename the file to a slug matching the new framing (for example `protvista-5`). Only the two references above need updating.

## 7. Webinar and remaining Q2 links

- **Webinar** — a Q2 output (ROADMAP.md:75) absent from the post. Now decoupled from it: the webinar will go deeper than a walkthrough, so it is no longer built on this post. Mention that a webinar is coming, with no URL — a `TODO` placeholder risks shipping on Friday.
- Add descriptive links for **Customize the layout** (`/protvista/customize-layout`), the **published config schema** (`/protvista/schema/v1/config.schema.json`) and the **contributor guide** (`CONTRIBUTING.md`, which supports the hackathon call). Mention escape hatches and configuration-versus-data inline rather than lengthening the list.
- **Date the post.** `docs/src/content.config.ts` uses an unextended `docsSchema()`, so a frontmatter `date:` would fail validation without extending the schema. Cheapest: put the date in the footer beside the acknowledgement, in SSI format.

## Release sequence

The blog post is gated on the npm publish. The one blocker that stood in front of it is now cleared.

**Blocker: the `./config` subpath — DONE (commit `ceb360e`).** UniProt's variant tab does `import { filterConfig } from 'protvista-uniprot'` without importing the component. On 4.9.3 the bundler tree-shook the component away; on 5.0.0 that chunk would grow by roughly 1.16 MB gzipped. As planned, the fix landed **before** 5.0.0, built on a branch off `next` (parent `9ee0563`) and merged into `blog-post` (`d5c2865`), so it stays independently shippable with the release. It was cheap because `ClinicalSignificance` in `src/filter-config.ts` was used only as a type; that import is now `import type`, so the module has no runtime dependency and the `./config` subpath tree-shakes the element away. Verified green with deps installed: `tsc`, `eslint`, the new `config-subpath-purity` + updated `package-contract` specs, and the full `yarn validate` (build, `publint --strict`, `attw`, tarball contract, sourcemaps). A source-graph spec (`src/__spec__/config-subpath-purity.spec.ts`) fails if the subpath ever reaches a custom-element registration.

**Discovered while verifying — the built element entry is code-split, so the "copy one file" docs break.** `dist/protvista-uniprot.mjs` is not a single self-contained file: Vite v8 emits it with sibling chunks — `errors.js` and (new, from `ceb360e`) the shared `filter-config.js` imported statically, `format.js` / `js-yaml.js` lazily. This predates `ceb360e` (the static `./errors.js` import was already there under the single-entry build; `ceb360e` only added `filter-config.js`), so it is not caused by the subpath work — but it means `docs/.../tutorial.md` and `embed.md`, which tell readers to *"copy `dist/protvista-uniprot.mjs` next to your page,"* produce an immediate load failure (the browser 404s the sibling chunks). npm/bundler and jsDelivr/CDN consumers are unaffected — `publint`/`attw`/`validate` stay green because they test bundler/CDN resolution, not a bare file copy. **Decision: keep the split** (it honours the code's own lazy `import()`s — the old single-entry build was silently eager-loading the ~55 KB `js-yaml` for everyone — and it is where the docs point post-publish anyway) rather than forcing a single inlined bundle, which would eager-load `js-yaml`, duplicate `filter-config`, and add a second build config. **Fix applied now:** `tutorial.md` and `embed.md` updated to copy the whole `dist/` contents (pre-publish) and to load from the pinned jsDelivr URL once 5.0 is on npm; `CHANGELOG.md` notes the code-split bundle for direct consumers.

**Publish as 5.0.0 on the `next` dist-tag — do not use a prerelease version string.** `publishConfig: {"tag": "next"}` is already in `package.json`, so `latest` stays at 4.9.3 and v5 is opt-in via `npm i protvista-uniprot@next`. A `5.0.0-beta.1` version would break three things: the pin-matching specs (`starter-kit.spec.ts`, `schema-publishing.spec.ts` match `/protvista-uniprot@(\d+\.\d+\.\d+)/` and compare against `package.json`, so you would also have to repin `starter-kit/index.html`, `starter-kit/recipes/extend-uniprot.yaml`, `docs/.../configure.md:157`, `docs/.../tutorial.md:158`); `src/styles/css-prefix.ts`, which freezes `CSS_PREFIX = 'pv-cecb45'` as `sha1('protvista-uniprot@' + version).slice(0,6)`, invalidating every DOM snapshot; and `publish-starter-kit.yml`, which gates the "does not work yet" banner on the registry having `package.json`'s exact version.

```bash
git checkout next && git pull
yarn install --frozen-lockfile
yarn test && yarn validate
npm publish --dry-run
npm publish                        # prepack builds; prepublishOnly runs test:pack
npm dist-tag ls protvista-uniprot  # expect next: 5.0.0, latest: 4.9.3
```

Use `npm`, not `yarn publish` — yarn classic prompts for a version bump, and `test:pack` packs with npm deliberately (b167afd).

**Then, in order:**
1. Cut the GitHub release tagged `v5.0.0`. That fires `publish-starter-kit.yml`, which sees 5.0.0 on npm and strips the "does not work yet" banner from the template repo automatically.
2. `yarn cdn:clear` if jsDelivr has cached the 404.
3. `CHANGELOG.md`: `## Unreleased` → `## 5.0.0`, and rewrite the "Consequence worth knowing" paragraph now the subpath exists.
4. **Two docs statements go stale on publish:** `docs/src/content/docs/embed.md:57` and `tutorial.md:26` both say the published release is 4.9.3 and predates the config work. Both files now carry a "once 5.0 is on npm, load from the jsDelivr CDN" line (added with the code-split fix above); at publish, promote that CDN load to the primary instruction and drop the build-from-source stopgap.
5. `yarn bench:bundle` on `next` for the v4-versus-v5 figure (see §3).
6. Blog post.

## 8. Files and verification

**Files**
- `docs/src/content/docs/blog/playground-and-starter-kit.md` — reorder, reframe, corrections, style pass (rename slug)
- `docs/src/content/docs/blog/index.md` — new
- `docs/astro.config.mjs` — sidebar
- `docs/src/content/docs/index.md` — repoint home link
- `docs/src/content/docs/tutorial.md`, `docs/src/content/docs/embed.md` — done: copy whole `dist/` + pinned CDN load (code-split fix, see Release sequence)
- `CHANGELOG.md` — done: note the code-split element bundle for direct consumers
- Optionally, the five files in §1 for the acknowledgement wording

**Prerequisite:** fast-forward this clone to the host's merge (`git fetch /run/sandbox/source blog-post`, then merge to `1fd4f3e`).

**Verification** (needs deps — run on the host):
1. `yarn docs:build` — post and index build; Starlight resolves every internal link. All targets and anchors already verified to exist; base `/protvista` is correct.
2. `yarn test` — confirms no drift test is disturbed (`adapter-reference.spec.ts`, `starter-kit.spec.ts`, `tutorial-doc.spec.ts`).
3. `yarn start`, open `/protvista/blog/` — index lists the post; open the post and read it against a live viewer: enter Customize, hide a group, confirm "N hidden" counts tracks, reload to confirm the layout restores, copy the `?layout=` URL into a fresh tab.
4. Paste the post's `hotspots.csv` block into the playground's CSV preset to confirm it parses under the corrected column contract.
5. Word count and a read-aloud pass for the active-voice and contraction changes.

**Recommended follow-up:** the post keeps a walkthrough that restates `tutorial.md`, `your-data.md`, `customize-layout.md` and `theming.md` — and it has already drifted from them once, which is how the CSV error arose. This repo guards exactly that with `src/__spec__/tutorial-doc.spec.ts` and `configuration-vs-data-doc.spec.ts`. A matching `blog-doc.spec.ts` pinning the post's CSV and YAML blocks to the `examples/` files would stop it drifting again. Small, and follows established precedent.

## Open items

- **Hackathon page: confirmed live**, titled "ProtVista hackathon", 7–9 October 2026, online over Zoom, free, 30 places first come first served, applications close 1 October 2026, contact Daniel Rice. Dates are consistent with ROADMAP Q3. Nothing to resolve — but see §2.3, since the post currently states only the dates.
- **Funding acknowledgement — your call, still open.** You judged the current wording fine; my evidence for the mismatch is quoted in §1. I will use the T&Cs text verbatim in the post unless you say otherwise, and leave the other five files alone until you decide.
- **Publication timing** — settled: Friday 31 July, re-share the following Tuesday. See Context.
