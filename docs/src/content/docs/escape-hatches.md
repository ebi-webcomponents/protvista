---
title: Escape hatches
description: "ProtVista provides the following registration methods ('registerAdapter', 'registerSemanticKind','registerTheme', and 'registerComponent') and the 'setTrackData()' method to define custom data parsers, track types, colour scales, and custom component extensions."
---

Most needs are met by writing a config. When you need to go further — a data
format we don't parse, a custom track type, your own colour scale — ProtVista
exposes four registration methods **on the element instance**. Call them
**before the element mounts**, then load your config as usual.

:::note[Full API reference]
This page is a pointer to the extension points, not the complete reference. The
full, field-by-field API reference is a Q4 deliverable. For now, the runnable
tests under
[`src/__spec__/`](https://github.com/ebi-webcomponents/protvista/tree/next/src/__spec__)
are the authoritative examples.
:::

## The registration methods

These are methods on the `<protvista-uniprot>` element, not package exports:

| Method | Use it to… |
| --- | --- |
| `registerAdapter(name, fn)` | Turn a custom data format/response into feature records. |
| `registerSemanticKind(name, def)` | Define a new `kind:` shorthand (a component + adapter bundle). |
| `registerTheme(name, stops)` | Add a colour scale for score/heatmap tracks. |
| `registerComponent(name, ctor)` | Register a custom element so a config can reference it. |

:::caution[Custom components are not drawn yet]
`registerComponent` defines your element and lets a config name it, and the
config validates, but the viewer doesn't render it yet: the track stays empty
and an `unrendered-component` warning is reported. Custom **adapters**, kinds
and themes work today; a custom **renderer** needs a change in ProtVista
itself. If you need one, open an issue so we can work on it with you.
:::

## Example: a custom data adapter

Suppose your pipeline writes JSON in its own shape, with field names ProtVista
doesn't know. Register a function that turns it into feature records, then name
it on the track's `data`:

```json
{ "hits": [{ "from": 18, "to": 289, "label": "Extracellular domain" }] }
```

```js
// Defined once, at module scope (see "Rules to know").
const parseMyHits = (response) =>
  response.hits.map((hit) => ({
    type: 'REGION',
    start: hit.from,
    end: hit.to,
    description: hit.label,
  }));

const viewer = document.createElement('protvista-uniprot');

// Register BEFORE mounting.
viewer.registerAdapter('my-hits', parseMyHits);

viewer.viewerConfig = {
  accession: 'P05067',
  rows: [
    {
      id: 'MY_LAB',
      tracks: [
        {
          id: 'hits',
          kind: 'features',
          data: { from: 'file', url: './my-hits.json', adapter: 'my-hits' },
        },
      ],
    },
  ],
};

document.body.append(viewer); // mounts now, with the adapter available
```

The config validator and the loader consult the same registry, so a track that
names `adapter: my-hits` both validates and runs only because you registered it.

**A custom adapter receives the response parsed as JSON**, whatever the file is
called: naming an `adapter:` takes the place of `format:`, so the body isn't
handed over as text. (The one exception: if another track reads the same URL
with a text `format:`, the shared response is fetched as text.) That makes a custom adapter the tool for JSON in your own
shape. For a CSV or TSV whose columns differ from ProtVista's, it is usually
simpler to rename the header row to `type,start,end,description` (any other
columns are kept for tooltips) than to write a parser; see
[Load your own data](/protvista/your-data). If you must parse something else
yourself, fetch and parse it in your own code and hand the records over with
[`setTrackData()`](#hand-over-data-you-loaded-yourself-settrackdata).

### Or set `adapters`

The `adapters` property is the declarative form of `registerAdapter`: a map of
name to function, registered as soon as it is set.

```js
viewer.adapters = { 'my-hits': parseMyHits };
```

Unlike the method, it can be set before the element is even defined — from a
framework ref, or a Lit `.adapters=${…}` binding on a page that loads
`protvista-uniprot` lazily. The value is applied when the element upgrades,
before it starts loading, so there is no need to render with `suspend` and clear
it afterwards. Entries set after the data has loaded apply to the next load.

Each value you set replaces the last one, all at once. A name may take a new
function, so an object re-created on every render of a component is fine. A
name the new value leaves out is unregistered, and any built-in adapter it
overrode comes back. Unlike `registerAdapter`, the property's own entries are
not bound by the unique-names rule below. A name registered some other way,
such as with `registerAdapter`, still throws `RegistryCollisionError`, and the
element keeps its previous adapters.

## Hand over data you loaded yourself: `setTrackData()`

When your data doesn't live at a URL the viewer can fetch (it comes from your
app's own API client, needs an auth header, or is computed in the page), mark
the track `from: custom` and pass the records in yourself:

```js
viewer.viewerConfig = {
  accession: 'P05067',
  rows: [
    {
      id: 'MY_LAB',
      tracks: [{ id: 'hits', kind: 'features', data: { from: 'custom' } }],
    },
  ],
};

// Group id, track id, then records already in the track's shape —
// feature records for `kind: features`.
viewer.setTrackData('MY_LAB', 'hits', [
  { type: 'REGION', start: 18, end: 289, description: 'Extracellular domain' },
]);
```

You can call it before or after the element mounts. A call after mount reloads
the view with the new records. Only a `from: custom` track accepts data this
way. A call naming a track that isn't in the config or isn't `from: custom`, or
passing something other than an array or object, is ignored and reported as a
`set-track-data` warning. Records that don't fit the track's kind are reported
on the track itself (see [Troubleshoot errors](/protvista/troubleshooting)).

## A custom kind and a custom theme

```js
// A reusable shorthand: `kind: my-features`
const myFeatures = {
  component: 'nightingale-track-canvas',
  adapter: 'my-hits',
};

// A colour scale for a score/heatmap track (at least two stops)
const myRamp = [
  { value: 0, color: '#3457b9', label: 'Low' },
  { value: 1, color: '#ca1615', label: 'High' },
];

viewer.registerSemanticKind('my-features', myFeatures);
viewer.registerTheme('my-ramp', myRamp);
```

A kind registered like this has no record `shape`, so it can't pick a parser
from a file extension: `kind: my-features` with a bare `data: ./my-hits.json`
is rejected (`kind-format-mismatch`). Repeat the adapter on the data
descriptor instead, `data: { from: 'file', url: './my-hits.json', adapter: 'my-hits' }`,
or use a URL without a file extension.

Only adapters have a property you can set before the element is defined. If you
can't call these methods before the element mounts (for example, it is already
in the page, or a framework renders it), render it with `suspend`, register,
then clear `suspend` to start loading:

```js
// <protvista-uniprot suspend accession="P05067"></protvista-uniprot>
const viewer = document.querySelector('protvista-uniprot');
viewer.registerSemanticKind('my-features', myFeatures);
viewer.registerTheme('my-ramp', myRamp);
viewer.suspend = false; // loads now
```

## Rules to know

- **Register before mounting**, or while the element is `suspend`ed. Once it
  starts loading, the config is already being resolved.
- **Names must be unique.** Registering a different value under a taken name
  throws a `RegistryCollisionError`. Registering the *same* value again is a
  no-op — the same function, object or array, compared by reference, not an
  equal copy. Define your adapters, kinds and themes once at module scope, as
  above, and setup that runs twice (React StrictMode) is safe; an inline arrow
  function or object literal is a new value every time it runs, so the second
  run throws. Built-in **kinds** and **themes** can't be overridden;
  built-in **adapters** may be overridden once, so you can swap a provider
  transform such as `uniprot-features-json` for one that reads a different
  feed. Reading your *own* file needs no adapter at all — see
  [Load your own data](/protvista/your-data).
- **Errors surface through `protvista-error`.** Listen for it to catch misuse and
  load failures — see [Troubleshoot errors](/protvista/troubleshooting).

## Where to go next

- [Load your own data](/protvista/your-data) — before reaching for a custom adapter, check
  whether a built-in format fits.
- [Built-in track kinds](/protvista/track-kinds) — the kinds you get for free.
- [Troubleshoot errors](/protvista/troubleshooting) — the `protvista-error` event.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
