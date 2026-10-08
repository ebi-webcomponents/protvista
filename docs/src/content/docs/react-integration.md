---
title: React host integration
---

When you need a tooltip the config can't express — a React component, evidence badges, taxonomy lookups, links into your app's own routing, or any stateful UI — you own it in the host. The library hands you an event; you render the overlay. For every event the viewer itself dispatches (`protvista-event`, `protvista-error`, `row-click`, …) see the [Events](/protvista/events) reference.

There are exactly two paths for the per-datapoint tooltip, and nothing in between:

- **Declarative (library renders it).** Author `dataTooltip` in YAML and let the built-in click popover render it. Pick this whenever it's enough — see [Authoring `dataTooltip`](/protvista/data-tooltip).
- **Consumer-owned (you render it).** Set `notooltip` on the element, listen for the `change` event, and mount your own overlay. This page walks through that path.

The normative contract for everything below lives in [`specs/config-approach.md`](https://github.com/ebi-webcomponents/protvista/blob/next/specs/config-approach.md#react-host-integration); this page is the tutorial.

## The shape of it

1. Set `notooltip` so the built-in popover stays out of your way.
2. Attach a `change` listener to the `<protvista-uniprot>` element.
3. Branch on `detail.eventType`: `click` opens a tooltip, `mouseover`/`mouseout` drive hover, and `reset` (scroll/zoom) dismisses.
4. Read `detail.feature` (the full datapoint, including any library-precomputed `tooltipContent`), `detail.coords` (an `[x, y]` page-coordinate tuple) and `detail.track` (which track it came from, and its kind).
5. Render your overlay at those coordinates, and dismiss it on the `{ undefined, 'reset', 'click' }` set.

### `notooltip` does not hide the content

`notooltip` only disables the built-in popover's DOM mount. The library still resolves each item's `tooltipContent` during data loading, so you can read `detail.feature.tooltipContent` off the event even with `notooltip` set — handy if you want the library's pre-rendered declarative string inside your own overlay chrome.

### `eventType` vocabulary

| `eventType`  | User action            | What to do                                                    |
| ------------ | ---------------------- | ------------------------------------------------------------- |
| `'click'`    | Clicked a feature      | Open (or replace) the tooltip                                 |
| `'mouseover'`| Hover enter            | Drive hover state, if you want hover tooltips                 |
| `'mouseout'` | Hover leave            | Clear hover state                                             |
| `'reset'`    | Scrolled / zoomed view | Dismiss — "stop showing any per-feature tooltip"              |

These `eventType` values, and the interactions that trigger them, are emitted by the underlying Nightingale track (`@nightingale-elements`), not by `<protvista-uniprot>` itself — Nightingale emits `'reset'` on view changes such as scroll and zoom. The viewer re-exposes the payload on its `change` event with one spelling: line-graph tracks send a lowercase `eventtype`, which the viewer copies to `eventType` before your listener runs.

A line-graph click arrives with `feature` set to each series' point at the clicked position, keyed by series name (`{ [name]: { position, value } }`, the same shape its hover sends), plus a `tooltipContent` listing them.

uniprot-website dismisses on `hideTooltipEvents = new Set([undefined, 'reset', 'click'])`: a bare event (no `eventType`), a `reset`, and a fresh `click` all hide the current overlay — the `click` then re-opens for the newly clicked feature.

### `track` says where the event came from

`detail.track` names the track the event came from, so you can pick a tooltip builder without parsing element ids or walking the config:

| Field           | Value                                                                                  |
| --------------- | -------------------------------------------------------------------------------------- |
| `rowId`         | The group id, or a standalone track's own id                                           |
| `trackId`       | The track id — `null` for a collapsed group, which draws several tracks at once        |
| `kind`          | The track's semantic kind, after `extends` merging — `null` for a collapsed group      |
| `sourceTrackId` | The track that produced `detail.feature`                                               |
| `sourceKind`    | That track's kind                                                                      |

`sourceTrackId` / `sourceKind` come from a tag the viewer puts on every item it loads, so they answer "which track did this feature come from?" even in a collapsed group that mixes, say, UniProt and InterPro domains. `sourceKind ?? kind` is the kind to build for. The tag is also readable directly with `getFeatureSource(feature)`; it is a non-enumerable symbol property, so it never shows up when you serialise or spread a feature.

### `coords` is in page coordinates

`detail.coords` is `[x, y]` in **page coordinates** (`pageX` / `pageY` — viewport-relative plus the page scroll offset). To anchor a `position: fixed` overlay to the viewport, subtract `window.scrollX` / `window.scrollY`, the same transform the built-in popover applies. If you render into a container that already lives in page-coordinate space (an absolutely-positioned layer), use the tuple unchanged.

## A minimal example

React + [Floating UI](https://floating-ui.com/) only. The example imports from `@floating-ui/react`, which is a separate install from the `@floating-ui/dom` the viewer already bundles (`npm i @floating-ui/react`) — or drop Floating UI entirely and position an absolutely-placed `<div>` yourself. Set `notooltip` on the element; the effect wires one `change` listener and positions a fixed overlay at the (viewport-adjusted) click point.

```tsx
import { useEffect, useRef, useState } from 'react';
import { useFloating, autoUpdate } from '@floating-ui/react';
import type ProtvistaUniprot from 'protvista-uniprot';
import type { ProtvistaChangeEvent } from 'protvista-uniprot';
import type {} from 'protvista-uniprot/react'; // JSX types for the elements

const HIDE = new Set([undefined, 'reset', 'click']);

export function FeatureViewer({ accession }: { accession: string }) {
  const hostRef = useRef<ProtvistaUniprot>(null);
  const [tip, setTip] = useState<{ html: string } | null>(null);
  // whileElementsMounted: autoUpdate keeps the overlay positioned and avoids a
  // first-frame top-left flash before the async placement resolves.
  const { refs, floatingStyles } = useFloating({ strategy: 'fixed', whileElementsMounted: autoUpdate });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onChange = (e: Event) => {
      const { eventType, feature, coords } = (e as ProtvistaChangeEvent).detail ?? {};
      if (HIDE.has(eventType)) setTip(null); // reset/undefined dismiss; click falls through to re-open
      // This example reuses the library's precomputed tooltipContent. To build
      // your own UI from feature fields (evidence badges, links, …), branch on
      // `detail.track.sourceKind ?? detail.track.kind` and read `feature`
      // instead of gating on `feature.tooltipContent`.
      if (eventType !== 'click' || !coords || !feature?.tooltipContent) return;
      const [x, y] = coords; // page coords → viewport for position: fixed
      refs.setPositionReference({
        getBoundingClientRect: () =>
          ({ x: x - window.scrollX, y: y - window.scrollY,
             top: y - window.scrollY, left: x - window.scrollX,
             right: x - window.scrollX, bottom: y - window.scrollY,
             width: 0, height: 0 }) as DOMRect,
      });
      setTip({ html: feature.tooltipContent });
    };
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, [refs]);

  return (
    <>
      <protvista-uniprot ref={hostRef} accession={accession} notooltip />
      {tip && (
        <div ref={refs.setFloating} style={floatingStyles} role="tooltip"
             dangerouslySetInnerHTML={{ __html: tip.html }} />
      )}
    </>
  );
}
```

A note on that `dangerouslySetInnerHTML`: the library already HTML-escapes field values and passes declarative `tooltipContent` through Markdoc's safe renderer, so the pre-rendered string is safe to inject. Any HTML *you* assemble in the host — from your own data, template strings, or third-party sources — is your responsibility to sanitize.

The real reference is uniprot-website's `FeatureViewer.tsx`; this is the same pattern with the ambient app concerns stripped out.

## React 19: prefer the ref callback

React 19 lets a ref callback return its own cleanup, which folds the listener's mount and unmount into one place and drops the `useEffect` (and its dependency bookkeeping):

```tsx
const hostRef = (el: HTMLElement | null) => {
  if (!el) return;
  const onChange = (e: Event) => { /* …as above… */ };
  el.addEventListener('change', onChange);
  return () => el.removeEventListener('change', onChange);
};

// …
<protvista-uniprot ref={hostRef} accession={accession} notooltip />
```

Prefer this once you're on React 19 — don't copy the split mount/unmount `useEffect` shape as the canonical form.

## Typing the elements in JSX

`import type {} from 'protvista-uniprot/react'` (once, anywhere in your program) declares `<protvista-uniprot>` and `<protvista-uniprot-structure>` as JSX intrinsic elements. It needs React 19 and `@types/react` 19 or later. Props use the **attribute** spelling — `notooltip`, `suspend`, `no-persist-layout`, `config-src`, `quiet-notices`, `show-warnings`, `no-table`, `selected-id`, `color-theme` — because React 19 sets attributes, not properties, on an element that is not defined yet, and HTML lowercases attribute names: a camel-cased `noTable` would arrive as the unobserved `notable`.

:::caution[React 18]
The typings target React 19. React 18 writes every custom-element prop as an attribute, including `suspend={false}`, which leaves an attribute that still suspends the viewer. On React 18, set boolean props from a ref instead.
:::

Object-valued props (`viewerConfig`, `adapters`, the structure element's `data`) can only be set as properties. React 19 sets them as properties when the element is already defined at render time, so import the element before you render it:

```tsx
import 'protvista-uniprot'; // defines <protvista-uniprot> before any render

<protvista-uniprot accession={accession} adapters={adapters} />
```

If you load the package lazily, render the element only once the import has resolved. Otherwise React stringifies the object into an attribute such as `adapters="[object Object]"`. The value is lost, and the element logs a warning naming the prop. Setting the prop from a ref also works on an element that is not defined yet, because the element picks it up when it upgrades:

```tsx
<protvista-uniprot ref={(el) => { if (el) el.adapters = adapters; }} accession={accession} />
```

## Replacing a built-in adapter

To load a track's data through your own function, set the element's `adapters` property, either as a JSX prop as shown above or as `el.adapters = { 'uniprot-proteomics-json': myAdapter }`. The adapters are registered before loading starts, so there is no need to render with `suspend` and clear it afterwards. Each value replaces the one before it, so the object can be written inside the component and re-created on every render, and React StrictMode's double-invoked ref callbacks are safe. A name the new value leaves out is unregistered, and any built-in it overrode comes back. A name already registered some other way, such as with `registerAdapter()`, throws `RegistryCollisionError`. Adapters changed after the data has loaded apply to the next load. See [Escape hatches](/protvista/escape-hatches).

```tsx
<protvista-uniprot
  accession={accession}
  adapters={{ 'uniprot-proteomics-json': myAdapter }}
/>
```

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
