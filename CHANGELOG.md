# Changelog

## Unreleased

### Breaking — internal CSS classes and DOM ids are now hash-prefixed

`<protvista-uniprot>` renders in light DOM (required by Mol*), so its
stylesheet lives in the document's global selector scope. To make its
class names collision-proof against consumer and child-component styles,
every internal class name and wrapper/wiring DOM id now carries a
package-specific hash prefix, `pv-cecb45-` (derived from
`sha1('protvista-uniprot@' + version)`, exposed as `CSS_PREFIX` in
`src/styles/css-prefix.ts`). The rules remain tag-scoped under
`protvista-uniprot` as defence-in-depth.

**Migration.** If you override ProtVista's styling from your own
stylesheet, update the selectors:

| Before                             | After                                          |
| ---------------------------------- | ---------------------------------------------- |
| `.group`                           | `.pv-cecb45-group`                             |
| `.group-label`                     | `.pv-cecb45-group-label`                       |
| `.group__track`                    | `.pv-cecb45-group__track`                      |
| `.track-label`                     | `.pv-cecb45-track-label`                       |
| `.track-content`                   | `.pv-cecb45-track-content`                     |
| `.track-content__coloured-sequence`| `.pv-cecb45-track-content__coloured-sequence` |
| `.nav-container`                   | `.pv-cecb45-nav-container`                     |
| `.nav-track-label`                 | `.pv-cecb45-nav-track-label`                   |
| `.credits`                         | `.pv-cecb45-credits`                           |
| `.aggregate-track-content`         | `.pv-cecb45-aggregate-track-content`          |

Wrapper element ids (`group_<id>`, `track_<id>`) and the Nightingale
wiring ids (`track-<id>`) gained the same prefix (e.g.
`#pv-cecb45-group_DOMAINS`). The `<id>` portion — which comes from your
config — is unchanged.

**Not affected:**

- `.feature` is unchanged. The host never applies this class itself (it
  styles feature glyphs rendered by Nightingale child components), so
  prefixing it would simply stop it matching.
- The `.proforma` and `.mod-link` rules were **removed** — they were
  dead (their emitter, `src/tooltips/feature-tooltip.ts`, was deleted in
  the tooltip refactor).
- The `data-group-toggle` / `data-article-id` attributes, the
  `.protvista-tooltip` popover classes, and the loader/no-results
  classes are unchanged.

### Added — user-facing error surfaces

Errors no longer dead-end at `console.*` behind a silent blank render.
Three user-facing channels sit on top of the unchanged developer
`console.*` output (all routed through one shared reporter so the message
text stays in lockstep):

- **Mount-level error panel.** A config-validation failure or a
  sequence-fetch failure now renders a visible `role="alert"` panel
  (one-line summary and a collapsible per-issue list with `path` /
  `message` / `code`) instead of a blank element. Focus moves to the
  panel on appear. A fatal error (bad config / no sequence — nothing to
  reveal) offers no dismiss; a warning promoted under `strict` is
  dismissible, and dismissing restores focus and reveals the viewer.
  The top-level **sequence** fetch now applies the same broken-vs-missing
  distinction as per-track fetches: a **broken** fetch (`network` / HTTP
  `5xx` / unparseable) shows _"the UniProt data service is unreachable or
  failing…"_ with a **Retry** button that re-runs the mount in place,
  while a **missing** entry (HTTP `4xx`, or a `2xx` with no `sequence`)
  shows _"No UniProt entry found for 'X'. Check that the accession is
  correct."_ with no Retry. Previously every sequence failure — server
  down, offline, or a genuine typo — showed one identical "check the
  identifier" message with no way to retry. The `sequence` event now
  carries `context.errorKind` (+ `status`).
- **Per-track error badge.** The distinction is *broken* vs *missing*. A
  track whose data is **broken** shows a keyboard-focusable `⚠` badge
  (detail via `aria-describedby` and `title`). Failures are classified:
  `network` (unreachable — blocked, offline, DNS, CORS, timeout), `http`
  (a 4xx/5xx response), or `parse` (a 2xx body that failed to parse).
  "Broken" is `network`, `parse`, and HTTP `5xx` — a real transport or
  server problem the user should know about; these always surface, with
  no opt-in. Recoverable ones (`network`, HTTP `5xx`) also get a **Retry**
  button that re-fetches only that track; a `parse` failure is
  deterministic, so its badge carries no Retry. A track whose data is
  merely **missing** — an HTTP `4xx` such as a 404 "no data for this
  accession" — is treated exactly like an empty 2xx response: the track
  is hidden, with no badge, no `protvista-error` event, and no panel.
  There is no flag to surface 4xx; "missing" is deliberately invisible. A
  collapsed group whose tracks (all or some) are broken shows a summary
  badge on its header, so failures aren't hidden behind the collapse.
- **`protvista-error` event.** A bubbling `CustomEvent('protvista-error',
  { detail: { phase, issues, context } })` fires for every *broken* error
  (a 4xx "missing" fires nothing), so embedders route errors into their
  own UI with one listener. `phase` is one of `config` / `sequence` /
  `track-fetch` / `set-track-data` / `transform-calculate` /
  `tooltip-field-miss`; for `track-fetch`, `context.errorKind` carries
  the `network` / `http` / `parse` classification.

Also adds `strict?: boolean` (promote every warning to the mount panel;
default `false`) and a tree-shakeable, lazily-loaded `src/errors/format.ts`
issue formatter (its own ~0.3 kB gzip chunk — the happy path never loads
it). See the _Error events_ section in `specs/config-approach.md`.

Two fixes make the per-track error surfacing actually reach the screen:

- **Error-only groups are now revealed.** Groups render `display: none` by
  default and are shown imperatively only once they have data. A group
  whose data all failed to load (e.g. Variants when its API is blocked)
  therefore rendered its header + ⚠ badge into the DOM but stayed
  `display: none` — it looked like the group had vanished. `updated()`
  now also reveals any group with a visible fetch error.
- **The loader is resilient to a throwing adapter.** The per-track
  pipeline is isolated in `loadProtvistaData`, so an adapter that throws
  on an unexpected payload (e.g. the empty body a blocked/failed fetch
  leaves — the AlphaFold/AlphaMissense parsers are prone to this)
  degrades just that track to empty instead of rejecting the whole load.
  Previously one throwing adapter aborted the batch before the
  error-correlation pass, suppressing *all* badges and events. (Hardening
  those parsers at the source is tracked in
  `specs/alphafold-alphamissense-adapter-hardening.md`.)
