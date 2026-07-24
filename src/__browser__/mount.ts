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

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
});
