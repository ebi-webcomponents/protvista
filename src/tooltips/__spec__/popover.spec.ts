/**
 * Smoke tests for the click-triggered tooltip popover.
 *
 * These tests run under jsdom, which doesn't implement full layout so
 * `computePosition` values end up as zeros / NaN — we don't assert on
 * coordinates. What we do pin down is the *behavioural contract*:
 *
 * - `installClickTooltip` mounts a single `<div role="tooltip">` on the
 *   host and `dispose()` removes it.
 * - A Nightingale `change` event with `eventType: 'click'` and a feature
 *   carrying `tooltipContent` makes the popover visible and stamps the
 *   HTML into its content node.
 * - Hover-style events (`mouseover`, `mouseout`) are *explicitly ignored*.
 *   Click-only is a product decision (no hover flicker on canvas tracks,
 *   no a11y hover-dismiss traps) and regressing it would silently change
 *   the UX, so the invariant gets its own test.
 * - Outside-click and Escape both dismiss.
 * - Scroll anywhere on the document dismisses (we *don't* reposition —
 *   the click point is a page-coordinate snapshot and a tooltip sliding
 *   across the track during scroll reads as UI noise).
 * - Clicking a group-label toggle inside the host dismisses (the
 *   group strip is about to expand/collapse; a stranded popover
 *   pointing at the new layout would be wrong).
 * - `enabled: () => false` gates display (used for `notooltip=""`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installClickTooltip, type TooltipController } from '../popover.js';
import { CSS_PREFIX } from '../../styles/css-prefix.js';

/**
 * Helper to fire the Nightingale-shaped `change` CustomEvent. Matches
 * the detail shape declared in `popover.ts`'s `NightingaleChangeDetail`.
 */
function fireChange(
  host: HTMLElement,
  detail: {
    eventType?: string;
    feature?: { tooltipContent?: string; [k: string]: unknown };
    coords?: [number, number];
  }
) {
  host.dispatchEvent(new CustomEvent('change', { detail }));
}

describe('installClickTooltip', () => {
  let host: HTMLElement;
  let controller: TooltipController | null;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    controller = null;
  });

  afterEach(() => {
    controller?.dispose();
    host.remove();
  });

  it('mounts a single role="tooltip" popover on the host on install', () => {
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
    controller = installClickTooltip(host);
    const popover = host.querySelector<HTMLElement>('[role="tooltip"]');
    expect(popover).not.toBeNull();
    expect(popover!.hidden).toBe(true);
    expect(popover!.classList.contains('protvista-tooltip')).toBe(true);
  });

  it('dispose() removes the popover and detaches listeners', () => {
    controller = installClickTooltip(host);
    expect(host.querySelector('[role="tooltip"]')).not.toBeNull();
    controller.dispose();
    controller = null;
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
    // After disposal a stray click event must not resurrect the tooltip.
    fireChange(host, {
      eventType: 'click',
      feature: { tooltipContent: '<b>X</b>' },
      coords: [10, 10],
    });
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('renders feature.tooltipContent on eventType="click"', async () => {
    controller = installClickTooltip(host);
    fireChange(host, {
      eventType: 'click',
      feature: { tooltipContent: '<b>Hello</b>' },
      coords: [42, 24],
    });
    // Let Floating UI's microtasks settle.
    await Promise.resolve();
    const popover = host.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(popover.hidden).toBe(false);
    expect(popover.querySelector('.content')!.innerHTML).toBe('<b>Hello</b>');
  });

  it('ignores mouseover events (click-only by design)', async () => {
    controller = installClickTooltip(host);
    fireChange(host, {
      eventType: 'mouseover',
      feature: { tooltipContent: '<b>hover</b>' },
      coords: [10, 10],
    });
    await Promise.resolve();
    const popover = host.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(popover.hidden).toBe(true);
    expect(popover.querySelector('.content')!.innerHTML).toBe('');
  });

  it('ignores mouseout events', async () => {
    controller = installClickTooltip(host);
    // Open via click first, then fire mouseout — mouseout must not close
    // or mutate the popover (dismissal is outside-click / Escape only).
    fireChange(host, {
      eventType: 'click',
      feature: { tooltipContent: '<p>pinned</p>' },
      coords: [1, 1],
    });
    await Promise.resolve();
    fireChange(host, { eventType: 'mouseout' });
    await Promise.resolve();
    const popover = host.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(popover.hidden).toBe(false);
    expect(popover.querySelector('.content')!.innerHTML).toBe('<p>pinned</p>');
  });

  it('hides when a click event arrives with no tooltipContent', async () => {
    controller = installClickTooltip(host);
    fireChange(host, {
      eventType: 'click',
      feature: { tooltipContent: '<b>first</b>' },
      coords: [1, 1],
    });
    await Promise.resolve();
    fireChange(host, { eventType: 'click', feature: {}, coords: [1, 1] });
    await Promise.resolve();
    const popover = host.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(popover.hidden).toBe(true);
  });

  it('dismisses on outside click', async () => {
    controller = installClickTooltip(host);
    fireChange(host, {
      eventType: 'click',
      feature: { tooltipContent: '<b>open</b>' },
      coords: [5, 5],
    });
    await Promise.resolve();
    const popover = host.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(popover.hidden).toBe(false);

    // Click somewhere outside both the host and the popover.
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    expect(popover.hidden).toBe(true);
    outside.remove();
  });

  it('clicks inside the popover do NOT dismiss it', async () => {
    controller = installClickTooltip(host);
    fireChange(host, {
      eventType: 'click',
      feature: { tooltipContent: '<a>link</a>' },
      coords: [1, 1],
    });
    await Promise.resolve();
    const popover = host.querySelector<HTMLElement>('[role="tooltip"]')!;
    const link = popover.querySelector('a')!;
    link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    expect(popover.hidden).toBe(false);
  });

  it('dismisses on Escape', async () => {
    controller = installClickTooltip(host);
    fireChange(host, {
      eventType: 'click',
      feature: { tooltipContent: '<b>open</b>' },
      coords: [5, 5],
    });
    await Promise.resolve();
    const popover = host.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(popover.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(popover.hidden).toBe(true);
  });

  it('enabled: () => false suppresses display (notooltip opt-out)', async () => {
    const enabled = vi.fn(() => false);
    controller = installClickTooltip(host, { enabled });
    fireChange(host, {
      eventType: 'click',
      feature: { tooltipContent: '<b>x</b>' },
      coords: [1, 1],
    });
    await Promise.resolve();
    const popover = host.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(popover.hidden).toBe(true);
    expect(enabled).toHaveBeenCalled();
  });

  it('honours a custom className', () => {
    controller = installClickTooltip(host, { className: 'my-tip' });
    const popover = host.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(popover.classList.contains('my-tip')).toBe(true);
    expect(popover.classList.contains('protvista-tooltip')).toBe(false);
  });

  it('dismisses on any scroll (capture phase on the document)', async () => {
    controller = installClickTooltip(host);
    fireChange(host, {
      eventType: 'click',
      feature: { tooltipContent: '<b>open</b>' },
      coords: [5, 5],
    });
    await Promise.resolve();
    const popover = host.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(popover.hidden).toBe(false);

    // Fire a scroll on a nested element — the listener's `capture: true`
    // means we see it on its way *down* to the target, so dismissal
    // happens regardless of where in the DOM the scroll originated.
    const inner = document.createElement('div');
    host.append(inner);
    inner.dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(popover.hidden).toBe(true);
    inner.remove();
  });

  it('dismisses when a group-label toggle inside the host is clicked', async () => {
    controller = installClickTooltip(host);
    // Simulate the host containing a group-label (the caret that
    // expands / collapses the track strip). `<protvista-uniprot>` stamps
    // `data-group-toggle="<id>"` on the element.
    const toggle = document.createElement('div');
    toggle.setAttribute('data-group-toggle', 'DOMAINS');
    toggle.className = `${CSS_PREFIX}-group-label`;
    host.append(toggle);

    fireChange(host, {
      eventType: 'click',
      feature: { tooltipContent: '<b>open</b>' },
      coords: [5, 5],
    });
    await Promise.resolve();
    const popover = host.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(popover.hidden).toBe(false);

    toggle.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    expect(popover.hidden).toBe(true);
  });

  it('dismisses on a click inside the host that is not a feature', async () => {
    // Nightingale doesn't fire a `change` event for clicks on blank
    // space inside a track, so the only signal we have to dismiss is
    // the native click itself. Without this the tooltip stays pinned
    // to the previously-clicked feature forever.
    controller = installClickTooltip(host);
    fireChange(host, {
      eventType: 'click',
      feature: { tooltipContent: '<b>feature</b>' },
      coords: [5, 5],
    });
    await Promise.resolve();
    const popover = host.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(popover.hidden).toBe(false);

    // A plain <div> inside the host — no feature, no group-toggle.
    const blank = document.createElement('div');
    host.append(blank);
    blank.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    expect(popover.hidden).toBe(true);
    blank.remove();
  });

  it('dismisses when a descendant of the group-label is clicked', async () => {
    // Group labels are Markdoc-rendered and can nest inline markup —
    // a `{% help %}` span or an inline link. The
    // closest('[data-group-toggle]') lookup must walk up from the
    // event target to catch those clicks too.
    controller = installClickTooltip(host);
    const toggle = document.createElement('div');
    toggle.setAttribute('data-group-toggle', 'DOMAINS');
    const inner = document.createElement('span');
    inner.textContent = 'Domains';
    toggle.append(inner);
    host.append(toggle);

    fireChange(host, {
      eventType: 'click',
      feature: { tooltipContent: '<b>open</b>' },
      coords: [5, 5],
    });
    await Promise.resolve();
    const popover = host.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(popover.hidden).toBe(false);

    inner.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    expect(popover.hidden).toBe(true);
  });

  it('dispose() detaches the scroll listener', () => {
    controller = installClickTooltip(host);
    fireChange(host, {
      eventType: 'click',
      feature: { tooltipContent: '<b>open</b>' },
      coords: [5, 5],
    });
    controller.dispose();
    controller = null;
    // After disposal, firing scroll must not throw (listener gone) and
    // the DOM element is already removed — nothing to assert beyond
    // "no exception, no resurrection".
    document.dispatchEvent(new Event('scroll'));
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
  });
});
