---
title: Authoring dataTooltip
description: "'dataTooltip' configures per-datapoint tooltips using three forms: a 'bare-string' for simple one-line templates, a 'fields' form for a flat property sheet of labelled rows, or a 'markdown' form for full templates with prose and conditional logic, while  falling back to a default when fields are missing or empty."
---

`dataTooltip` controls the per-datapoint tooltip shown when a user clicks a feature on a track. It has three authoring forms, listed here from least to most expressive. Pick the simplest one that works — the rendering pipeline is the same for all three.

All three forms run through the same renderer: every field value is HTML-escaped at the leaf, link `href`s are routed through a scheme allowlist (`http:`, `https:`, `mailto:`, and values starting with `/`, `#` or `?` (a protocol-relative `//host/…` one links to that host); `javascript:`, `data:` and bare relative paths are dropped), and rich / interactive tooltips are not a config concern. If you need a custom React panel, evidence badges, taxonomy lookups, or any other stateful UI, listen for the Nightingale `change` event on the element and mount your own overlay, setting the `notooltip` attribute on `<protvista-uniprot>` to suppress the built-in popover.

When a track has no `dataTooltip` at all, the resolver falls back to a per-kind default if one exists, and otherwise synthesizes a compact Markdoc tooltip from adapted payload fields such as `type`, `description`, position, variant details, significance, score, xrefs, evidences, and remaining scalar fields. Configs that don't author a tooltip therefore still get a useful safety-net tooltip out of the box.

## Bare-string form

A one-line Markdoc template. The YAML value is a string, so no quoting with nested maps needed. Shorthand for `{ kind: markdown, template: "…" }`. Fields on the datapoint are in scope as `$field`.

```yaml
tracks:
  - id: signal
    label: Signal peptide
    kind: features
    filter: SIGNAL
    data: features
    dataTooltip: '**Signal peptide** {% $begin %}–{% $end %}'
```

## `kind: fields` form

A declarative list of labelled rows. Each entry renders as `<h5>label</h5><p>value</p>`. Use this when the tooltip is a flat property sheet without prose or conditional content.

`path` is a dotted path against the item (e.g. `association.0.name`). Missing or empty values drop out silently rather than rendering an empty row. The value at `path` is coerced to string, HTML-escaped, and wrapped in `<p>` at the leaf. There is no per-field render hook; when you need rich, interactive, or stateful tooltips (xref badges, evidence icons, taxonomy lookups, React components, …), own the overlay in the host instead — see [React host integration](/protvista/react-integration).

```yaml
tracks:
  - id: compbias
    label: Compositional bias
    kind: features
    filter: COMPBIAS
    data: features
    dataTooltip:
      kind: fields
      fields:
        - { path: type, label: Type }
        - { path: description, label: Description }
        - { path: begin, label: Start }
        - { path: end, label: End }
```

## `kind: markdown` form

A full Markdoc template. Use this when the tooltip needs prose or conditional fragments. Field interpolation uses `{% $field %}`; flow control uses Markdoc's `{% if %}` / `{% else %}` / `{% /if %}`.

```yaml
tracks:
  - id: domain
    label: Domain
    kind: features
    filter: DOMAIN
    data: features
    dataTooltip:
      kind: markdown
      template: |
        ### {% $description %}
        **Position:** {% $begin %}–{% $end %}
        {% if $score %}**Score:** {% $score %}{% /if %}
```

## Links from a field

Markdoc cannot put a variable into an ordinary link's destination, so a field that holds a URL — a `url` column in your own file, say — becomes a link with the `{% link %}` tag:

```yaml
dataTooltip:
  kind: markdown
  template: |
    PMID {% $pmid %}: {% link href=$url %}read on PubMed{% /link %}
```

The self-closing form, `{% link href=$url /%}`, uses the URL itself as the link text. The URL goes through the same allowlist as every other link: only an absolute `http:` / `https:` / `mailto:` URL, or one starting with `/`, `#` or `?`, becomes a link. A value starting with `//` is protocol-relative, not root-relative: `//example.org/x` links to another site, as an `https:` URL would. Anything else — `javascript:`, a bare relative path like `docs/x.html`, or a feature whose `url` is empty or missing — renders the text alone, with no link. Links open in the same tab.

## Fields from your own file

Any column of your own CSV or TSV file, or any key of your JSON records, is in scope as `$column` in a template and as a `path` in a `fields` list — not only the documented feature fields. See [Style and annotate each feature from your file](/protvista/your-data#style-and-annotate-each-feature-from-your-file). Name columns like identifiers (`gene_name`, `p-value`): a template cannot reference a name with a space in it, a `fields` path cannot reach one with a dot in it, and `$ctx` always means the tooltip context, never a column called `ctx`.

## When a field is missing

A field a record does not have renders as nothing: in the `fields` form its row drops out, and in a template `{% $field %}` renders empty. That is expected when only some records carry the field (to drop the text around it too, see [Guard a field some records lack](#guard-a-field-some-records-lack)), and a record with none of the fields shows the default tooltip (see [A record with none of the fields](#a-record-with-none-of-the-fields)). When **no** record on the track carries it, the name is almost certainly wrong, so the viewer says so — once per track each time the data loads, naming every such field:

```
[protvista-uniprot] Track domains/hits: dataTooltip references unknown fields: pvalue, Gene
```

A row you add on its own, outside a group, is named by its track id alone (`Track hits: …`).

The same text fires a `tooltip-field-miss` [`protvista-error` event](/protvista/troubleshooting#phases) with `severity: 'warning'` and the names in `context.fields`, and the playground lists it as a warning. The track itself renders as usual: there is no `⚠` badge and no alert panel, even with `strict` on.

The names to check against are the record's own: the fields a provider adapter outputs, or the column headers of your file (see [Fields from your own file](#fields-from-your-own-file)). A few details:

- Every field the template names counts, including one inside `{% if $field %}`, a function such as `equals($field, "x")`, or `{% link href=$field %}`, and one in a fenced code block, which Markdoc fills in too. Inline code (single backticks) is printed literally, so a name there is not a reference.
- A field that is present but empty (`''`, a blank cell, or `null` in a JSON key of your own) is not missing. The exceptions are a few built-in columns, which are left off a record that has no value for them, so a column with no value on any row reads as missing:
  - In a feature file, `description`, `score`, `color`, `shape`, `fill` and `opacity`: a blank CSV or TSV cell, or `null` in JSON. In JSON, `""` is left off too for `description` and the four render fields, but not for `score`: `"score": ""` is not a number, so it fails the track.
  - In a variation CSV or TSV file, `wildType`, `description` and `consequence`: a blank cell.
- A variation file's records carry `start` and `end` (not `position`), plus `variant` and `consequenceType`, and `wildType`, `description` and `consequence` when they have a value; its other columns are dropped.
- For a dotted path such as `variant.wildType`, a record where `variant` is `null` counts as having it, so it does not warn. In the `fields` form that row just drops out. A template (`{% $variant.wildType %}`) currently fails the whole track on such a record, so guard it with `{% if $variant %}` or use the `fields` form.
- `$ctx.accession`, `$ctx.trackId` and `$ctx.kind`, and any key you supply under the template's `variables:`, are checked against those values rather than the records.
- Only a `dataTooltip` you write is checked, and only one you write falls back to the default (below). A track using its kind's built-in default, or the automatic tooltip, never warns, and neither do line-graph, coloured-sequence and heatmap tracks, which have no per-feature tooltip for `dataTooltip` to template (see [Line graphs](#line-graphs)).

### A record with none of the fields

A record shows the track's default tooltip instead of yours when both of these hold:

- it has no value for any field the template names: each one is missing, `null`, or a blank cell (`''`);
- what the template renders for it has no letter or digit: only punctuation, such as the `·` that `{% $gene %} · {% link href=$url /%}` leaves, or nothing at all.

The default is what the track would show with no `dataTooltip`: its kind's built-in tooltip (Type, Description, Start and End for `features`), or the automatic tooltip for a track with no `kind`. This is decided record by record, so on one track a record with a `url` shows your template and a record with neither field shows the default. It works the same in the `fields` form, where such a record would otherwise have no tooltip at all.

Your template stays in charge whenever either condition fails:

- A record with a value for at least one of the fields gets your template, whatever is left of it.
- A template that has its own words for the case is kept: `{% if $gene %}{% $gene %}{% else /%}No gene recorded{% /if %}` shows "No gene recorded", and `Lab hit {% $gene %}` shows "Lab hit".
- `$ctx.…` and keys you supply under `variables:` are not fields of the record, so a template that names only those never falls back.

The fallback is silent. A field that no record on the track carries is still reported, as above.

### Guard a field some records lack

To drop the text around a field that only some records have, wrap both in Markdoc's built-in `{% if %}`:

```yaml
dataTooltip:
  kind: markdown
  template: |
    {% if $gene %}{% $gene %} · {% /if %}{% link href=$url /%}
```

A record with both fields shows `HBA1 · https://…`, and one with a `url` but no `gene` (missing or `null`) shows the link alone. One with neither renders nothing, so it shows the default tooltip. A blank `gene` cell is different: see below.

Markdoc's `if` is false only for a missing field, `null` and `false`. A blank CSV or TSV cell is an empty string, which counts as true, so the template above still shows `·` before the link for a row whose `gene` cell is empty. To leave out blank cells too, test for them:

```yaml
dataTooltip:
  kind: markdown
  template: |
    {% if and($gene, not(equals($gene, ""))) %}{% $gene %} · {% /if %}{% link href=$url /%}
```

## When to leave `dataTooltip` off

For every track in the default config, no `dataTooltip` is set. Each semantic `kind` carries a sensible tooltip default — authors who just want the canonical UniProt look get it for free. Only set `dataTooltip` when you want a track-specific override, or when you're authoring a track that doesn't match an existing kind's default.

## Line graphs

A line graph has no per-feature datapoint to template, so `dataTooltip` does not apply to it. Clicking a line graph opens a fixed tooltip instead: the clicked position, then each series' value there.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
