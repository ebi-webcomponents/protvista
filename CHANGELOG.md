# Changelog

## Unreleased

### Breaking — `label` is now a Markdoc string; `helpPage` and `labelUrl` removed

Group and track `label` is now a Markdoc **inline** source string rendered
through the same `@markdoc/markdoc` pipeline as `dataTooltip`. This collapses
the previous three-field label surface (`label` + `helpPage` + `labelUrl`) into
one: write Markdown, including a link if you want one. `{accession}` is
interpolated into the label before rendering (same substitution `labelUrl`
used). The allowed surface is inline only — emphasis, code, links, and a
registered `{% help %}` custom tag; block-level markup (headings, lists, code
fences, tables) is rejected with a console warning and degrades to inline text.

The `helpPage` and `labelUrl` fields have been **removed** from the schema
(`ConfigDefaults`, `GroupConfig`, `TrackConfig`).

**Migration.** Rewrite affected labels:

| Before                                                        | After                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `label: Signal peptide`<br>`helpPage: signal`                 | `label: '{% help slug="signal" %}Signal peptide{% /help %}'`                |
| `label: AlphaFold Confidence`<br>`labelUrl: https://x/{accession}` | `label: '[AlphaFold Confidence](https://x/{accession})'`               |

The `{% help slug="…" %}…{% /help %}` tag renders
`<span data-article-id="…">…</span>` — byte-identical to what `helpPage`
produced. External `http(s)` links in a label open in a new tab
(`target="_blank" rel="noopener noreferrer"`), matching the old `labelUrl`
anchor. `slug` is restricted to `^[a-zA-Z0-9_#-]+$`.

**uniprot.org embedders:** the in-page help popover keeps working **only if the
`{% help %}` tag stays registered** (it is, by default, in this package's label
renderer). The `data-article-id` DOM your help-article controller listens for is
unchanged. If you strip or fail to register the tag, help spans stop rendering
and the popovers break — that is the one visible DOM regression to watch for.

### Removed (breaking) — the top-level `groups:` config field is now `rows:`

The top-level entry list is `rows:`, and the deprecated `groups:` alias is
**removed** (no fold, no warning — a leftover `groups:` is now an unknown
property and fails validation). That array has held two kinds of entry
since standalone single-row tracks landed — a group (a collapsible
cluster, has `tracks:`) and a standalone track (one row on its own, has
`data:`) — so `groups:` named it dishonestly. Every top-level entry is one
vertical lane; a group is simply an expandable lane.

**Migration.** Rename the field. Nothing else about the entries changes:

```yaml
# Before                     # After
groups:                      rows:
  - id: DOMAINS                - id: DOMAINS
    tracks: [...]                tracks: [...]
```

**Not affected:** `tracks:` nested inside a group keeps its name — only
the top-level field is renamed. The post-load `NormalizedConfig` model
exposes `rows` / `NormalizedRow`, so the authoring field and the resolved
model agree.

### Added — no-code theming via the config `theme:` field

A new optional top-level `theme: { labelColor?, accentColor? }` recolours
the viewer chrome from the config — no CSS required. `labelColor` sets the
row-label side panel; `accentColor` sets focus rings and the datatable
active-row marker. Each maps to a `--protvista-*` design token the
component sets inline on the host at mount (beating the token defaults,
yielding to a consumer's own CSS). See `docs/theming.md`.

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
