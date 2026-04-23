# Authoring `dataTooltip`

`dataTooltip` controls the per-datapoint tooltip shown when a user clicks a feature on a track. It has three authoring forms, listed here from least to most expressive. Pick the simplest one that works — the rendering pipeline is the same for all three.

For the underlying semantics (security model, field-escape rules, URL-scheme allowlist, fallback behaviour when a track has no `dataTooltip` at all), see the "Tooltips" section in `specs/config-approach.md`.

## Bare-string form

A one-line Markdoc template. The YAML value is a string, so no quoting games with nested maps. Shorthand for `{ kind: markdown, template: "…" }`. Fields on the datapoint are in scope as `$field`.

```yaml
tracks:
  - id: signal
    label: Signal peptide
    kind: features
    filter: SIGNAL
    data: features
    dataTooltip: "**Signal peptide** {% $begin %}–{% $end %}"
```

## `kind: fields` form

A declarative list of labelled rows. Each entry renders as `<h5>label</h5><p>value</p>`. Use this when the tooltip is a flat property sheet without prose or conditional content.

`path` is a dotted path against the item (e.g. `association.0.name`). Missing or empty values drop out silently rather than rendering an empty row. An optional `render:` opts a row into the `tooltipHelpers` registry — use it for xref badges, evidence icons, and similar small helpers the library already knows how to draw.

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
        - { path: type,        label: Type }
        - { path: description, label: Description }
        - { path: begin,       label: Start }
        - { path: end,         label: End }
```

## `kind: markdown` form

A full Markdoc template. Use this when the tooltip needs prose, conditional fragments, or built-in tags. Field interpolation uses `{% $field %}`; flow control uses Markdoc's `{% if %}` / `{% else %}` / `{% /if %}`.

Three built-in tags ship with the viewer:

- `{% xrefs xrefs=$field /%}` — renders a cross-reference list from an `xrefs` array.
- `{% evidence codes=$field /%}` — renders an ECO evidence list from an `evidences` array.
- `{% link source=… id=… label=… /%}` — renders an anchor resolved through the library's URL-template registry. Use this instead of a raw Markdown link when the target URL is a template keyed by source name.

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
        {% if $evidences %}{% evidence codes=$evidences /%}{% /if %}
```

## When to leave `dataTooltip` off

For every track in the default config, no `dataTooltip` is set. Each semantic `kind` carries a sensible tooltip default — authors who just want the canonical UniProt look get it for free. Only set `dataTooltip` when you want a track-specific override, or when you're authoring a track that doesn't match an existing kind's default.
