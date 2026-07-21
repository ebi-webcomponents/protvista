# Changelog

## Unreleased

### Deprecated — the top-level `groups:` config field is now `rows:`

The top-level entry list is renamed from `groups:` to `rows:`. That array
has held two kinds of entry since standalone single-row tracks landed — a
group (a collapsible cluster, has `tracks:`) and a standalone track (one
row on its own, has `data:`) — so `groups:` named it dishonestly. Every
top-level entry is one vertical lane; a group is simply an expandable
lane.

**Migration.** Rename the field. Nothing else about the entries changes:

```yaml
# Before                     # After
groups:                      rows:
  - id: DOMAINS                - id: DOMAINS
    tracks: [...]                tracks: [...]
```

`groups:` still works and is treated as an exact alias for `rows:`, but
loading a config that uses it now emits a one-time `console.warn`. The
alias will be **removed before the v5 schema is published** — one release
cycle from now.

Setting both `rows:` and `groups:` is a validation error
(`rows-alias-conflict`) rather than a silent preference for one: the two
lists would render very differently and the config gives no way to tell
which was meant.

**Not affected:** `tracks:` nested inside a group keeps its name — only
the top-level field is renamed. The post-load `NormalizedConfig` model
already exposes `rows` / `NormalizedRow`, so the authoring field and the
resolved model now agree.

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
