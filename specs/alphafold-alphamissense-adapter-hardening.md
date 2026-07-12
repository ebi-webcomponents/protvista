# Spec: Harden the AlphaFold / AlphaMissense adapters

Status: **Proposed** (follow-on work)
Owner: _unassigned_
Related: `specs/generic-format-adapters.md`, `specs/config-approach.md` (Error events), the per-track loader-resilience fix in `src/load-data.ts`.

---

## 1. Context & motivation

The data loader (`loadProtvistaData`) was recently made **resilient to a throwing
adapter**: each track's adapter → filter → tooltip pipeline is wrapped in a
`try/catch`, so an adapter that throws degrades _that_ track to empty instead of
rejecting the whole `Promise.all` batch. Before that fix, a single throwing
adapter aborted the entire load _before_ the error-correlation pass, silently
suppressing **all** per-track badges and `protvista-error` events — so a blocked
track (e.g. Variants) could show no indicator at all.

That fix **contains the blast radius but does not remove the fragility.** The
AlphaFold / AlphaMissense adapters still throw on empty, malformed, or error
payloads, and their _internal secondary fetches_ fail silently (`console.error`
only), invisible to the error-surfacing layer. This violates the project's own
adapter contract:

> **Validation of the adapter's output shape.** The library trusts the parser;
> … Per-row validation lives in the parser itself (with diagnostic
> `console.warn`s, **not exceptions**).
> — `specs/generic-format-adapters.md` §4 (L61–64); see also L498: "Non-array
> input → `console.warn` + empty array."

This spec is the follow-on to bring these three adapters into conformance: they
must **never throw**, must distinguish "no data" from "couldn't load/parse", and
their internal fetch/parse failures must be observable.

---

## 2. Affected files

| File | Role |
| --- | --- |
| `src/adapters/alphafold-confidence-adapter.ts` | `confidence-score` kind → `alphafold-prediction-json` |
| `src/adapters/alphamissense-pathogenicity-adapter.ts` | `pathogenicity-score` kind → `alphamissense-average-csv`; also **exports the shared `rowSplitter` / `cellSplitter`** |
| `src/adapters/alphamissense-heatmap-adapter.ts` | `pathogenicity-heatmap` kind → `alphamissense-full-csv` |

All three are **two-argument** adapters: the config feeds them via
`data: { source: [alphafoldPrediction, proteins] }` (see `default-config.yaml`
groups `ALPHAFOLD_CONFIDENCE` / `ALPHAMISSENSE_PATHOGENICITY`), so the loader
calls `adapter.apply(null, [alphaFoldPayload, proteinPayload])`. The loader
substitutes a missing per-URL slot with `[]` (`rawData[u] || []`), so on a
blocked/failed sub-fetch an argument arrives as `[]` — or, on a 200-but-wrong
response, as an arbitrary object/string.

---

## 3. Goals

1. **No adapter throws for any input.** For null, `[]`, an error object, an HTML
   error page string, a wrong-arity call, a missing `protein`, or malformed CSV,
   the adapter returns `undefined` (the loader/renderer already treat that as
   "no data") — never an exception.
2. **Distinguish "no data" from "couldn't load/parse."** A legitimately empty
   result (no AlphaFold model / no AM annotations for this accession) hides the
   track. A transport/parse failure is surfaced as an error (badge + event),
   not silently hidden.
3. **Make internal secondary fetches observable.** The confidence-JSON and
   AM-annotations-CSV fetches happen _inside_ the adapter and bypass the loader's
   fetch instrumentation; their failures are currently swallowed to
   `console.error`. They must at least `console.warn` in lockstep with the
   developer channel and, ideally, surface through the error layer (§6, R4).

## 4. Non-goals

- Rewriting the adapters' output shapes or any Nightingale rendering.
- Moving the secondary fetch out of the adapter into the loader/config (a real
  altitude improvement — the adapter contract says adapters are pure transforms,
  not fetchers — but tracked separately; see §8).
- Adding retry/caching to the secondary fetches.

---

## 5. Failure-mode inventory (grounded in current code)

### 5.1 `alphafold-confidence-adapter.ts`

- **F1 — `data?.filter(...)` then `.length` (L33–36).** `data` null/undefined →
  `data?.filter` short-circuits to `undefined` → L36 `undefined.length` throws.
  `data` a truthy non-array (error object, HTML string) → `.filter is not a
  function` throws. _(This is the exact `data?.filter is not a function` seen
  when a 200-but-wrong payload reached the adapter.)_
- **F2 — `protein.sequence.sequence` (L34).** `protein` undefined or `[]`
  (blocked `proteins` sub-fetch, or a misconfigured single-source track) →
  `protein.sequence` is `undefined` → dereference throws. Runs only when `data`
  is a non-empty array.
- **F3 — `confidenceData?.confidenceCategory.join('')` (L44).** `confidenceData`
  a truthy non-shape (`{}`, an error body) → `.confidenceCategory` is
  `undefined` → `.join` throws. (An `undefined` `confidenceData` is safe via
  `?.`, but the shape past the first hop is unguarded.)
- **F4 — `loadConfidence` swallows failures (L12–21).** The `catch` returns
  `undefined` implicitly; a failed confidence fetch is logged to `console.error`
  and is otherwise invisible to the error layer.

### 5.2 `alphamissense-pathogenicity-adapter.ts`

- **F5 — same `data?.filter` + `protein.sequence.sequence` as F1/F2 (L116–120).**
- **F6 — `parseCSV` assumes string input (L44–93).** It _does_ guard the
  per-row match (`if (!match) continue`, L51–53) — good — but `rawText.split`
  assumes `rawText` is a string; a non-string secondary-fetch body throws. `+x`
  on non-numeric cells yields `NaN` silently (acceptable but note).
- **F7 — `loadAndParseAnnotations` swallows failures (L96–104)** (as F4).

### 5.3 `alphamissense-heatmap-adapter.ts`

- **F8 — same `data?.filter` + `protein.sequence.sequence` (L50–52).**
- **F9 — `parseCSV` destructures an unguarded `row.match` (L15–16).** Unlike
  the pathogenicity parser, the heatmap parser does **not** guard the match:
  `const [, , positionString, mutated, pathogenicityScore] = row.match(cellSplitter);`
  — a row that doesn't match returns `null`, and destructuring `null` throws
  "Cannot destructure property … of null". This is a distinct, higher-probability
  throw (any stray/blank/short line trips it).
- **F10 — `loadAndParseAnnotations` swallows failures (L28–38)** (as F4).

---

## 6. Requirements

**R1 — Guard the two adapter arguments.**
Add a single shared, fully-guarded helper (e.g. `matchAlphaFoldEntry(data, protein)`)
used by all three adapters that:
- returns `undefined` unless `Array.isArray(data) && data.length > 0`;
- reads the query sequence via optional chaining: `const seq = protein?.sequence?.sequence; if (!seq) return undefined;`
- filters for the single entry matching `seq` (plus `amAnnotationsUrl` for the AM adapters), and returns it — or `undefined` for 0 matches, `console.warn` + `undefined` for >1.
No `.filter` / `.length` / `.sequence.sequence` may run on a non-array or an
undefined value.

**R2 — Share and guard the CSV row parser.**
Extract the per-row parse (currently duplicated + divergent between the two AM
adapters) into one helper that guards the match (`if (!match) return undefined;`
/ `continue`). The heatmap parser (F9) must adopt the same guard the
pathogenicity parser already has (F6). Both parsers must tolerate a non-string
input by treating it as no-data.

**R3 — Guard the post-secondary-fetch shape.**
After the confidence/annotations secondary fetch, validate the shape before use:
`confidenceData?.confidenceCategory` must be an array before `.join('')`; a
missing/short field → `undefined` (no data), not a throw.

**R4 — Make secondary-fetch failures observable (coordinate with the error layer).**
The loader's `_collectTrackErrors` correlates only the loader's _own_ fetches
(via `LoadResult.trackUrls`); the confidence-JSON and AM-CSV fetches bypass it.
Minimum bar: the secondary loaders must not leave the caller to dereference a
swallowed `undefined`, and must `console.warn` (developer channel) on
transport/parse failure. Preferred: surface the failure through the existing
`protvista-error` event so it reaches a badge — e.g. by having the adapter throw
a **typed** `AdapterFetchError` that the loader maps to a `track-fetch` /
`parse` phase, or by returning a sentinel the loader interprets. Pick one, and
document it in `config-approach.md`'s _Error events_ section. (Whichever is
chosen, the outer adapter must still not propagate a raw exception — the loader's
per-track `try/catch` is a backstop, not the primary mechanism.)

**R5 — Empty vs. error.**
"No AlphaFold model / no AM annotations for this accession" (a legitimate empty
result) → `undefined` → track hidden, **no** error surfaced. Only
transport/parse failures surface as errors (R4). Do not conflate the two.

---

## 7. Proposed approach (non-binding sketch)

```ts
// shared/alphafold-match.ts
export function matchAlphaFoldEntry(
  data: unknown,
  protein: unknown,
  opts: { requireAmUrl?: boolean } = {}
): AlphaFoldEntry | undefined {
  if (!Array.isArray(data) || data.length === 0) return undefined;
  const seq = (protein as { sequence?: { sequence?: string } })?.sequence?.sequence;
  if (!seq) return undefined;
  const matches = data.filter(
    (e) => e?.sequence === seq && (!opts.requireAmUrl || e?.amAnnotationsUrl)
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) console.warn(`[protvista] >1 AlphaFold match for the query sequence`);
  return undefined;
}
```

Each `transformData` becomes: `const entry = matchAlphaFoldEntry(...); if (!entry) return undefined;` then the secondary fetch guarded per R3/R4. The CSV row
parser (R2) is a second shared helper.

---

## 8. Altitude note (for the reviewer, not blocking)

These adapters do **network I/O** (`loadConfidence`, `loadAndParseAnnotations`)
inside what the contract calls a "pure transform." That is the deeper reason
error surfacing can't see their failures. A cleaner long-term shape moves the
secondary URL into the config's data-source graph (so the loader fetches it and
its failures flow through `trackUrls` / `fetchErrors` like any other), leaving
the adapter a pure parser. Out of scope here, but this hardening should not
entrench the fetch-in-adapter pattern further than necessary.

---

## 9. Testing

Per-adapter unit tests (each of the three) asserting **no throw** and the right
degradation for every bad-input shape:
- `data` = `null`, `undefined`, `[]`, `{}` (error object), `"<html>…"` (error page string);
- `protein` = `undefined`, `[]`, `{}` (no `.sequence`), `{ sequence: {} }` (no inner `.sequence`);
- single-arg call (missing `protein`);
- malformed / blank / short CSV rows (heatmap F9), empty CSV, non-string CSV body;
- secondary fetch rejects; secondary fetch resolves 200-but-wrong-shape (F3).

Expected: returns `undefined` (no data) for empty/no-match; returns parsed output
for a valid payload (golden/snapshot test on a real fixture); **never throws**.

Loader-level:
- Extend/parallel the existing `adapter throw resilience` test in
  `src/__spec__/error-surface.spec.ts` with the real AlphaFold/AlphaMissense
  adapters + a blocked prediction/proteins URL: `loadProtvistaData` completes and
  the track degrades to empty; when R4 is implemented, a `track-fetch`/`parse`
  error surfaces.

Regression: the `adapter throw resilience` loader test stays green.

---

## 10. Acceptance criteria

- A `grep` over the three adapters shows no unguarded `.filter` / `.length` /
  `.sequence.sequence` on adapter arguments, and no unguarded destructure of a
  `row.match(...)` result.
- Feeding each adapter every §9 bad-input shape returns `undefined` without
  throwing (unit-tested).
- Blocking any AlphaFold/AlphaMissense-related URL surfaces a track/group error
  indicator (per R4) rather than silently disappearing — verified end-to-end.
- No behavior change for valid inputs (golden test on a real payload).
- The adapters conform to `generic-format-adapters.md`'s "diagnostic
  `console.warn`s, not exceptions" contract.
