/**
 * Minimal mount helper for the browser specs: append an element to the
 * live document and register it for teardown, mirroring the `mountEl`
 * pattern in `src/__spec__/error-surface.spec.ts`. Real mounting (not a
 * detached render) is what gives us real focus, real keyboard events and
 * a real layout for axe to inspect.
 */
import { afterEach } from 'vitest';

const mounted: HTMLElement[] = [];

/** Create `<tag>`, apply `props`, append to `<body>`, and track it. */
export function mount<T extends HTMLElement>(
  tag: string,
  props: Partial<T> = {}
): T {
  const el = document.createElement(tag) as T;
  Object.assign(el, props);
  document.body.append(el);
  mounted.push(el);
  return el;
}

/** Append an already-created element and track it for teardown. */
export function track<T extends HTMLElement>(el: T): T {
  document.body.append(el);
  mounted.push(el);
  return el;
}

/**
 * Remove every tracked element.
 *
 * Exported because Vitest resolves `sequence.hooks` to `"stack"`: this
 * module's `afterEach` is registered at import time, so it runs *after* a
 * spec's own. A spec that stubs `fetch` must therefore unmount before it
 * restores the real one, or its still-live components can fire real
 * network requests during teardown. Calling this first in the spec's
 * `afterEach` fixes the order; the hook below stays as the backstop for
 * specs that don't.
 */
export function unmountAll(): void {
  for (const el of mounted.splice(0)) el.remove();
}

afterEach(unmountAll);
