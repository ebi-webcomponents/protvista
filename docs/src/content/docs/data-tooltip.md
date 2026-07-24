---
title: Authoring dataTooltip
---

`dataTooltip` controls the per-datapoint tooltip shown when a user clicks a feature on a track. It has three authoring forms, listed here from least to most expressive. Pick the simplest one that works — the rendering pipeline is the same for all three.

All three forms run through the same renderer: every field value is HTML-escaped at the leaf, link `href`s are routed through a scheme allowlist (`http:`, `https:`, `mailto:`, and relative URL forms; `javascript:` and `data:` are dropped), and rich / interactive tooltips are not a config concern. If you need a custom React panel, evidence badges, taxonomy lookups, or any other stateful UI, listen for the Nightingale `change` event on the element and mount your own overlay, setting the `notooltip` attribute on `<protvista-uniprot>` to suppress the built-in popover.

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

`path` is a dotted path against the item (e.g. `association.0.name`). Missing or empty values drop out silently rather than rendering an empty row. The value at `path` is coerced to string, HTML-escaped, and wrapped in `<p>` at the leaf. There is no per-field render hook — for rich, interactive, or stateful tooltips (xref badges, evidence icons, taxonomy lookups, React components, …), listen for the Nightingale `change` event on the element and mount your own UI, setting the `notooltip` attribute on `<protvista-uniprot>` to suppress the built-in popover.

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

## When to leave `dataTooltip` off

For every track in the default config, no `dataTooltip` is set. Each semantic `kind` carries a sensible tooltip default — authors who just want the canonical UniProt look get it for free. Only set `dataTooltip` when you want a track-specific override, or when you're authoring a track that doesn't match an existing kind's default.
