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
