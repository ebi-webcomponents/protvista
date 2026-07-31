# Spec: Browser `process` shim so the published dist inits Mol\*

Status: **Implemented** (source) — pending build verification + `beta.3` republish
Owner: _unassigned_
Related: `src/process-shim.ts`, `src/index.ts`, `src/__spec__/package-contract.spec.ts`,
`src/protvista-uniprot-structure.ts`, `scripts/screenshots/` (real-Mol\* coverage).

---

## 1. Context & motivation

`protvista-uniprot` is published as an ES module and documented for use straight
from a CDN, with no bundler:

```html
<script type="module"
  src="https://cdn.jsdelivr.net/npm/protvista-uniprot@<v>/dist/protvista-uniprot.mjs"></script>
<protvista-uniprot accession="P05067"></protvista-uniprot>
```

The 3D structure pane (`<protvista-uniprot-structure>` →
`@nightingale-elements/nightingale-structure` → Mol\*) reads Node globals when it
initialises — bare `process.env`, `process.hrtime`, `process.versions`. A
bundler (webpack / Vite app builds) normally supplies `process`; a bare browser
does not. So in the exact configuration the embed docs describe, `process` is
undefined and Mol\* throws the moment it initialises the 3D pane.

This affects **every CDN / no-bundler adopter**, not a niche setup.

## 2. Symptom & reproduction

Load the minimal embed above (in `5.0.0-beta.2`) with the structure endpoints
reachable (`rest.uniprot.org`, `www.ebi.ac.uk`, `alphafold.ebi.ac.uk`):

- The 2D tracks render normally.
- The 3D pane stays blank at its default 300×150.
- Console:
  ```
  Uncaught ReferenceError: process is not defined
  Failed to init Mol*
  ```

The element resolves the structure correctly and even issues the 3D-Beacons /
mappings requests, but the model coordinates are never fetched because init
aborts first. Defining `window.process` before the module loads makes Mol\*
initialise and the ribbon model (PDB `1AAP` for `P05067`) render — which
isolates the cause to the missing global, not the data path.

The 2D tracks are unaffected because they never touch `process`, and the
throwing reference is read **lazily at Mol\* init**, not at module evaluation —
so the bundle still *loads*; only the 3D pane fails.

## 3. Root cause

- Mol\* and its dependencies reference Node globals.
  `@nightingale-elements/nightingale-structure` bundles Mol\* into
  `dist/protvista-uniprot.mjs` (Vite library build, ES format).
- The library build does not make those references browser-safe. The refs that
  survive into the shipped bundle are to the **bare** `process.env` object (plus
  `process.hrtime` / `process.versions`), which throw when there is no `process`
  global.

Why the usual one-liner is **not** enough: the standard Mol\* fix,
`define: { 'process.env.NODE_ENV': '"production"' }`, only rewrites the literal
token `process.env.NODE_ENV`, which does not appear here. It does not touch bare
`process.env` / `process.hrtime` / `process.versions`. The fix has to guarantee
a `process` object *exists* at runtime, not replace one property.

## 4. The fix

A minimal, guarded `process` shim shipped inside the library entry, installed
before any element / Mol\* module can initialise. It makes the published dist
self-contained for bare browsers and is a no-op for bundler consumers.

### 4.1 Affected files

- **`src/process-shim.ts`** (new) — a side-effect module that installs a minimal
  `process` on `globalThis`, guarded on `typeof … === 'undefined'`.
- **`src/index.ts`** — `import './process-shim.js';` as the **first** statement.
- **`src/__spec__/package-contract.spec.ts`** — a regression assertion in the
  existing dist-gated block.

### 4.2 The shim

```ts
if (typeof (globalThis as any).process === 'undefined') {
  (globalThis as any).process = {
    env: { NODE_ENV: 'production' },
    versions: {},
    platform: 'browser',
    hrtime: Object.assign(() => [0, 0], { bigint: () => BigInt(0) }),
    nextTick: (fn, ...args) => setTimeout(() => fn(...args), 0),
  };
}
```

### 4.3 Why a dedicated module imported *first*, not an inline statement

ES module `import` / `export … from` declarations are **hoisted**: a module's
imported dependencies are evaluated before any statement in the importing
module's body. So a shim written as the "first statement" of `index.ts`'s body
would actually run *after* the structure / Mol\* modules are evaluated. It
happens to work anyway for this bug because the throwing access is lazy (Mol\*
init, not module-eval), but that is a fragile reason.

Putting the shim in its own module and importing it first makes the ordering
correct by construction: `process-shim.ts` has no dependencies, so it is the
first module Rollup evaluates in the bundle — the `process` global is in place
before *any* Mol\* code runs, lazy or eager.

### 4.4 Why guarded

The `typeof … === 'undefined'` guard means a consumer whose bundler or runtime
already provides `process` (webpack / Vite apps, SSR, Node) keeps theirs
untouched. The shim only ever runs on the bare-browser path it exists for, and
never overwrites an existing `process`.

### 4.5 The `./config` subpath stays pure

`src/config.ts` (the `protvista-uniprot/config` entry) does **not** import the
shim, so that entry remains side-effect-free — its purity is enforced at source
by `config-subpath-purity.spec.ts` (which walks only from `config.ts`) and, at
the built-artifact level, by the negative half of the new assertion in §5.2.

### 4.6 Alternatives considered

- **Build `define` for `process.env.NODE_ENV`** — insufficient on its own (see
  §3). Still a worthwhile *optional* add on top of the shim, to dead-code-
  eliminate Mol\*'s dev-only branches (smaller bundle). Left out for now to keep
  the change surgical and avoid interaction with the existing
  `vite-plugin-env-compatible`.
- **Rollup `inject({ process: 'process/browser' })`** — needs a new dependency
  and may not provide `hrtime` / `versions`.
- **Output `banner` shim** — would prepend to every output (including the pure
  `./config` entry) and, because banners sit above hoisted imports, carries the
  same eval-order caveat as an inline statement.

The entry shim makes the artifact correct regardless of how it is consumed,
without new dependencies or build-config risk.

## 5. Why it shipped undetected — and the test gap now closed

Both existing test surfaces are structurally incapable of catching this:

1. **Unit + browser Vitest projects mock Mol\* away.** `vite.config.mjs` loads
   `src/__spec__/nightingale-mocks.ts` (reused by `src/__browser__/setup.ts`),
   which stubs every `@nightingale-elements/*` module — and
   `<protvista-uniprot-structure>` — to trivial `HTMLElement` subclasses. Real
   Mol\* never runs under `yarn test`.
2. **The screenshot harness runs real Mol\*, but against the docs app build.**
   `scripts/screenshots/` builds and serves the Astro/Vite docs site (app mode,
   which supplies `process`) and photographs the `home-hero` / `structure-viewer`
   shots with SwiftShader. The published library artifact is never exercised in a
   bare-browser context.

So the "published dist, loaded in a browser with no bundler" path — the one real
adopters use — had no coverage.

### 5.1 Regression guard added

`src/__spec__/package-contract.spec.ts` gains an assertion inside its existing
`describe.skipIf(!built)` block — the one CI runs against a real `dist/` in the
build job, which skips when no build is present. It asserts:

- the **built entry** (`dist/protvista-uniprot.mjs`) installs `globalThis.process`;
- the **`./config`** output (`dist/config.mjs`) does **not**.

It is whitespace-insensitive (holds minified or not). The assignment to
`globalThis.process` is the shim's signature and never occurs in Mol\*, which
*reads* `process` but never assigns the global — so it does not false-match. This
fails if the shim is removed.

### 5.2 Stronger follow-up (not yet added)

A browser regression test that exercises the built dist end-to-end: build,
serve `dist/protvista-uniprot.mjs` via `<script type="module">` with `process`
left undefined, replay the structure endpoints from
`scripts/screenshots/fixtures`, launch Chromium with the harness's SwiftShader
flags, and assert no `process is not defined` / `Failed to init Mol*` in the
console, that `<nightingale-structure>` mounts, and that its `<canvas>` grows
past 300×150 (the model loaded). This is essentially the `structure-viewer` shot
pointed at the published dist instead of the docs app.

## 6. Verification

Static analysis and the source/config review confirm the diagnosis and that the
shim is placed correctly and cannot leak into the pure subpath. The remaining
steps require a build:

```bash
yarn build
# Shim present; remaining refs are only our own / guarded:
grep -c 'globalThis.process' dist/protvista-uniprot.mjs           # > 0
grep -oE 'process\.(env|hrtime|versions)' dist/protvista-uniprot.mjs | sort | uniq -c

# Regression guard, against the fresh dist/:
yarn vitest run --project unit src/__spec__/package-contract.spec.ts

# Full gate:
yarn test && yarn validate
```

Acceptance gate: load the freshly built dist from the §2 reproduction (no
bundler) and confirm the 3D pane renders `1AAP` for `P05067` with no `process`
error, and that removing the shim reproduces the failure.

## 7. Rollout

- Bump to `5.0.0-beta.3` and republish under the `beta` dist-tag.
- Downstream CDN embeds can then drop any `window.process` workaround.
