# React host integration

When you need a tooltip the config can't express — a React component, evidence badges, taxonomy lookups, links into your app's own routing, or any stateful UI — you own it in the host. The library hands you an event; you render the overlay.

There are exactly two paths for the per-datapoint tooltip, and nothing in between:

- **Declarative (library renders it).** Author `dataTooltip` in YAML and let the built-in click popover render it. Pick this whenever it's enough — see [`data-tooltip.md`](./data-tooltip.md).
- **Consumer-owned (you render it).** Set `notooltip` on the element, listen for the `change` event, and mount your own overlay. This page walks through that path.

The normative contract for everything below lives in [`specs/config-approach.md`](../specs/config-approach.md#react-host-integration); this page is the tutorial.

## The shape of it

1. **Set `notooltip`** so the built-in popover stays out of your way.
2. **Attach a `change` listener** to the `<protvista-uniprot>` element.
3. **Branch on `detail.eventType`** — `click` opens a tooltip; `mouseover` / `mouseout` drive hover; `reset` (scroll/zoom) dismisses.
4. **Read `detail.feature`** (the full datapoint, including any library-precomputed `tooltipContent`) and **`detail.coords`** (an `[x, y]` page-coordinate tuple).
5. **Render your overlay** at those coordinates and **dismiss** on the `{ undefined, 'reset', 'click' }` set.

### `notooltip` does not hide the content

`notooltip` only disables the built-in popover's DOM mount. The library still resolves each item's `tooltipContent` during data loading, so you can read `detail.feature.tooltipContent` off the event even with `notooltip` set — handy if you want the library's pre-rendered declarative string inside your own overlay chrome.

### `eventType` vocabulary

| `eventType`  | User action            | What to do                                                    |
| ------------ | ---------------------- | ------------------------------------------------------------- |
| `'click'`    | Clicked a feature      | Open (or replace) the tooltip                                 |
| `'mouseover'`| Hover enter            | Drive hover state, if you want hover tooltips                 |
| `'mouseout'` | Hover leave            | Clear hover state                                             |
| `'reset'`    | Scrolled / zoomed view | Dismiss — "stop showing any per-feature tooltip"              |

These `eventType` values, and the interactions that trigger them, are emitted by the underlying Nightingale track (`@nightingale-elements`), not by `<protvista-uniprot>` itself — Nightingale emits `'reset'` on view changes such as scroll and zoom. The viewer only re-exposes the payload on its `change` event.

uniprot-website dismisses on `hideTooltipEvents = new Set([undefined, 'reset', 'click'])`: a bare event (no `eventType`), a `reset`, and a fresh `click` all hide the current overlay — the `click` then re-opens for the newly clicked feature.

### `coords` is in page coordinates

`detail.coords` is `[x, y]` in **page coordinates** (`pageX` / `pageY` — viewport-relative plus the page scroll offset). To anchor a `position: fixed` overlay to the viewport, subtract `window.scrollX` / `window.scrollY`, the same transform the built-in popover applies. If you render into a container that already lives in page-coordinate space (an absolutely-positioned layer), use the tuple unchanged.

## A minimal example

React + [Floating UI](https://floating-ui.com/) only. The example imports from `@floating-ui/react`, which is a separate install from the `@floating-ui/dom` the viewer already bundles (`npm i @floating-ui/react`) — or drop Floating UI entirely and position an absolutely-placed `<div>` yourself. Set `notooltip` on the element; the effect wires one `change` listener and positions a fixed overlay at the (viewport-adjusted) click point.

```tsx
import { useEffect, useRef, useState } from 'react';
import { useFloating, autoUpdate } from '@floating-ui/react';

type ChangeDetail = {
  eventType?: 'click' | 'mouseover' | 'mouseout' | 'reset';
  feature?: { tooltipContent?: string; [k: string]: unknown };
  coords?: [number, number];
};

const HIDE = new Set([undefined, 'reset', 'click']);

export function FeatureViewer({ accession }: { accession: string }) {
  const hostRef = useRef<HTMLElement>(null);
  const [tip, setTip] = useState<{ html: string } | null>(null);
  // whileElementsMounted: autoUpdate keeps the overlay positioned and avoids a
  // first-frame top-left flash before the async placement resolves.
  const { refs, floatingStyles } = useFloating({ strategy: 'fixed', whileElementsMounted: autoUpdate });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onChange = (e: Event) => {
      const { eventType, feature, coords } = (e as CustomEvent<ChangeDetail>).detail ?? {};
      if (HIDE.has(eventType)) setTip(null); // reset/undefined dismiss; click falls through to re-open
      // This example reuses the library's precomputed tooltipContent. To build
      // your own UI from feature fields (evidence badges, links, …), branch on
      // `feature` here instead of gating on `feature.tooltipContent`.
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
      {/* @ts-expect-error custom element */}
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
{/* @ts-expect-error custom element */}
<protvista-uniprot ref={hostRef} accession={accession} notooltip />
```

Prefer this once you're on React 19 — don't copy the split mount/unmount `useEffect` shape as the canonical form.
