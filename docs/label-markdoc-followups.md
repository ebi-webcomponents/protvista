# Follow-up: harden the Markdoc `label` surface

## Context

Group/track `label` was recently changed from a plain (lit-escaped) string to a
**Markdoc inline source string** rendered through `renderLabel()` in
`src/tooltips/resolve.ts`, with the `helpPage` and `labelUrl` fields removed
(see the `## Unreleased` entry in `CHANGELOG.md`). An `xhigh` code review of that
change surfaced a cluster of correctness/security regressions and cleanups **in
the implementation** that were deliberately left out of the test-migration branch
that shipped the coverage.

This document tracks those follow-ups. Each item below is self-contained: it
names the exact location, the reproduction, a suggested fix, and the test to add.
Every fix **must** land with a test (the label pipeline now has a dedicated spec:
`src/tooltips/__spec__/label.spec.ts`).

**Ground rules for whoever picks this up**
- Labels are a single-line, inline-only surface. The intended allowed nodes are
  text, `em`, `strong`, `code`, links, and the `{% help %}` tag — nothing else.
- All URL output must go through `sanitizeUrl` (`src/utils/security.ts`); all text
  through `escapeHtml`. `renderNode` in `resolve.ts` is the render boundary.
- After each change: `npx tsc --noEmit` (clean), `npx vitest run` (green),
  `npx eslint 'src/**/*.ts'` (clean).

Key files:
- `src/tooltips/resolve.ts` — `renderLabel`, `labelMarkdocConfig`, `labelLinkNode`,
  `helpTag`, `HELP_SLUG_PATTERN`, `warnOnBlockNodes`, `renderNode`.
- `src/protvista-uniprot.ts` — `handleGroupClick`, the group/track/standalone
  label render paths.
- `src/schema/validate.ts` — `containsAccessionPlaceholder`.

---

## P1 — Security

### 1. Markdown image nodes render an unsanitized `<img src>`

- **Location:** `src/tooltips/resolve.ts` — `labelMarkdocConfig.nodes` (no `image`
  override) + `renderNode` (only `a[href]` is passed through `sanitizeUrl`).
- **Severity:** high (uncontrolled external request / tracking-pixel vector, and
  it violates the documented inline-only surface).
- **Current behavior:** `renderLabel('![x](https://third-party.example/pixel.png)')`
  returns `<img src="https://third-party.example/pixel.png" alt="x">`. The `src`
  is HTML-escaped but **not** scheme-sanitized, and it is emitted into the label
  row via `unsafeHTML`, firing a network request on every render.
- **Fix (primary):** neutralize Markdoc's default `image` node in
  `labelMarkdocConfig.nodes` so images never render — e.g. add
  `image: inlineOnly(Markdoc.nodes.image)` so an image degrades to its alt text,
  consistent with how block nodes are already collapsed. (Images are outside the
  documented inline surface, so dropping them to alt text is the right call.)
- **Fix (defense-in-depth):** in `renderNode`, do not rely on the node allowlist
  alone — route any URL-bearing attribute through `sanitizeUrl` (at minimum `src`
  as well as `href`), or hard-drop tags not on an explicit allowlist
  (`a`, `em`, `strong`, `code`, `span`). Today only `name === 'a' && attr === 'href'`
  is sanitized (`resolve.ts:81`).
- **Test:** `renderLabel('![x](https://evil.example/p.png)')` must not contain
  `<img` (or must contain no un-sanitized `src`); `renderLabel('![x](javascript://…)')`
  likewise.

### 2. Protocol-relative links bypass the new-tab / `rel=noopener` guard

- **Location:** `src/tooltips/resolve.ts` — `labelLinkNode`, external check
  `const external = /^https?:\/\//i.test(href)` (~line 179).
- **Severity:** high (reverse tabnabbing + the whole viewer page navigates away).
- **Current behavior:** a label `[Docs](//example.com/help)` is classified as
  **internal** (the regex requires an explicit `http`/`https` scheme).
  `sanitizeUrl` allows `//host` (it starts with `/`), so the rendered
  `<a href="//example.com/help">` has **no** `target="_blank"` and **no**
  `rel="noopener noreferrer"` — clicking navigates the host application away and
  exposes reverse tabnabbing.
- **Fix:** treat protocol-relative URLs as external. Change the check to
  `const external = /^https?:\/\//i.test(href) || (typeof href === 'string' && href.startsWith('//'));`
  so `//host` links get `target="_blank" rel="noopener noreferrer"` like any other
  off-site link.
- **Test:** `renderLabel('[x](//example.com)')` → the `<a>` has `target="_blank"`
  and `rel="noopener noreferrer"`.

---

## P2 — Correctness

### 3. Group-label links both navigate *and* toggle the group

- **Location:** `src/protvista-uniprot.ts` — `handleGroupClick` (~line 1039) bound
  via `@click` on the group-label div (~line 936); labels can now contain `<a>`.
- **Severity:** medium (confusing UX; following a link collapses/expands the group).
- **Current behavior:** for a group label like `[Docs](https://x/{accession})`,
  clicking the link opens the URL **and** the bubbled click reaches
  `handleGroupClick`, whose `closest('[data-group-toggle]')` resolves to the header
  and flips the collapsed/expanded state.
- **Fix:** early-return from `handleGroupClick` when the click originated on (or
  inside) a link, before the toggle logic:
  ```ts
  handleGroupClick(e: MouseEvent) {
    if ((e.target as Element).closest('a[href]')) return; // let the link navigate, don't toggle
    const host = (e.target as Element).closest('[data-group-toggle]');
    ...
  }
  ```
- **Test:** dispatch a click whose `target` is an `<a>` inside a
  `[data-group-toggle]` host → `openGroups` is unchanged. (The existing
  `handleGroupClick` describe in `render-target.spec.ts` is the place to add it.)

### 4. Relative-path label links render dead (`href=""`)

- **Location:** `src/tooltips/resolve.ts` — `renderNode` → `sanitizeUrl`
  (`src/utils/security.ts:36`).
- **Severity:** medium.
- **Current behavior:** `sanitizeUrl` only treats strings starting with `/`, `#`,
  or `?` as relative; anything else runs `new URL(str)` with no base, which throws
  for a bare relative path, so `renderLabel('[Docs](docs/help.html)')` returns
  `<a href="">Docs</a>` — a dead link.
- **Fix (decide policy):** the removed `labelUrl` field was always an absolute
  template, so absolute / root-relative is the expected form. Either (a) document
  that label links must be absolute or root-relative (`/…`, `#…`) and **warn** when
  a label link's href sanitizes to empty (so authors see it), or (b) if bare
  relative links should be supported, resolve them against `document.baseURI` inside
  a label-specific sanitizer rather than loosening the shared `sanitizeUrl` (which
  tooltips also use). Prefer (a) unless there is a concrete need for (b).
- **Test:** whichever policy is chosen, assert it (e.g. `[x](docs/help.html)` warns
  and drops, or resolves against the base).

### 5. `{accession}` in label *text* now changes behavior

- **Location:** `src/schema/validate.ts` — `containsAccessionPlaceholder`
  (group label ~line 238, track label ~line 243); substitution in
  `renderLabel` (`resolve.ts` — `source.split('{accession}').join(accession)`).
- **Severity:** medium, config-dependent (PLAUSIBLE in review).
- **Current behavior:** validation now scans `label` for `{accession}`, and
  `renderLabel` substitutes it pre-parse. A config whose label text legitimately
  contains the literal `{accession}` (rendered verbatim before) now either fails
  the whole load with `missing-accession` (no accession set) or silently rewrites
  `Region {accession}` → `Region P05067`.
- **Fix (decide policy):** `{accession}` is already the reserved placeholder across
  `sources`/`url`/`label`, so treating it consistently in labels is defensible —
  in which case just **document** it as reserved. If a literal is needed, add an
  escape (e.g. `{{accession}}` → literal `{accession}`) and honor it in both the
  validator scan and `renderLabel`.
- **Test:** whichever policy — e.g. an escaped literal survives to output and does
  not trigger `missing-accession`.

### 6. Out-of-charset help slugs silently drop `data-article-id`

- **Location:** `src/tooltips/resolve.ts` — `helpTag.transform` +
  `HELP_SLUG_PATTERN = /^[a-zA-Z0-9_#-]+$/` (~line 145 / 160).
- **Severity:** medium, migration-facing (PLAUSIBLE in review).
- **Current behavior:** the old `helpPage` accepted any string verbatim. A migrated
  slug containing a character outside the allowlist (e.g. `structure/models`, or a
  `.`/`:`-bearing slug) fails the transform's re-check and renders a `<span>` with
  **no** `data-article-id`, so uniprot.org's help-popover controller never fires —
  silently, with no error.
- **Fix:** (a) audit the real `helpPage` slugs that existed pre-migration and widen
  `HELP_SLUG_PATTERN` to cover every character they actually use; and (b) emit a
  one-time `console.warn` when a `{% help %}` slug fails the pattern, so a bad
  migration is visible instead of silent. Keep the charset restrictive enough to
  stay an XSS-defense-in-depth signal (the attribute value is still `escapeHtml`'d
  by `renderNode`).
- **Test:** a slug with an out-of-charset char warns and drops `data-article-id`;
  every real shipped slug (from `default-config.yaml`) passes and keeps it.

---

## P3 — Behavior / efficiency

### 7. `warnOnBlockNodes` floods the console (fires every render, not once)

- **Location:** `src/tooltips/resolve.ts` — `warnOnBlockNodes` (~line 251) called
  from `renderLabel` (~line 282), which runs inside `render()`.
- **Severity:** medium (console spam during normal interaction; contradicts the
  "warn once" claim in the comment and CHANGELOG).
- **Current behavior:** `render()` re-runs on every reactive change (group
  expand/collapse via `openGroups`, zoom/pan via `displayCoordinates`), so a
  block-markup label re-parses and re-emits the identical `console.warn` on every
  frame. There is no de-duplication.
- **Fix:** dedupe. Either (a) a module-level `Set<string>` of already-warned label
  sources (`if (warned.has(source)) return;` … `warned.add(source)`), or (b) fold
  it into the memoization from item 8 so each unique label parses — and warns —
  exactly once.
- **Test:** call `renderLabel('# Heading')` twice with the same source; assert
  `console.warn` is called at most once.

### 8. `renderLabel` re-parses every label on every render (no memoization)

- **Location:** `src/tooltips/resolve.ts` — `renderLabel` runs
  `Markdoc.parse` + `Markdoc.transform` + `renderNode` with no cache; invoked at
  `src/protvista-uniprot.ts` ~853 (standalone), ~938 (group), ~989 (track).
- **Severity:** low/medium efficiency (the no-cache fact is CONFIRMED; the
  interaction-jank impact was judged PLAUSIBLE — labels are static so the win is
  real but bounded).
- **Current behavior:** on the full ~15-group/65-track config, each reactive
  re-render re-parses every visible label from scratch, where the pre-refactor path
  was plain string interpolation.
- **Fix:** memoize by a stable key. Labels are static per config, so a small
  module-level `Map<string, string>` keyed on `` `${accession ?? ''} ${source}` ``
  suffices:
  ```ts
  const labelCache = new Map<string, string>();
  export function renderLabel(source: string, accession?: string): string {
    if (!source) return '';
    const key = `${accession ?? ''} ${source}`;
    const hit = labelCache.get(key);
    if (hit !== undefined) return hit;
    // …existing parse/transform/render…
    labelCache.set(key, out);
    return out;
  }
  ```
  This also resolves item 7 (parse + warn happen once per unique key). Consider a
  size bound only if configs with unbounded distinct labels are expected.
- **Test:** spy on `Markdoc.parse` (or assert via a warn counter) that a repeated
  `renderLabel(source, accession)` parses once.

---

## P4 — Cleanup

### 9. Block-node type list is duplicated

- **Location:** `src/tooltips/resolve.ts` — `labelMarkdocConfig.nodes`
  (inlineOnly overrides, ~lines 218-235) and `LABEL_BLOCK_NODE_TYPES`
  (~lines 246-249) enumerate the same 12 block nodes independently.
- **Severity:** low (drift risk: adding a node to one list but not the other either
  leaks a block wrapper into a label row or drops the warning).
- **Fix:** derive both from one source of truth:
  ```ts
  const LABEL_BLOCK_NODES = [
    'heading', 'fence', 'blockquote', 'list', 'item', 'hr',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
  ] as const;

  const labelMarkdocConfig = {
    nodes: {
      document: inlineOnly(Markdoc.nodes.document),
      paragraph: inlineOnly(Markdoc.nodes.paragraph),
      link: labelLinkNode,
      ...Object.fromEntries(
        LABEL_BLOCK_NODES.map((n) => [n, inlineOnly(Markdoc.nodes[n])])
      ),
    },
    tags: { help: helpTag },
  };

  const LABEL_BLOCK_NODE_TYPES = new Set<string>(LABEL_BLOCK_NODES);
  ```
- **Test:** existing block-markup label tests in `label.spec.ts` still pass.

---

## Design note (not a code change) — Markdown reinterpretation of existing labels

The review's top-ranked CONFIRMED finding is that this refactor is inherently
breaking: labels are now Markdoc-parsed, so any existing label containing paired
markdown punctuation (`*de novo* synthesis`, `_lac_ operon`, backticks) has that
punctuation consumed and wrapped in `<em>`/`<strong>`/`<code>`. This is the
intended mechanism of the feature, not a defect to "fix" — but it is a real
breaking change for external adopters whose labels were authored as plain text.

Options (pick one, then document it):
1. Accept as breaking; the CHANGELOG already calls it out. Adopters escape
   metacharacters (`\*`, `` \` ``) in their configs.
2. Add a migration lint/warning that flags labels whose Markdoc render differs
   from their literal text, to help adopters find labels that will reinterpret.

The bundled `default-config.yaml` labels are controlled and already migrated, so
this only affects third-party configs.

---

## Verification checklist (for each fix)

- [ ] `npx tsc --noEmit` — clean
- [ ] `npx vitest run` — green (new test added for the fix)
- [ ] `npx eslint 'src/**/*.ts'` — clean
- [ ] `renderLabel` output re-checked in `src/tooltips/__spec__/label.spec.ts`
