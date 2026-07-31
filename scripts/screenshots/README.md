# Documentation screenshots

Every image in the docs is generated from this directory. One command
regenerates the lot, from the code in your working tree, with no network beyond
a local preview server.

```sh
yarn screenshots                      # regenerate everything
yarn screenshots --only=home-hero     # one or more, comma-separated
yarn screenshots --check              # report drift, write nothing (CI)
yarn screenshots --assert-clean       # capture twice, fail if not identical
yarn screenshots --no-build           # reuse the existing site/ build
yarn screenshots --refresh-fixtures   # re-record the pinned payloads (rare)
```

Chromium is required: `npx playwright install chromium`. Some sandboxes block
that download; the CI check job skips rather than fails in that case.

## Why it is built this way

**Screenshots taken by hand rot.** They are captured at whatever window size
the author had, drift the moment the UI changes, and nobody remembers which
version produced them. Making them a build artefact removes all three problems.

**It lives in this repo, not a separate tool.** Playwright and sharp are already
devDependencies; the inputs are here (the playground and its presets, the sample
data, the example configs) and so are the outputs. A standalone tool would have
to clone and build ProtVista anyway, duplicate the preset knowledge, and be
released in lockstep. Captures run against a local build rather than the
deployed site for the same reason: a screenshot should show the commit it ships
beside, so an image and the UI change together in one PR.

**Everything is pinned.** The viewer fetches some thirty URLs — UniProt,
InterPro, AlphaFold, PDBe — and UniProt is curated continuously, so a live
capture would drift silently and CI would depend on EBI being reachable.
`fixtures/` holds those payloads and `router.mjs` serves them. A request that is
_not_ pinned aborts and fails the run rather than quietly reaching the network.

**Failure is loud.** A screenshot of a broken viewer is worse than no
screenshot, so a run fails on: an unpinned request, a page or console error, an
error panel, an empty viewer, a row set that differs from the manifest, pixels
that never settle, or an oversized file.

## Adding a shot

1. Add an entry to `manifest.mjs`: `id`, `url`, `viewport`, `expectGroups`,
   `alt`, `caption`, and the `doc` that will display it.
2. Run `yarn screenshots --only=<id>`. If `expectGroups` is wrong the run tells
   you the actual set — paste it in. **Measure, never guess.**
3. Reference the image from the doc, matching the manifest's alt and caption:

   ```md
   ![Alt text from the manifest.](../../assets/screenshots/<id>.png)

   _Caption from the manifest._
   ```

   From `docs/src/content/docs/blog/` it is `../../../assets/…`. The splash
   hero is different: it goes in `index.md` frontmatter under `hero.image`.

4. `yarn test` — `scripts/screenshots/screenshots-doc.spec.mjs` checks the doc and the
   manifest agree.

### Manifest options beyond the basics

- **`actions`** — interactions to perform before capturing, targeted by
  accessible role and name (`clickRole`). The row set is asserted _after_ these
  run, since an interaction can legitimately change it.
- **`clip`** — `element` and `stopBefore` bound the capture; `aspect` forces a
  ratio from the top of the element (`1` for the square hero). `stopBefore: null`
  explicitly disables the default cut above the 3D pane.
- **`resizeTo`** — final pixel size. Used by the hero, which Starlight renders at
  exactly 400×400.
- **`hide`** — selectors to `display:none` before measuring. This exists for one
  case: the 3D pane is stubbed for determinism and renders "No structure
  information available", which is an artefact of the harness rather than
  something a reader would see. A figure that would otherwise include it hides
  the pane instead of publishing a false empty state.
- **`frames`** — capture several views and join them side by side, for shots
  that only mean something as a comparison. `theming-comparison` uses the same
  configuration with and without its `theme:` block, so the only visible
  difference is the one being demonstrated.
- **`out`** — write somewhere other than `docs/src/assets/screenshots/`. Only
  `readme-hero` uses it, because GitHub and npm resolve README image paths
  relative to the file.
- **`structure: true`** — include the 3D pane, which is otherwise stubbed away
  (see below). Such a shot is run in a separate browser with SwiftShader forced,
  and needs a `tolerance`.
- **`tolerance`** — the fraction of pixels that may differ before two images
  count as different, for shots that cannot be byte-exact. It governs
  `--check`, `--assert-clean`, **and whether the file is rewritten at all** —
  without that last part a tolerated shot would dirty the diff on every run.
  Only the two shots containing the 3D model use it: 1% for the standalone
  view, 3% for the home hero, where downscaling to 400px amplifies the same
  noise. The cost is real: drift under that threshold is not reported.

## Things that will bite you

- **The 3D structure pane is excluded unless a shot asks for it.**
  `nostructure` defaults to false, so the pane always mounts; left alone it
  loads Mol\* (WebGL) and a multi-megabyte model whose canvas and camera never
  settle reproducibly. By default `router.mjs` serves `[]` for its two
  endpoints, which keeps `<nightingale-structure>` from being created at all,
  captures clip to just above the pane, and `ready.mjs` fails the run if the
  element appears anyway.
- **A shot that wants the 3D pane sets `structure: true`.** The stubs are
  skipped, the real payloads come from fixtures, the `nightingale-structure`
  assertion is lifted, and the browser is launched with SwiftShader forced.
  That last part is essential — without
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, headless
  Chromium refuses Mol\*'s WebGL context, and Mol\* then gives up _before
  requesting its model_, leaving a silently blank pane that looks like a
  missing-data problem. The flags are applied only to structure shots, in a
  separate browser: with them on, the ordinary Nightingale track canvases never
  stop redrawing and no other shot reaches pixel stability. Mol\* also settles
  to marginally different anti-aliasing per run (~0.3% of pixels), so such a
  shot needs a `tolerance`.
- **What the 3D pane shows is resolved over three hops**, and a broken one is
  silent. For P05067 the viewer asks `rest.uniprot.org` for cross-references,
  3D-Beacons for a model list, then the PDBe model server for the bcif — landing
  on the _experimental_ entry **1AAP**. If `rest.uniprot.org` cannot be reached
  it falls back to the AlphaFold model instead: a different picture, no error.
  If the structure images change, check that first.
- **Fixtures are recorded with Node, not the browser.** Chromium in some proxied
  environments cannot complete HTTP/2 to `www.ebi.ac.uk`
  (`ERR_HTTP2_PROTOCOL_ERROR`) where Node succeeds, so browser-driven recording
  would be impossible exactly where it is most needed.
- **`expectGroups` differs between views of the same URL.** Entering Customize
  mode reveals rows that errored, so their ⚠ badge stays reachable — hence
  `blog-customize-mode` expects one row more than `tutorial-default-viewer`,
  from the same preset. Both are deterministic.
- **`RNA_EDITING` has no data for P05067**: that endpoint genuinely 404s and the
  fixture replays it. The row renders as a disabled, greyed-out entry, which is
  the documented "no data" state, not a bug.
- **Below ~900px the playground stacks** its editor above the preview and the
  viewer moves thousands of pixels down the page. Keep shot viewports wide.
- **The splash hero is rendered at exactly 400×400** by Starlight, with sharp's
  default `cover` fit — a non-square source is centre-cropped. `home-hero` is
  therefore captured square (`clip.aspect: 1`) and resized to 400×400.

## Refreshing fixtures

```sh
yarn screenshots --refresh-fixtures
```

Deliberate and rare. The payloads are ~6 MB raw across ~30 URLs, so a
refresh is a real commit; review `fixtures/index.json`, where each entry records
the URL, status, byte count, hash and retrieval date, and expect the images to
change with it. Do it at release time, so the pictures document the science of
the release rather than of an arbitrary Tuesday.

If a capture reports an unpinned URL, pass it directly:

```sh
node scripts/screenshots/record-cli.mjs "https://example.org/new/endpoint"
```

## Licensing

Fixtures are third-party data — UniProt (`rest.uniprot.org`, the Proteins API),
InterPro, PDBe (structure mappings and the bcif model) and AlphaFold — stored
solely to make documentation builds reproducible. The Open Sans web font under
`fixtures/net/fonts.gstatic.com/` is used under the SIL Open Font License.
