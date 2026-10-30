---
title: Events
---

The viewer and its parts dispatch `CustomEvent`s the host can listen to —
to wire the viewer into your own UI, refresh surrounding state, or surface
failures. Every event on this page bubbles, so a listener on the element
itself or anywhere above it in the DOM both work.

## Every event

| Event | Emitted by | When it fires | `detail` | Bubbles | Composed |
| --- | --- | --- | --- | --- | --- |
| `protvista-event` | `<protvista-uniprot>` | The moment data first becomes available for a load — `hasData` flips from `false` to `true` (a later track or targeted retry does not re-fire it). | `{ hasData: true }` | Yes | No |
| `protvista-layout-change` | `<protvista-uniprot>` | The row/track arrangement changes, whether from the API or a UI control — once per real change, never for a no-op. | `LayoutPatch`: `{ order: string[] \| null, tracks: Record<string, string[]> }` — `order` is the user's row order (`null` = authored order), `tracks` maps each row id to that row's track ids in order (a row absent keeps its authored track order). | Yes | No |
| `protvista-error` | `<protvista-uniprot>` | Any routed problem or warning: config validation, sequence or track fetch failures, data transforms, tooltip-field misses — the same reports the console and the error panel show. | `{ phase, severity, message, source?, issues, context }` — `phase` is one of `config`, `sequence`, `track-fetch`, `set-track-data`, `track-data`, `transform-calculate`, `tooltip-field-miss`; `severity` is `'error' \| 'warning' \| 'info'`; `message` is the human-readable line (console tag stripped, safe to show to a user); `source` is the URL or path when there is one; `issues` is the config [`ValidationIssue[]`](/protvista/troubleshooting) (`path`, `message`, `code`, optional `severity`); `context` carries whatever is relevant to the phase (`accession`, `groupId`, `trackId`, `url`, `status`, …). See [Troubleshoot errors](/protvista/troubleshooting). | Yes | No |
| `structures-loaded` | `<protvista-uniprot-structure>` | The structure sources (PDBe, AlphaFold, 3D-Beacons) have been fetched and processed for the current accession — once per connection that has an `accession` or `checksum`. | `ReadonlyArray<ProcessedStructureData>` — rows with `id`, `source`, `method?`, `resolution?`, `chain?`, `positions?`, `downloadUrl?`, `sourceDBLink?`, `protvistaFeatureId`, `amAnnotationsUrl?`, `isoformId?`, `isoformIsCanonical?`, `oligomericState?`. | Yes | Yes |
| `row-click` | `<protvista-uniprot-datatable>` (the structure table inside `<protvista-uniprot-structure>`) | A table row is activated — a click on it, or selecting the focused row from the keyboard. | The row record itself — `ProcessedStructureData` for the structure table. | Yes | Yes |

`composed: Yes` means the event crosses shadow DOM boundaries, so a listener
outside the component's shadow root still sees it. The three `protvista-*`
events are dispatched on the top-level `<protvista-uniprot>` element itself,
where `composed` is irrelevant, and are not composed.

## Listening

```js
const viewer = document.querySelector('protvista-uniprot');

viewer.addEventListener('protvista-event', (e) => {
  if (e.detail.hasData) console.log('viewer has data');
});

viewer.addEventListener('protvista-error', (e) => {
  const { phase, severity, message } = e.detail;
  reportToUi({ phase, severity, message }); // message is safe for users
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
