// @vitest-environment node

/**
 * Guards the packaging contract: the `package.json` fields consumers
 * resolve through, and the source-authoring convention the emitted
 * declarations depend on.
 *
 * The load-bearing field is `sideEffects`. Setting it to `false` promises
 * consumers' bundlers that every module here is pure — that dropping one
 * whose exports go unused changes nothing observable. That promise is
 * false: `src/protvista-uniprot.ts` registers the element through a
 * `@customElement` decorator, so *evaluating* the module is the
 * registration. Under the promise, the documented
 * `import 'protvista-uniprot';` (no bindings, nothing "used") is legally
 * deleted from a production bundle, the decorator never runs, and the tag
 * silently stays undefined. Dev servers evaluate eagerly, so this only
 * ever shows up in a shipped build.
 *
 * The assertions pin invariants rather than mechanisms, so a future
 * maintainer can reintroduce a *correct* `sideEffects` allowlist, or a CJS
 * build, without this file standing in the way.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Vitest runs from the repo root, so resolve paths from cwd.
const root = process.cwd();
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));

/** Strip `./`, so `module`-style and `exports`-style paths compare equal. */
const bare = (p: string) => p.replace(/^\.\//, '');

/** Every authored module under `src/`, excluding test-only trees. */
const sourceModules = () => {
  const skip = /(^|\/)(__spec__|__tests__|__mocks__|__browser__)(\/|$)/;
  return readdirSync(resolve(root, 'src'), { recursive: true, encoding: 'utf8' })
    .map((entry) => `src/${entry.split('\\').join('/')}`)
    .filter((rel) => rel.endsWith('.ts') && !skip.test(rel));
};

/**
 * Drop comments so prose that merely *mentions* a module specifier is not
 * mistaken for one. Truncating a `//` inside a string literal is harmless
 * here — it cannot manufacture a relative-import match.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('package.json packaging contract', () => {
  it('does not declare the package side-effect-free', () => {
    // `false` would license bundlers to drop the bare
    // `import 'protvista-uniprot'` documented in the README, leaving
    // <protvista-uniprot> undefined. An empty array is not a safer
    // spelling — webpack treats `[]` as exactly equivalent to `false`.
    const claimsPurity =
      pkg.sideEffects === false ||
      (Array.isArray(pkg.sideEffects) && pkg.sideEffects.length === 0);
    expect(claimsPurity).toBe(false);
  });

  it('has no `main` field', () => {
    // Vite builds `formats: ['es']` only, so the pre-Vite
    // `dist/protvista-uniprot.js` is never emitted — the `dist/*.js` that
    // do exist are lazy `import()` chunks, not a CJS entry. Reinstating
    // `main` means shipping a real CJS build to point it at.
    expect(pkg.main).toBeUndefined();
  });

  it('declares the entry points bundlers and TypeScript resolve through', () => {
    // The top-level `module`/`types` are redundant with the `exports`
    // `import`/`types` conditions for any modern resolver, but kept
    // deliberately: they are the legacy node10 fallback *and* this spec's
    // canonical source for the built entry/declaration paths — asserted
    // here, gated on by the dist/ describe below, and flattened into its
    // `declared` list. Drop them only together with those references; do
    // not let one copy drift out of step with `exports`.
    expect(typeof pkg.module).toBe('string');
    expect(pkg.exports?.['.']).toBeTypeOf('object');
    expect(pkg.exports['.']).not.toBeNull();
  });

  it('declares itself ESM', () => {
    // Everything shipped is ESM, but two things are named in a way that
    // reads as CommonJS without this field: the lazy `import()` chunks
    // Vite emits as `dist/*.js` (`chunkFileNames` in vite.config.mjs),
    // which Node otherwise sniffs and reparses, and the generated
    // `dist/types/*.d.ts`, which TypeScript otherwise treats as a CJS
    // declaration describing an ESM file ("masquerading as CJS").
    expect(pkg.type).toBe('module');
  });

  it('resolves types through `exports`, first and before `default`', () => {
    // Without a `types` condition, TypeScript on `moduleResolution`
    // `bundler`/`node16` resolves *through* `exports` and never consults
    // the top-level `types` field, so consumers get no declarations.
    const conditions = Object.keys(pkg.exports['.']);
    expect(conditions).toContain('types');
    expect(conditions[0]).toBe('types');
    if (conditions.includes('default')) {
      expect(conditions[conditions.length - 1]).toBe('default');
    }
  });
});

describe('source authors ESM-resolvable relative specifiers', () => {
  // `vite-plugin-dts` emits declarations that reproduce whatever the source
  // wrote. An extensionless `./foo` is legal under `moduleResolution:
  // "bundler"` but does not resolve for a consumer on `node16`/`nodenext`,
  // which reports it as an internal resolution error and degrades the
  // types. `NodeNext` would enforce this at compile time, but cannot be
  // enabled: several `@nightingale-elements` packages declare
  // `"type": "module"` yet use extensionless relative imports in their own
  // `.d.ts`, so their exports vanish under Node ESM resolution.
  const RELATIVE = /(from\s*|import\s*\(\s*|import\s+)(['"])(\.\.?\/[^'"]*)\2/g;
  // The extensions Node can actually resolve, plus the asset types covered
  // by ambient declarations. Deliberately excludes `.ts`/`.tsx`: a `.d.ts`
  // pointing at `./foo.ts` is as unresolvable for a consumer as `./foo`.
  const EMITTED = /\.(js|mjs|cjs|json|svg|css|ya?ml)$/i;

  it('every relative import in src carries an explicit extension', () => {
    const offenders: string[] = [];

    for (const rel of sourceModules()) {
      for (const [, , , spec] of stripComments(read(rel)).matchAll(RELATIVE)) {
        // Vite query imports (`?raw`) are covered by ambient declarations.
        const path = spec.split('?')[0];
        if (!EMITTED.test(path)) offenders.push(`${rel}: '${spec}'`);
      }
    }

    expect(
      offenders,
      `Add the emitted extension (e.g. './foo' -> './foo.js', './bar' -> './bar/index.js').`
    ).toEqual([]);
  });
});

// Gate on the Vite bundle rather than on `dist/` existing: these mean
// something only after a real `yarn build`. Nothing in CI builds before
// testing, so treat a green run here as evidence only when you built first.
describe.skipIf(!pkg.module || !existsSync(resolve(root, pkg.module)))(
  'package.json entry points resolve against a built dist/',
  () => {
    // Package-root-relative (`dist/types/index.d.ts`), so these compare
    // directly against the paths `package.json` declares.
    const distEntries = () =>
      readdirSync(resolve(root, 'dist'), { recursive: true, encoding: 'utf8' })
        .map((entry) => `dist/${entry.split('\\').join('/')}`);

    // Every path the manifest advertises, de-duplicated across the `./`
    // that `exports` requires and `module`/`types` omit. Nested condition
    // objects are flattened so adding one does not throw here.
    const declared = [
      ...new Set(
        [pkg.module, pkg.types, ...Object.values(pkg.exports['.'])]
          .flatMap((v) => (typeof v === 'object' && v ? Object.values(v) : [v]))
          .filter((v): v is string => typeof v === 'string')
          .map(bare)
      ),
    ];

    it.each(declared)('%s exists', (rel) => {
      expect(existsSync(resolve(root, rel))).toBe(true);
    });

    it('emits declarations from exactly one producer', () => {
      // `tsc` and vite-plugin-dts both used to emit declarations. The
      // plugin's output directory was misconfigured (`outDir` is not an
      // option it reads), so the two wrote to different trees and `dist/`
      // shipped two full copies. tsc is `noEmit` now and the plugin owns
      // the directory `types` points at.
      const typesDir = `${dirname(bare(pkg.types))}/`;
      const stray = distEntries().filter(
        (rel) => rel.endsWith('.d.ts') && !rel.startsWith(typesDir)
      );

      expect(stray).toEqual([]);
    });

    it('does not ship declarations for test files', () => {
      const tests = distEntries().filter(
        (rel) => rel.endsWith('.d.ts') && /__(spec|tests|browser)__/.test(rel)
      );

      expect(tests).toEqual([]);
    });
  }
);
