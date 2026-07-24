/**
 * Guard an imported SVG icon before handing it to lit's `unsafeHTML`.
 *
 * The library build inlines `import icon from './x.svg'` as a raw SVG
 * *string* (via `vite-plugin-svgo`). Other bundlers — notably Astro, which
 * powers the docs playground — resolve the same import to an image-metadata
 * *object* instead, and `unsafeHTML()` rejects a non-string with "called
 * with a non-string value", which throws mid-render and blanks the whole
 * viewer. Coerce anything that isn't a string to '' so a mis-resolved icon
 * degrades to nothing rather than taking the component down.
 */
export const inlineSvg = (icon: unknown): string =>
  typeof icon === 'string' ? icon : '';
