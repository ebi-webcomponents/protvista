// @vitest-environment node

/**
 * Guards the promise the `protvista-uniprot/config` subpath makes: importing
 * it registers no custom element and pulls in no viewer code.
 *
 * The value is entirely in *what a consumer's bundler can drop*. The package
 * root self-registers `<protvista-uniprot>` on load, so a bundler must retain
 * it (and Lit, every Nightingale track, Mol*) whenever it is reached. The
 * `./config` entry (`src/config.ts`) exists so a consumer that only needs the
 * pure `filterConfig` / `colorConfig` data has a path that reaches none of
 * that. One stray `import` — a convenience re-export from the barrel, a
 * runtime Nightingale value pulled into `filter-config.ts` — silently
 * reconnects the element and the subpath stops being tree-shakeable, with no
 * error anywhere: the config still works, it just drags the bundle again.
 *
 * So this walks the subpath's *static* import graph over `src/` and fails if
 * it reaches a `@customElement` / `customElements.define`, one of the element
 * modules, or a runtime (non-`type`) Nightingale import. It reasons about
 * source, not `dist/`, so it runs in CI without a build and pins the invariant
 * at the layer a maintainer actually edits.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

/**
 * Drop comments before scanning, so this file's own prose (which names
 * `customElements.define` and the element modules to explain itself) and the
 * doc comments in the modules it walks are never mistaken for code.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

// `import ... from '...'` and `export ... from '...'`, capturing the clause
// between the keyword and `from` (to tell a type-only import apart) and the
// module specifier. The clause excludes quotes and `;` so a preceding bare
// `import '...';` can never be absorbed into an adjacent from-import's clause.
// Bare `import '...'` is matched separately (BARE): it has no bindings, so it
// is never type-only — it is a pure side-effect import, the exact thing this
// path must not contain.
const FROM = /\b(?:import|export)\s+([^'";]*?)\s+from\s*['"]([^'"]+)['"]/g;
const BARE = /\bimport\s*['"]([^'"]+)['"]/g;

const isRelative = (spec: string) => spec.startsWith('.');
const isNightingale = (spec: string) =>
  spec.startsWith('@nightingale-elements/');

/**
 * A `from`-clause is type-only (erased at runtime, no dependency created)
 * when it is `import type …` / `export type …`, or a braced list whose every
 * specifier carries the inline `type` modifier.
 */
const clauseIsTypeOnly = (clause: string) => {
  const c = clause.trim();
  if (/^type\b/.test(c)) return true;
  const open = c.indexOf('{');
  const close = c.lastIndexOf('}');
  if (open === -1 || close === -1) return false; // default/namespace value import
  const names = c
    .slice(open + 1, close)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length > 0 && names.every((n) => /^type\s/.test(n));
};

/** Resolve a `./foo.js`-style source specifier to its authored `.ts` file. */
const resolveRelative = (fromRel: string, spec: string) => {
  const base = resolve(root, dirname(fromRel), spec.split('?')[0]);
  const candidates = base.endsWith('.ts')
    ? [base]
    : [
        base.replace(/\.[cm]?js$/, '.ts'),
        `${base}.ts`,
        resolve(base, 'index.ts'),
      ];
  for (const abs of candidates) {
    try {
      readFileSync(abs);
      return abs.slice(root.length + 1).split('\\').join('/');
    } catch {
      /* try next candidate */
    }
  }
  throw new Error(`cannot resolve '${spec}' from ${fromRel}`);
};

/** Every `src/` module statically reachable from `entry`, entry included. */
const reachableFrom = (entry: string) => {
  const seen = new Set<string>();
  const runtimeNightingale: string[] = [];
  const queue = [entry];

  while (queue.length) {
    const rel = queue.pop() as string;
    if (seen.has(rel)) continue;
    seen.add(rel);

    const src = stripComments(read(rel));
    for (const [, clause, spec] of src.matchAll(FROM)) {
      // Only follow *runtime* edges: a type-only import/re-export is erased,
      // so it creates no reachability and no side effect. This keeps the walk
      // measuring what "importing ./config runs" actually reaches.
      if (clauseIsTypeOnly(clause)) continue;
      if (isRelative(spec)) {
        queue.push(resolveRelative(rel, spec));
      } else if (isNightingale(spec)) {
        runtimeNightingale.push(`${rel}: ${spec}`);
      }
    }
    // A bare `import '…'` is a pure side-effect import — the canonical way an
    // element package registers itself on load. Follow a relative one into the
    // graph; flag a bare Nightingale one directly (it never lands in the
    // reachable set, so it would otherwise slip past every check below).
    for (const [, spec] of src.matchAll(BARE)) {
      if (isRelative(spec)) queue.push(resolveRelative(rel, spec));
      else if (isNightingale(spec)) runtimeNightingale.push(`${rel}: ${spec}`);
    }
  }

  return { modules: seen, runtimeNightingale };
};

const ENTRY = 'src/config.ts';
const graph = reachableFrom(ENTRY);

describe('protvista-uniprot/config is a side-effect-free import', () => {
  it('reaches no custom-element registration', () => {
    const offenders: string[] = [];
    for (const rel of graph.modules) {
      const src = stripComments(read(rel));
      if (/@customElement\s*\(/.test(src) || /customElements\.define\s*\(/.test(src)) {
        offenders.push(rel);
      }
    }
    expect(
      offenders,
      `Modules reachable from ${ENTRY} register a custom element, so importing ` +
        `the ./config subpath is no longer side-effect-free. Keep config.ts a ` +
        `re-export of pure modules only.`
    ).toEqual([]);
  });

  it('does not reach the element modules', () => {
    const elementModules = [
      'src/index.ts',
      'src/protvista-uniprot.ts',
      'src/protvista-uniprot-structure.ts',
      'src/protvista-uniprot-datatable.ts',
      'src/built-in-components.ts',
    ];
    const reached = elementModules.filter((m) => graph.modules.has(m));
    expect(reached).toEqual([]);
  });

  it('creates no runtime dependency on a Nightingale element package', () => {
    // A value import of a `@nightingale-elements/*` package can register an
    // element on load; keep every such import in this graph type-only.
    expect(graph.runtimeNightingale).toEqual([]);
  });
});
