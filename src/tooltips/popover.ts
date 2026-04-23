/**
 * Click-triggered tooltip popover display.
 *
 * Listens to Nightingale's `change` CustomEvents on the host element,
 * filters to `eventType === 'click'`, and renders
 * `event.detail.feature.tooltipContent` in a Floating-UI-positioned
 * popover. Hover events are deliberately ignored — click-only is a
 * product decision that avoids hover-flicker on canvas tracks and
 * sidesteps the a11y complications of hover-triggered popovers.
 *
 * The popover is a single `<div role="tooltip">` appended to the host
 * element's light DOM (ProtVista doesn't use a shadow root — see
 * `addStyles()` in `protvista-uniprot.ts`). It's positioned against a
 * virtual element synthesized from the click's `pageX` / `pageY`
 * coordinates. Floating UI's `flip` + `shift` middleware keep it
 * on-screen regardless of where on the track the user clicked.
 *
 * Dismissal: any click outside the popover, clicking a group label
 * (which toggles the group's track strip and would otherwise leave
 * the popover stranded mid-air), Escape, or any scroll on the document
 * (capture phase — catches scrolls on any ancestor). Scroll *dismisses*
 * rather than repositions on purpose: the click point is a page
 * coordinate, and a repositioning popover sliding across the track as
 * the user scrolls reads as UI noise. A dismissed popover can be
 * re-opened with a fresh click.
 *
 * The module deliberately has zero dependencies on lit or the rest of
 * ProtVista. Callers hand it a host element and an optional `enabled`
 * predicate (used by `<protvista-uniprot>` to gate on the `notooltip`
 * attribute). Tearing down is explicit — `controller.dispose()` removes
 * the DOM element and detaches every listener.
 */
import {
  computePosition,
  flip,
  shift,
  offset,
  arrow,
  type VirtualElement,
  type ReferenceElement,
} from '@floating-ui/dom';

/**
 * Subset of Nightingale's `change` event `detail` that this module
 * consumes. Kept narrow on purpose — new fields Nightingale adds
 * shouldn't force a signature change here.
 */
interface NightingaleChangeDetail {
  eventType?: 'click' | 'mouseover' | 'mouseout' | string;
  feature?: {
    tooltipContent?: string;
    [key: string]: unknown;
  };
  coords?: [number, number];
}

export interface TooltipController {
  /** Remove the popover DOM element and detach every listener. */
  dispose(): void;
}

/**
 * Options accepted by `installClickTooltip`. All fields optional.
 */
export interface InstallOptions {
  /**
   * Called before each click is acted on. Returning `false` cancels
   * display — used for the legacy `notooltip` opt-out.
   */
  enabled?: () => boolean;
  /**
   * Distance in pixels between the click point and the tooltip edge.
   * Defaults to 12, which sits clear of the default cursor hotspot.
   */
  offset?: number;
  /**
   * CSS class applied to the popover root, useful for consumer
   * theming. Defaults to `'protvista-tooltip'`.
   */
  className?: string;
}

/**
 * Build a `VirtualElement` from a page-coordinate pair. `computePosition`
 * only needs a `getBoundingClientRect` method; we give it a zero-sized
 * rect at the click point so the tooltip sits right next to the cursor.
 *
 * `pageX` / `pageY` are viewport-relative *plus* scroll offset, but
 * Floating UI expects viewport-relative coordinates (what the browser's
 * native `getBoundingClientRect` returns). We subtract the current
 * scroll offset so the popover sticks to the click point regardless of
 * page scroll position.
 */
function virtualElementAt(pageX: number, pageY: number): VirtualElement {
  const x = pageX - window.scrollX;
  const y = pageY - window.scrollY;
  return {
    getBoundingClientRect: () => ({
      width: 0,
      height: 0,
      x,
      y,
      top: y,
      left: x,
      right: x,
      bottom: y,
    }),
  };
}

/**
 * Install the click-tooltip behaviour on `host`. Returns a controller
 * whose `dispose()` fully tears down the DOM + listeners it created.
 *
 * Idempotent per-host: calling twice without disposing would mount two
 * popovers, so callers (e.g. `<protvista-uniprot>`) must dispose on
 * disconnect.
 */
export function installClickTooltip(
  host: HTMLElement,
  opts: InstallOptions = {}
): TooltipController {
  const {
    enabled = () => true,
    offset: offsetPx = 12,
    className = 'protvista-tooltip',
  } = opts;

  // Popover DOM. Attached to the host so it inherits the host's styling
  // context and is torn down with it if the host is removed before
  // `dispose()` runs.
  const popover = document.createElement('div');
  popover.className = className;
  popover.setAttribute('role', 'tooltip');
  // `tabindex="-1"` makes the popover programmatically focusable
  // without inserting it into the natural tab order. `show()` calls
  // `.focus()` so assistive tech announces the popover contents on
  // open (a `role="tooltip"` that never receives focus is effectively
  // invisible to most screen readers). Any focusable child — a link
  // in a `markdown` tooltip, for instance — still carries its own
  // tab stop once the popover is open, so keyboard navigation within
  // the content works unchanged.
  popover.tabIndex = -1;
  popover.hidden = true;
  popover.style.position = 'absolute';
  popover.style.top = '0';
  popover.style.left = '0';
  popover.style.zIndex = '1000';
  popover.style.pointerEvents = 'auto';
  // Kill the default focus ring on the popover root — keyboard users
  // still see focus rings on anything *inside* the popover (links,
  // buttons), which is the signal that actually matters for
  // navigation. Themers who want an outer ring can restore it via the
  // `className` hook.
  popover.style.outline = 'none';

  // Arrow element — purely visual. Consumers that don't want the arrow
  // can hide it via CSS (`.protvista-tooltip > .arrow { display: none }`).
  const arrowEl = document.createElement('div');
  arrowEl.className = 'arrow';
  arrowEl.style.position = 'absolute';
  arrowEl.style.width = '8px';
  arrowEl.style.height = '8px';
  arrowEl.style.transform = 'rotate(45deg)';

  // Content container — where we drop the resolver's HTML string.
  const content = document.createElement('div');
  content.className = 'content';

  popover.append(content, arrowEl);
  host.append(popover);

  const reposition = async (ref: ReferenceElement) => {
    const { x, y, placement, middlewareData } = await computePosition(
      ref,
      popover,
      {
        placement: 'top',
        middleware: [
          offset(offsetPx),
          flip(),
          shift({ padding: 8 }),
          arrow({ element: arrowEl }),
        ],
      }
    );
    Object.assign(popover.style, {
      transform: `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`,
    });
    // Expose the resolved placement to CSS so the arrow's two bordered
    // edges can track whichever side of the tooltip the arrow sits on.
    // Without this the same two unrotated borders (`right` + `bottom`)
    // render as *inside* edges whenever the tooltip is below / right of
    // the feature, leaving the arrow with visible borders cutting
    // through the tooltip body.
    popover.setAttribute('data-placement', placement);
    const { x: ax, y: ay } = middlewareData.arrow ?? {};
    const side = placement.split('-')[0];
    const staticSide = {
      top: 'bottom',
      right: 'left',
      bottom: 'top',
      left: 'right',
    }[side] as string;
    Object.assign(arrowEl.style, {
      left: ax != null ? `${ax}px` : '',
      top: ay != null ? `${ay}px` : '',
      right: '',
      bottom: '',
      [staticSide]: '-4px',
    });
  };

  // Element that had focus when the popover last opened. On `hide()`
  // we restore focus here so Escape-dismissing the popover drops the
  // keyboard user back where they were. `null` when nothing meaningful
  // was focused (body, detached element) — in that case we skip the
  // restore rather than forcing focus onto body.
  let previouslyFocused: HTMLElement | null = null;

  const show = (ref: ReferenceElement, html: string) => {
    // `innerHTML` is intentional: `feature.tooltipContent` is the
    // already-rendered HTML string produced by `tooltips/resolve.ts`
    // (or by a `kind: 'custom'` render function the integrator owns).
    // Escaping is the resolver's responsibility — the `fields` and
    // `markdown` branches route every dynamic value through
    // `escapeHtml` / `sanitizeUrl` before composing the string, and
    // the `custom` branch is a documented escape-hatch surface.
    // Treating this as untrusted input here would defeat the
    // declarative formatting authors rely on.
    //
    // `eslint-plugin-no-unsanitized` can't see across that resolver
    // boundary, so suppress its warning here with the rationale above
    // as the load-bearing comment. Changing this line to use
    // `textContent` would silently break every existing tooltip.
    // eslint-disable-next-line no-unsanitized/property
    content.innerHTML = html;
    popover.hidden = false;
    // Capture the focus-before-open target so `hide()` can restore
    // it. Skip `document.body` / `null` — "focus body" isn't a
    // meaningful restore target and would just strip focus from
    // wherever the browser auto-placed it after hide. We only care
    // about genuine interactive elements (Nightingale tracks, a
    // sibling link, a dialog button) that the user was on.
    const active = document.activeElement;
    previouslyFocused =
      active instanceof HTMLElement && active !== document.body ? active : null;
    // Move focus into the popover so screen readers announce the
    // content. `preventScroll` stops the page from auto-scrolling to
    // bring the popover into view — Floating UI already positioned
    // it within the viewport and an extra scroll would be jarring.
    popover.focus({ preventScroll: true });
    // Position once. We deliberately don't run `autoUpdate` — any
    // scroll dismisses the popover entirely (see `onScroll` below),
    // and the click point is a page-coordinate snapshot anyway so
    // repositioning during scroll would slide the popover across the
    // track.
    void reposition(ref);
  };

  const hide = () => {
    if (popover.hidden) return;
    popover.hidden = true;
    content.innerHTML = '';
    // Return focus to whatever had it before the popover opened.
    // Only do this if focus is still inside the popover — if the
    // user has already clicked something else, respecting their
    // latest interaction is more important than restoring the
    // original target. `.isConnected` guards against the edge case
    // where the previously-focused element was removed from the DOM
    // while the popover was open (e.g. a virtualised list scrolled
    // it out).
    if (previouslyFocused && previouslyFocused.isConnected) {
      const focusIsInside =
        document.activeElement instanceof Node &&
        popover.contains(document.activeElement);
      if (focusIsInside) {
        previouslyFocused.focus({ preventScroll: true });
      }
    }
    previouslyFocused = null;
  };

  // -------------------------------------------------------------------------
  // Event wiring
  // -------------------------------------------------------------------------

  const onChange = (e: Event) => {
    if (!enabled()) return;
    const detail = (e as CustomEvent<NightingaleChangeDetail>).detail;
    if (!detail || detail.eventType !== 'click') return;
    const html = detail.feature?.tooltipContent;
    if (!html) {
      hide();
      return;
    }
    const [px, py] = detail.coords ?? [0, 0];
    show(virtualElementAt(px, py), html);
  };

  // Any-click dismissal (capture phase, document-wide).
  //
  // The rule is deliberately simple: *any* click that isn't inside the
  // popover itself hides it. That includes:
  //
  //   - clicks outside the host (dismiss)
  //   - clicks on a group-label toggle (layout is about to shift)
  //   - clicks on empty space inside a track (Nightingale doesn't
  //     fire a `change` event for blank clicks, so without this the
  //     popover would stay pinned to the previously-clicked feature)
  //   - clicks on a *different* feature (Nightingale re-fires `change`
  //     during the bubble phase; capture-phase hide runs first, then
  //     `onChange` re-opens at the new click point with fresh content)
  //
  // We listen in capture phase on the document so this runs before
  // Nightingale's own click handlers — the hide → onChange → show
  // sequence is what keeps same-turn re-opens flicker-free.
  const onDocClick = (e: Event) => {
    if (popover.hidden) return;
    if (e.target instanceof Node && popover.contains(e.target)) return;
    hide();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') hide();
  };

  // Scroll dismissal. Capture phase so we see scroll events on any
  // ancestor (the body, a scroll container, the window). Passive is
  // fine — we don't preventDefault, we just hide.
  const onScroll = () => {
    if (!popover.hidden) hide();
  };

  host.addEventListener('change', onChange);
  document.addEventListener('click', onDocClick, true);
  document.addEventListener('keydown', onKey);
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });

  return {
    dispose() {
      host.removeEventListener('change', onChange);
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, { capture: true });
      popover.remove();
    },
  };
}
