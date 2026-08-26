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
yarn screenshots --record-missing     # pin whatever this run found unpinned
```

Chromium is required: `npx playwright install chromium`. Some sandboxes block
that download; the CI check job skips rather than fails in that case.

## Exit codes

Two kinds of bad news, told apart, because CI answers them differently
(`.github/workflows/screenshots.yml` reads these numbers — do not renumber them
without changing that job):

| code | meaning | what to do |
| --- | --- | --- |
| `0` | every shot captured, nothing moved | nothing |
| `1` | **a shot could not be captured at all** — an unpinned request, a page error, a viewer that rendered empty, a 3D canvas that never painted | fix it; no image can be regenerated until it is |
| `2` | `--check` only: every shot captured, but the pictures moved | read the diff strip, then regenerate if the change is the wanted one |

On a pull request `2` is advisory (annotation + artifact, green job) and `1`
fails the job. Only `--check` can return `2`; a writing run has nothing to
report drift against, since it just wrote the new bytes.

## Reading a `--check` failure

`--check` reports the fraction of pixels that moved, and writes what it found to
`screenshot-drift/` (gitignored, uploaded by CI as an artifact):

```
  tutorial-standalone-csv … DRIFTED (12.40% of pixels, over the 10% tolerance)
```

- `<id>.compare.png` — the committed image, the fresh one and the difference
  joined into one strip.
- `<id>.fresh.png` — the new bytes, if the change is the wanted one.

**A report means something moved further than rasterisation ever does**, since
`TOLERANCE` already absorbs that (see `manifest.mjs`). Open the difference panel
anyway before regenerating: drift that traces every glyph and leaves the tracks,
rulers and borders untouched is still the font rasteriser, just an unusually
text-heavy shot of it; drift with a shape to it — a row appearing, a band
moving, a pane collapsing — is the UI.

Captures are byte-stable *within* a machine: three consecutive runs of a shot
produce identical files, the two 3D shots excepted, where Mol\* re-settles its
anti-aliasing. `--assert-clean` uses the same 10%, so it now catches only gross
instability — a page that never settles, a race in the fixtures — rather than
every pixel.

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
error panel, an empty viewer, a row set that differs from the manifest, a 3D
canvas that mounted but painted nothing, pixels that never settle, or an
oversized file. The unpinned check runs three times — before the gates, while
the 3D pane resolves, and once more after the pixels settle — because the viewer
keeps fetching after the gates pass, and a URL refused during the settle loop
would otherwise be reported only after the image had been written.

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
- **`structureId`** — which PDB entry the 3D pane shows, pinned through the
  pane's `selected-id`. Required for a `structure: true` shot, and asserted at
  capture time. Without it the figure is of whichever entry the pane sorts
  first, which is a property of continuously curated data and of code free to
  reorder it: when the sort flipped to descending, the selection went 1AAP →
  9UMH and every 3D capture aborted on a mappings URL no fixture had. The
  caption names a structure, so the shot should too.
- **`TOLERANCE`** — not a per-shot option: one number in `manifest.mjs`, 10%,
  is the fraction of pixels that may differ before two images count as
  different. It governs `--check`, `--assert-clean`, **and whether a file is
  rewritten at all** — without that last part the 3D shots would dirty the diff
  on every run. 10% is a little over twice the 1.7–4.3% that text rasterisation
  alone moves between machines, and well clear of the noisiest shot in the set
  (`home-hero`, 1.7–2.1% between consecutive runs). The cost is blunt and worth
  knowing: a change confined to a small part of one image — a track's colour, a
  renamed label — now passes silently. What still fails is what a reader would
  notice: a row appearing or vanishing, a reflow, a viewer that did not render.

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
  requesting its model_, leaving a blank pane that looks like a missing-data
  problem. `structure-id` cannot see that — it names the entry the pane
  _asked_ for, not what Mol\* drew — so `ready.mjs` photographs the canvas and
  fails the shot when every pixel is the same colour. The flags are applied only to structure shots, in a
  separate browser: with them on, the ordinary Nightingale track canvases never
  stop redrawing and no other shot reaches pixel stability. Mol\* also settles
  to marginally different anti-aliasing per run (~0.3% of pixels), so such a
  shot needs a `tolerance`.
- **What the 3D pane shows is resolved over three hops**, and a broken one is
  silent. For P05067 the viewer asks `rest.uniprot.org` for cross-references,
  3D-Beacons for a model list, then the PDBe model server for the bcif. Which
  entry it lands on is pinned by the shot's `structureId` (**1AAP**) rather than
  left to the pane's own ordering. If `rest.uniprot.org` cannot be reached it
  falls back to the AlphaFold model instead: a different picture, no error. If
  the structure images change, check that first.
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

If a capture reports an unpinned URL, pin what the run found:

```sh
yarn screenshots --record-missing --no-build   # then re-run to capture
node scripts/screenshots/record-cli.mjs "https://example.org/new/endpoint"
```

Read the URL before recording it. **An unpinned URL that appears without the
fixtures having changed means the code changed what the viewer fetches** — a
different structure, source or endpoint — and recording it pins the new
behaviour into the figures without anyone having looked at them. That is how
`mappings/uniprot/9UMH` showed up: a change of sort order moved the 3D pane onto
another PDB entry, which the shots now pin explicitly (`structureId`).

## Licensing

Fixtures are third-party data — UniProt (`rest.uniprot.org`, the Proteins API),
InterPro, PDBe (structure mappings and the bcif model) and AlphaFold — stored
solely to make documentation builds reproducible. The Open Sans web font under
`fixtures/net/fonts.gstatic.com/` is used under the SIL Open Font License.
