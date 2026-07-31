/**
 * Browser `process` shim for the published library bundle.
 *
 * The 3D structure pane (`<protvista-uniprot-structure>` ->
 * `@nightingale-elements/nightingale-structure` -> Mol*) reads Node globals when
 * it initialises — bare `process.env`, `process.hrtime`, `process.versions` —
 * that a bundler normally supplies but a bare browser does not. Loaded straight
 * from a CDN as `<script type="module">` (the documented no-bundler embed),
 * `process` is undefined, so the moment Mol* initialises the pane it throws
 * `ReferenceError: process is not defined` ("Failed to init Mol*") and the 3D
 * pane stays blank. The 2D tracks are unaffected: they never touch `process`,
 * and the reference is read lazily at Mol* init, not at module evaluation, so
 * the bundle still *loads*.
 *
 * This module installs a minimal `process` on `globalThis` so the shipped
 * `dist/` runs unchanged in that context. `src/index.ts` imports it *first*,
 * before any element / Mol* module, so the global is in place before the
 * structure element can initialise.
 *
 * Guarded on `typeof … === 'undefined'`: a consumer whose bundler or runtime
 * already provides `process` (webpack / Vite apps, SSR, Node) keeps theirs
 * untouched, so this is a no-op everywhere except the bare-browser path it
 * exists for. The `./config` subpath (`src/config.ts`) does not import this
 * module, so that entry stays side-effect-free.
 *
 * Note the usual Mol* one-liner — replacing `process.env.NODE_ENV` via a build
 * `define` — is *not* enough here: the references are to the bare `process.env`
 * object (plus `process.hrtime` / `process.versions`), so the fix must
 * guarantee a `process` object exists rather than rewrite a single property.
 */

// Reference `globalThis` directly (no local alias) so the assignment survives
// minification as a literal `globalThis.process = …`; that signature is what
// package-contract.spec.ts asserts shipped in the built entry.
if (typeof (globalThis as any).process === 'undefined') {
  (globalThis as any).process = {
    env: { NODE_ENV: 'production' },
    versions: {},
    platform: 'browser',
    // Mol* reads both the tuple and `.bigint()` forms of `hrtime`; neither
    // needs a real clock here, only to not throw.
    hrtime: Object.assign(() => [0, 0], { bigint: () => BigInt(0) }),
    nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
      setTimeout(() => fn(...args), 0),
  };
}
