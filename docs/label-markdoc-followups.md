# Markdoc `label` surface — hardening status & remaining decisions

## Context

Group/track `label` was changed from a plain (lit-escaped) string to a
**Markdoc inline source string** rendered through `renderLabel()` in
`src/tooltips/resolve.ts` (see the `## Unreleased` entry in `CHANGELOG.md`).
An `xhigh` code review of that change surfaced a cluster of
correctness/security regressions and cleanups.

**Most of them are now fixed on this branch** (see below). Two items remain
open because they are genuine product/authoring decisions, not mechanical
fixes — those are the follow-up to file as a GitHub issue.

---

## Resolved on this branch

Each fix landed with a test in `src/tooltips/__spec__/label.spec.ts` (or
`src/__spec__/render-target.spec.ts` for the click handler).

| # | Fix | Where |
| - | --- | ----- |
| 1 | Markdown **image** nodes no longer render an unsanitized `<img src>` — the `image` node is neutralized (degrades to nothing), and `renderNode` now scheme-sanitizes `src` as well as `href`. | `resolve.ts` — `labelMarkdocConfig.nodes.image`, `renderNode` |
| 2 | **Protocol-relative** (`//host`) links are treated as external, so they get `target="_blank" rel="noopener noreferrer"` (no more page-navigation / tabnabbing gap). | `resolve.ts` — `labelLinkNode` |
| 3 | A **link inside a group label** no longer both navigates *and* toggles the group — `handleGroupClick` bails when the click landed on an `<a>`. | `protvista-uniprot.ts` — `handleGroupClick` |
| 4 | A label link `sanitizeUrl` drops to an empty href (bare relative path, unsupported scheme) now **warns** instead of rendering a silent dead link. | `resolve.ts` — `labelLinkNode` |
| 6 | An out-of-charset **help slug** now **warns** (instead of silently losing `data-article-id` and its popover). The shipped slugs already fit the allowlist, so no widening was needed. | `resolve.ts` — `helpTag.transform` |
| 7 | `warnOnBlockNodes` no longer floods the console every render — the memo cache (see #8) collapses the warning to once per unique label. | `resolve.ts` — `renderLabel` cache |
| 8 | `renderLabel` is **memoized** by `accession`+`source`, so labels are parsed through Markdoc once, not on every reactive re-render. | `resolve.ts` — `labelRenderCache` |
| 9 | The block-node list is no longer duplicated — `labelMarkdocConfig` and `LABEL_BLOCK_NODE_TYPES` both derive from a single `LABEL_BLOCK_NODES` const. | `resolve.ts` |

(The review's original numbering is preserved; #5 is below.)

---

## Remaining — needs a product / authoring decision (file as an issue)

### A. Literal `{accession}` in label text (review #5)

- **Location:** `src/schema/validate.ts` `containsAccessionPlaceholder` (group
  label ~L238, track label ~L243); substitution in `renderLabel`.
- **Behavior:** validation now treats `{accession}` in a `label` as a required
  placeholder, and `renderLabel` substitutes it pre-parse. A config whose label
  text legitimately contains the literal `{accession}` (rendered verbatim
  before) now either fails the whole load with `missing-accession` (no accession
  set) or silently renders the substituted value.
- **Why it's not auto-fixed:** `{accession}` is already the reserved placeholder
  everywhere else (`sources`, `url`, and now `label`), so the current behavior is
  arguably correct and consistent — "fixing" it means **deciding** whether a
  literal `{accession}` in a label is a real use case and, if so, adding an
  escape (e.g. `{{accession}}` → literal `{accession}`) honored in both the
  validator scan and `renderLabel`.
- **Decision:** (a) document `{accession}` as reserved in labels too (no code),
  or (b) add and honor an escape. If (b): update `containsAccessionPlaceholder`
  and `renderLabel`, and add a test that an escaped literal survives to output
  and does not trigger `missing-accession`.

### B. Existing plain-text labels are reinterpreted as Markdown (review "design note")

- **Location:** `renderLabel` (the refactor itself).
- **Behavior:** labels are now Markdoc-parsed, so an existing label containing
  paired markdown punctuation (`*de novo* synthesis`, `_lac_ operon`, backticks)
  has that punctuation consumed and wrapped in `<em>`/`<strong>`/`<code>`. This
  is the intended mechanism of the feature, **not a defect** — but it is a real
  breaking change for external adopters whose labels were authored as plain text.
  The bundled `default-config.yaml` labels are controlled and already migrated,
  so only third-party configs are affected.
- **Decision:** (a) accept as breaking (the `CHANGELOG` already calls it out) and
  document that adopters escape metacharacters (`\*`, `` \` ``), or (b) add a
  migration lint that flags labels whose Markdoc render differs from their
  literal text so adopters can find the ones that will reinterpret.

---

## Verification (for any further change)

- `npx tsc --noEmit` — clean
- `npx vitest run` — green (add a test for the change)
- `npx eslint 'src/**/*.ts'` — clean
- Label behavior is pinned in `src/tooltips/__spec__/label.spec.ts`.
