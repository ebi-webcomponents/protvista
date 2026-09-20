# Adapter model — decision brief

**Status: decided — Option B.** Two follow-on calls were made with it:

- **No alias layer.** The complete change (code, schema, docs, playground,
  starter kit) merges by ~1 Oct, before the 7–9 Oct hackathon, and the ten grid
  adapter names are deleted outright. The hackathon mints the first external
  configs; they will be written against the final vocabulary.
- **`registerSemanticKind()` gains `shape`**, so a consumer-defined kind gets
  the file / inline / `format:` path too. This is a public-API addition.

The normative design now lives in **"Shape and format (normative)"** in
[`config-approach.md`](./config-approach.md). This document is kept as the
decision record — the reasoning and the rejected alternative — not as a spec.

Implementation status: appendix item 1 (the inline/custom bypass) is **fixed and
landed** independently, per the sequencing below. The refactor itself has not
started; the branch still implements Option A in full and working form.

**The question:** ProtVista's bring-your-own-data surface currently names one
*adapter* per (record shape × file encoding) pair. Should we keep that, or
split the two axes apart and let the pair be computed?

**Who should weigh in:** anyone with an opinion on the config vocabulary
authors write, or on how much public surface we're willing to churn before
there are consumers.

---

## Background: the three words in play

| Word | Means | Who writes it |
| --- | --- | --- |
| **kind** | What a track *is*, in domain terms: `features`, `variants`, `linegraph`. Resolves to a Nightingale component plus a data adapter. | The author. It's the one required word. |
| **adapter** | A named function turning a fetched body into what the component renders. | Rarely — it's documented as an escape hatch. |
| **component** | The Nightingale custom element. | Effectively never. |

The design intent, stated in `specs/config-approach.md`, is that *"authors only
write domain language … never Nightingale component names or adapter names."*

Two things already shipped on this branch are assumed by both options below:

- **Per-kind families.** A kind now declares which file formats it reads, so
  `kind: variants` + `./my-variants.csv` works and the kind — not the file
  extension — owns adapter selection. There is no precedence rule between
  `kind:` and a file extension.
- **The naming rule.** A kind keeps a plain domain word (`features`,
  `variants`) only if an author can bring their own data to it; a kind that
  can only read one provider's feed is named for that provider
  (`alphafold-confidence`, formerly `confidence-score`). A drift test enforces
  this.

---

## The problem

Ten adapter names exist today for author-supplied data:

```
features-csv   features-tsv   features-json   bed
linegraph-csv  linegraph-tsv  linegraph
variation-csv  variation-tsv  variation
```

That is not a list. It is a **grid** — record shape × encoding:

| | JSON | CSV | TSV | BED |
| --- | --- | --- | --- | --- |
| **feature records** (`type`, `start`, `end`) | `features-json` | `features-csv` | `features-tsv` | `bed` |
| **point records** (`position`, `value`) | `linegraph` | `linegraph-csv` | `linegraph-tsv` | — |
| **variation records** (`position`, `variant`) | `variation` | `variation-csv` | `variation-tsv` | — |

Every cell is a name someone must invent, register, document, and keep
synchronised across four tables. A new record shape costs three names; a new
encoding costs three more. These names also share a registry with
`uniprot-variation-json` and friends, which are a different animal entirely —
provider-specific transforms, not file parsers.

The grid is also why the same design question keeps recurring in different
clothes. *"Does the file extension or the `kind` win?"* is only a question
because both are trying to name a cell. *"Should inline data support CSV?"* is
only a question because inline text has no extension to name a cell with.

The two axes are independent, and each already has an obvious owner:

- **Which records the track needs** — the **kind** knows. `variants` draws
  residue changes; `features` draws intervals. A file cannot change that.
- **How those records are encoded** — the **file** knows. Its extension says
  `.csv`; a pasted block says "text"; an API says JSON.

They were crossed into a single name. That's the whole defect.

---

## The two options

### Option A — keep the grid (status quo, working today)

Each (shape, encoding) pair keeps its own adapter name. The kind declares a
*family* — a map from file extension to the adapter that parses it — and the
extension selects within that family.

### Option B — split the axes

A kind declares the **record shape** it needs. A source declares its
**format**. The adapter is computed from the pair rather than named.

Resolution becomes four lines, with no precedence rule to explain:

```
explicit adapter:            → use it
kind declares a shape
  + source declares a format → decode by format, validate against the kind's shape
  + no format                → the kind's provider adapter (a UniProt URL, say)
kind declares no shape       → provider adapter only; a file is a config error
```

`format` becomes a real author-facing word, but surfaces **only when nothing
can infer it** — inline text, or a URL with no extension.

---

## Side by side

### 1. The common case — my own features file

```yaml
# A                                  # B
- id: hotspots                       - id: hotspots
  kind: features                       kind: features
  data: ./hotspots.csv                 data: ./hotspots.csv
```

**Identical.** Same for `.tsv`, `.json`, `.bed`, and for every kind that has a
shape. This is the 90% case: Option B is not a tax on beginners.

### 2. My own variants file

```yaml
# A                                  # B
- id: cohort                         - id: cohort
  kind: variants                       kind: variants
  data: ./my-variants.csv              data: ./my-variants.csv
```

**Identical.** A picks `variation-csv` from a family table; B computes
decode(csv) → shape(variation). The author sees neither.

### 3. Pasted straight out of Excel (which copies as tab-separated)

```yaml
# A                                  # B
- id: depth                          - id: depth
  kind: linegraph                      kind: linegraph
  data:                                data:
    from: inline                         from: inline
    adapter: linegraph-tsv               format: tsv
    inlineData: |                        inlineData: |
      position	value                      position	value
      1	412                                1	412
```

First divergence. **A** requires an *adapter name*, and a different one per
kind — `variation-tsv` on a variants track, `features-tsv` on a features
track. **B** requires the author to state what their data *is*, using the same
word on every kind.

### 4. An API serving CSV from a URL with no extension

```yaml
# A                                  # B
  kind: features                       kind: features
  data:                                data:
    url: https://lab.ex/api/hits         url: https://lab.ex/api/hits
    adapter: features-csv                format: csv
```

Same divergence. Note this case has **no non-adapter answer in A at all**.

### 5. A file whose name lies (`.txt` containing CSV)

```yaml
# A                                  # B
    adapter: features-csv                format: csv
```

### 6. Wrong file for the kind — `kind: variants` pointed at `./regions.bed`

**A** — the message the validator emits today:

> Semantic kind 'variants' in track MINE/v cannot read '.bed' files: it
> resolves to adapter 'uniprot-variation-json', which expects a json body, and
> has no .bed adapter of its own. Kinds that read .bed files: 'features',
> 'interpro-features', 'peptides', 'peptides-ptm', 'structure-coverage'.
> Otherwise set an explicit 'adapter:' on the data descriptor.

**B:**

> BED files carry feature records (type, start, end); `kind: variants` draws
> residue changes (position, variant). Use `kind: features` for this file, or
> convert it.

A explains itself in terms of adapters and body types — the concepts the
author was promised they'd never need. B explains it in terms of their file and
their track.

### 7. Adding a new record shape (maintainer view — e.g. a heatmap family)

```ts
// A — three new names, five places
'heatmap' | 'heatmap-csv' | 'heatmap-tsv'        // KnownAdapterName
heatmap.ts, heatmap-csv.ts, heatmap-tsv.ts       // three thin wrappers
BUILTIN_ADAPTERS: [...three entries]
KIND_ADAPTER_VARIANTS['uniprot-…']: { '.csv': 'heatmap-csv',
                                      '.tsv': 'heatmap-tsv',
                                      '.json': 'heatmap' }
ADAPTER_REFERENCE: [...three entries]            // + drift tests

// B — one shape, declared once
rowsToHeatmapRecords() + toHeatmap()             // the actual new logic
['pathogenicity', { component: '…', shape: 'heatmap', adapter: 'uniprot-…' }]
```

### 8. How a kind is declared

```ts
// A — the fact is split across two files
['variants', { component: 'nightingale-variation-canvas',
               adapter:   'uniprot-variation-json' }]          // registry.ts

KIND_ADAPTER_VARIANTS = {                                       // file-formats.ts
  'uniprot-variation-json': { '.csv':  'variation-csv',
                              '.tsv':  'variation-tsv',
                              '.json': 'variation' }, … }

// B — one declaration says everything
['variants', { component: 'nightingale-variation-canvas',
               shape:     'variation',                // what a file of yours must contain
               adapter:   'uniprot-variation-json' }] // what the provider URL needs
```

---

## What Option B deletes

- **The ten adapter names above.** They become 4 decoders + 3 shapes —
  additive, not multiplicative. A new shape costs one thing; a new encoding
  costs one thing.
- **`KIND_ADAPTER_VARIANTS`**, the per-kind family table, and the drift test
  guarding it. The kind declares a shape; formats declare a decoder; the
  cross-product is computed.
- **The bring-your-own half of `KnownAdapterName`**, and with it a spec/type
  drift surface that has already gone stale once.
- **The kind-vs-extension precedence question**, which stops being expressible.
- **The inline-format question**, which answers itself: a YAML list is already
  records; a YAML string needs a `format:`. Same rule as a file, minus the
  filename.

It also fixes a case with no answer today (scenario 4) and improves the errors
in scenario 6.

## What Option B costs

- **A fourth word in the config vocabulary** (`format:`), even though it is
  written rarely.
- **A new rule when `format:` and the file extension disagree**
  (`./x.csv` + `format: tsv`). Proposed: explicit wins, with a warning.
- **BED is an encoding that also implies a shape.** Needs stating as a
  compatibility fact: BED produces feature records only.
- **Churn in the public surface** — adapter names disappear from the type
  union, the spec, the generated reference, and the docs. Free today because
  there are no consumers; never this cheap again.

## What Option A costs

- Adapter names leak to authors in exactly the situations a non-technical user
  hits first: pasted data, an extensionless URL, a misnamed file.
- The grid grows multiplicatively with every new shape or encoding.
- Three hand-maintained tables must agree; two drift tests exist purely to
  enforce that.
- Errors are phrased in adapters and body types rather than files and tracks.

---

## Recommendation

**Option B**, on the strength of scenarios 3, 4 and 6 — the cases where a
bench scientist gets stuck and A's only answer is "type an adapter name".

The refactor is smaller than it looks: `src/schema/adapters/dsv.ts` is
*already* split into decode (`parseDelimited`) and shape
(`rowsToFeatureRecords` / `rowsToPointRecords` / `rowsToVariationRecords`), and
`toSeries` / `toVariants` are already the shape→component step. The ten
adapters are thin wrappers pairing one decoder with one shaper; unwiring the
grid is mostly deletion and rewiring rather than new logic.

Option A is defensible if the priority is holding the config surface at three
words and treating scenarios 3–5 as advanced cases the docs route around.

---

## Appendix: related open items

These are independent of the decision, but scenario 3 above assumes the first
one is fixed under either option.

1. **`from: custom` and `from: inline` bypass the kind's adapter**
   (`src/load-data.ts:446`). `setTrackData()` with the published record
   contract hands raw records to the component; on a line-graph track that
   throws a `TypeError` inside an un-guarded loop, so every later track loses
   its data too. `from: inline` has the same gap for every family except
   `linegraph`.
2. **Group aggregate label is computed from the wrong tracks**
   (`src/protvista-uniprot.ts:2194`). The aggregate renders the group's first
   *configured* track but the label decision is passed the *visible* ones, so
   hover text and drawn series can disagree in both directions.
3. **A trailing blank line rejects a whole CSV** (`src/schema/adapters/dsv.ts`,
   three sites). `'type,start,end,description\nA,1,2,x\n\n'` → `row 3 is ragged`.
   That is the normal output of a spreadsheet export, and the blast radius grew
   when nine kinds gained CSV support.
4. **Prototype keys in the header index** (`dsv.ts:176`, `:293`). A column named
   `toString` / `constructor` / `valueOf` throws a false "duplicate header
   column". The newest parser uses a `Map` and is immune; the two older ones
   need the same change.
