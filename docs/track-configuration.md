# Track configuration (Customize layout)

End users can reorder rows and show or hide tracks directly in the viewer,
live, without editing the config or writing code. This implements the
interaction and accessibility design in
[`specs/track-configurability-design.md`](../specs/track-configurability-design.md)
(issue [#199](https://github.com/ebi-webcomponents/protvista/issues/199)).

The customized layout is **viewer-held runtime state layered over the
config**. The authored config is never mutated: it describes the initial
mount, and any user reordering/hiding lives in the component (per
[`specs/config-approach.md`](../specs/config-approach.md)).

## The "Customize layout" panel

A **Customize layout** button in the viewer toolbar opens the **Track
Manager**: a list of every track in the viewer, grouped by adjacency. It is
the accessible source of truth; the canvas mirrors it.

Every track offers, all clustered on the left:

- a **show/hide toggle** (an eye / slashed-eye icon paired with a "Hide" /
  "Show" action label);
- **move-up / move-down** buttons and a **drag handle** to reorder it.

A group header carries the same controls and reorders or hides the whole
group at once.

Reordering is **per track**, and grouping is **derived from adjacency**: a
group's tracks that stay next to each other render together under the group
header, while a track moved away from its siblings renders on its own as
**"Group / Track"**. A group keeps its collapsible aggregate summary while
its tracks are all together; once they are split apart it shows its tracks
individually. Hiding every track of a group removes the group (and its
summary) from the canvas.

A hidden track **stays in place** in the list, dimmed, with just a **"Show"**
toggle (its move/drag controls return once it is shown), so it is easy to
find and bring back in context; a **count** in the panel header shows how
many are hidden. A whole hidden group stays listed too, so it is never lost.
A **Reset to default** button restores the authored layout.

### Accessibility

The panel is built to WCAG 2.1 AA:

- **Keyboard**: a roving-tabindex grid. Up/Down move between rows,
  Left/Right between a row's controls; the whole list is a single tab stop.
  Reorder always has a non-drag path (the move-up/down buttons), so it never
  depends on a dragging gesture.
- **Screen readers**: real `<button>` controls with accessible names; the
  toggle carries `aria-pressed`; an `aria-live` region announces each move
  ("Domains moved to position 2 of 12"), hide, and show.
- **Focus**: a visible focus ring on every control, and focus follows an
  item when it moves or is hidden/shown, without scrolling the page.
- **No colour-only state**: the show/hide state is conveyed by the icon
  shape and the action word, never colour alone.
- **Motion**: drag styling respects `prefers-reduced-motion`.

## Authoring a track hidden by default (`hidden`)

A config can ship a group or track hidden on first mount by setting
`hidden: true`. This is an initial-mount default only; a user's runtime
toggle layers over it and wins, and it is never written back to the config.

```yaml
rows:
  - id: MOLECULE_PROCESSING
    tracks:
      - id: signal
        kind: features
        filter: SIGNAL
        data: features
      - id: chain
        kind: features
        filter: CHAIN
        data: features
        hidden: true # present in the Track Manager, hidden on the canvas
  - id: EXPERIMENTAL_NOTES
    hidden: true # whole group hidden by default
    tracks:
      - id: notes
        kind: features
        data: features
```

## Runtime API

The layout can be driven programmatically, alongside `registerAdapter` /
`setTrackData`. Every change emits a `protvista-layout-change` event so an
embedder can save and restore a view.

```ts
const viewer = document.querySelector('protvista-uniprot');

// Reorder tracks by their `${groupId}-${trackId}` keys. Grouping is derived
// from adjacency, so putting a group's keys next to each other renders them
// under its header, and separating a key renders it as "Group / Track".
// Unknown keys are ignored; tracks the list omits keep their authored
// position, appended after.
viewer.setTrackOrder([
  'DOMAINS_AND_SITES-domain',
  'VARIATION-variants',
  'DOMAINS_AND_SITES-region',
]);

// Show or hide a whole lane (a group or a standalone track).
viewer.setRowVisibility('MOLECULE_PROCESSING', false);

// Show or hide one track within a group (group id, track id).
viewer.setTrackVisibility('MOLECULE_PROCESSING', 'chain', false);

// Restore the authored layout (drops every reorder + show/hide override).
viewer.resetLayout();

// Read the current overlay (safe to keep / serialize).
const layout = viewer.getLayout();
// → { order: string[] | null, hidden: Record<string, boolean> }

viewer.addEventListener('protvista-layout-change', (e) => {
  // e.detail is the same ViewerLayout shape as getLayout()
  console.log(e.detail.order, e.detail.hidden);
});
```

In `getLayout()` / the event `detail`, `order` is a flat list of
`${groupId}-${trackId}` track keys (`null` when no reorder has been applied),
and `hidden` maps a row id (a whole lane) or a `groupId-trackId` composite (a
track) to an explicit user choice that overrides the authored `hidden`
default.

## Persistence and sharing

A customized layout persists automatically:

- **localStorage**, keyed per config (a hash of the config's row + track
  ids), so a user's layout survives a reload in the same browser and applies
  to every protein viewed with the same config.
- **A shareable `?layout=` URL parameter**, updated as the user customizes,
  so the exact view can be sent by link.

On mount the restore precedence is **`?layout=` URL > localStorage >
authored default**. "Reset to default" clears both stores.

Set the **`no-persist-layout`** attribute to opt out entirely. A viewer with
this attribute neither restores a saved/shared layout nor writes one, which
is the right choice for an embedder that manages layout itself:

```html
<protvista-uniprot accession="P05067" no-persist-layout></protvista-uniprot>
```
