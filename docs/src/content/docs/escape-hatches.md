---
title: Escape hatches
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

## Example: a custom data adapter

Suppose your file has columns we don't parse out of the box. Register a function
that returns feature records, then name it on the track's `data`:

```js
const viewer = document.createElement('protvista-uniprot');

// Register BEFORE mounting.
viewer.registerAdapter('my-csv', (csvText) =>
  csvText
    .trim()
    .split('\n')
    .slice(1) // drop header
    .map((line) => {
      const [start, end, type] = line.split(',');
      return { type, start: Number(start), end: Number(end) };
    }),
);

viewer.viewerConfig = {
  accession: 'P05067',
  rows: [
    {
      id: 'MY_LAB',
      tracks: [
        {
          id: 'hotspots',
          kind: 'features',
          data: { from: 'file', url: './hotspots.csv', adapter: 'my-csv' },
        },
      ],
    },
  ],
};

document.body.append(viewer); // mounts now, with the adapter available
```

The config validator and the loader consult the same registry, so a track that
names `adapter: my-csv` both validates and runs only because you registered it.

## A custom kind and a custom theme

```js
// A reusable shorthand: `kind: my-features`
viewer.registerSemanticKind('my-features', {
  component: 'nightingale-track-canvas',
  adapter: 'my-csv',
});

// A colour scale for a score/heatmap track (at least two stops)
viewer.registerTheme('my-ramp', [
  { value: 0, color: '#3457b9', label: 'Low' },
  { value: 1, color: '#ca1615', label: 'High' },
]);
```

## Rules to know

- **Register before mounting.** After the element connects, the config is already
  being resolved.
- **Names must be unique.** Registering a name twice throws a
  `RegistryCollisionError`. Built-in **kinds** and **themes** can't be overridden;
  built-in **adapters** may be overridden once (so you can swap our `features-csv`
  for your own column layout).
- **Errors surface through `protvista-error`.** Listen for it to catch misuse and
  load failures — see [Troubleshoot errors](/protvista/troubleshooting).

## Where to go next

- [Load your own data](/protvista/your-data) — before reaching for a custom adapter, check
  whether a built-in format fits.
- [Built-in track kinds](/protvista/track-kinds) — the kinds you get for free.
- [Troubleshoot errors](/protvista/troubleshooting) — the `protvista-error` event.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
