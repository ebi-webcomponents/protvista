---
title: Events
---

The viewer and its parts dispatch `CustomEvent`s the host can listen to —
to wire the viewer into your own UI, refresh surrounding state, or surface
failures. Every event on this page bubbles, so a listener on the element
itself or on one of its ancestors works. The three `protvista-*` events are
not composed, though, so they stop at a containing shadow root (see
[Inside a shadow root](#inside-a-shadow-root)).

## Every event

| Event | Emitted by | When it fires | `detail` | Bubbles | Composed |
| --- | --- | --- | --- | --- | --- |
| `protvista-event` | `<protvista-uniprot>` | Each time `hasData` goes from `false` to `true`: after the first load that has data, and again only when data arrives after a load that had none (from a new load or a retry). It does not fire on every load: switching to a second accession that also has data does not fire it again. | `{ hasData: true }` | Yes | No |
| `protvista-layout-change` | `<protvista-uniprot>` | The row/track arrangement changes, whether from the API or a UI control — a reorder, or showing or hiding a row or track. Once per real change, never for a no-op. | `LayoutPatch`: `{ order: string[] \| null, tracks: Record<string, string[]>, hidden: { rows: Record<string, boolean>, tracks: Record<string, Record<string, boolean>> } }` — `order` is the user's row order (`null` = authored order), `tracks` maps each row id to that row's track ids in order (a row absent keeps its authored track order), and `hidden` holds the show/hide choices that differ from the config (`true` = hidden, `false` = shown): `rows` by row id, `tracks` by row id and then track id. The patch is the whole difference from the authored layout, so hiding a row with nothing reordered arrives as `order: null` and `tracks: {}`: save `hidden` too, or those choices are lost. | Yes | No |
| `protvista-error` | `<protvista-uniprot>` | Any routed problem or warning: config validation, sequence or track fetch failures, data transforms, tooltip-field misses — the same reports the console and the error panel show. | `{ phase, severity, message, source?, issues, context }` — `phase` is one of `config`, `sequence`, `track-fetch`, `set-track-data`, `track-data`, `transform-calculate`, `tooltip-field-miss`; `severity` is `'error' \| 'warning' \| 'info'`; `message` is the human-readable line (console tag stripped); `source` is the URL or path when there is one; `issues` is a [`ValidationIssue[]`](/protvista/troubleshooting) (`path`, `message`, `code`, optional `severity`): the config's issues for `config`, the warning itself for `track-data` and `tooltip-field-miss`, and empty for the other phases; `context` carries whatever is relevant to the phase (`accession`, `groupId`, `trackId`, `url`, `status`, …). Every string in `detail` is plain text, and `message` and each `issues[].message` can quote the config or a data file (a colour value from a feature file, for instance), so insert them with `textContent`, never `innerHTML`. See [Troubleshoot errors](/protvista/troubleshooting). | Yes | No |
| `structures-loaded` | `<protvista-uniprot-structure>` | The structure sources (PDBe, AlphaFold, 3D-Beacons) have been fetched and processed for the current accession — once per connection that has an `accession` or `checksum`. | `ReadonlyArray<ProcessedStructureData>` — rows with `id`, `source`, `method?`, `resolution?`, `chain?`, `positions?`, `downloadUrl?`, `sourceDBLink?`, `protvistaFeatureId`, `amAnnotationsUrl?`, `isoformId?`, `isoformIsCanonical?`, `oligomericState?`. | Yes | Yes |
| `row-click` | `<protvista-uniprot-datatable>` (the structure table inside `<protvista-uniprot-structure>`) | A table row is activated — a click on it, or selecting the focused row from the keyboard. | The row record itself — `ProcessedStructureData` for the structure table. | Yes | Yes |

`composed: Yes` means the event crosses shadow DOM boundaries, so a listener
outside the component's shadow root still sees it.

### Inside a shadow root

The three `protvista-*` events are not composed, so they stop at the shadow
root that contains the viewer. If you render `<protvista-uniprot>` inside your
own component's shadow root, a listener on `document` never sees them: listen
on the viewer itself, or on an element inside that shadow root.

## Listening

```js
const viewer = document.querySelector('protvista-uniprot');

viewer.addEventListener('protvista-event', (e) => {
  if (e.detail.hasData) console.log('viewer has data');
});

viewer.addEventListener('protvista-error', (e) => {
  const { phase, severity, message, issues } = e.detail;
  // message and each issues[].message are plain text that may quote the
  // config or a data file: show them with textContent, never innerHTML.
  reportToUi({ phase, severity, message, issues });
});

// Bubbles up from the structure table:
viewer.addEventListener('row-click', (e) => {
  console.log('selected structure', e.detail.id);
});
```

In React the same listeners attach with a `ref` — see
[React host integration](/protvista/react-integration).

## Not on this page: `change`

The per-datapoint `change` event described in
[React host integration](/protvista/react-integration) is not dispatched by
`<protvista-uniprot>` itself — it is re-exposed from the underlying
Nightingale track's own `change` event as it bubbles through. Its payload
(`eventType`, `feature`, `coords`, `track`) belongs to that contract, not to
the events listed above.
