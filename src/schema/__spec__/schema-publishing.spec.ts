/**
 * Publish-URL invariants for the JSON Schema (issue #209).
 *
 * These tests exist so the schema's hosted identity can't silently
 * regress: the `$id` must point at the canonical GitHub Pages URL, the
 * frozen `public/schema/v1/` copy must never drift from the authored
 * source, `default-config.yaml` must reference the same canonical URL,
 * and the retired `.invalid` placeholder must never reappear anywhere
 * in the repo (e.g. via a bad cherry-pick from `main` — see
 * docs/sync-from-main.md, which flags `main`'s `src/schema/*` as a path
 * that must never be taken from `main` via `git checkout --theirs`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfigText } from '../parse.js';

// Canonical GitHub Pages URL. The path segment is the *repo* name
// (`protvista`, already renamed from `protvista-uniprot` — the npm
// package keeps the old name, but Pages URLs are keyed on the repo),
// so this must never revert to the `protvista-uniprot` segment.
const CANONICAL_SCHEMA_URL =
  'https://ebi-webcomponents.github.io/protvista/schema/v1/config.schema.json';

const schemaPath = resolve(process.cwd(), 'src/schema/schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
  $id?: string;
};

// The one version every hardcoded CDN pin must name. Same source of
// truth as starter-kit.spec.ts, so a release bump moves both in lockstep.
const PACKAGE_VERSION: string = (
  JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

describe('JSON Schema — hosting invariants', () => {
  it('declares the canonical $id (no drift, no vanity/unreachable URL)', () => {
    expect(schema.$id).toBe(CANONICAL_SCHEMA_URL);
  });

  it('the frozen public/v1 copy is byte-identical to the authored source', () => {
    const source = readFileSync(schemaPath, 'utf8');
    const publicCopy = readFileSync(
      resolve(process.cwd(), 'public/schema/v1/config.schema.json'),
      'utf8'
    );
    expect(
      publicCopy,
      'public/schema/v1/config.schema.json drifted from src/schema/schema.json — run `yarn schema:sync` to regenerate it'
    ).toBe(source);
  });

  it('default-config.yaml references the canonical schema URL', async () => {
    const raw = readFileSync(
      resolve(process.cwd(), 'src/default-config.yaml'),
      'utf8'
    );
    const parsed = (await parseConfigText(raw, 'yaml')) as {
      $schema?: string;
    };
    expect(parsed.$schema).toBe(CANONICAL_SCHEMA_URL);
  });

  it('no file in the repo still references the retired placeholder URL', () => {
    expect(findPlaceholderReferences()).toEqual([]);
  });
});

describe('npm distribution — files the Starter Kit fetches from the CDN', () => {
  // The Starter Kit (`starter-kit/`, published to
  // ebi-webcomponents/protvista-starter-kit) ships a recipe whose
  // `extends:` points at
  // https://cdn.jsdelivr.net/npm/protvista-uniprot@<version>/dist/default-config.yaml
  //
  // jsDelivr serves that path straight out of the npm tarball. The package
  // publishes only `dist` (a lean tarball — no raw `src`), so the build copies
  // the self-contained `src/default-config.yaml` into `dist/default-config.yaml`
  // (the emit step in vite.config.mjs). These two guards keep the chain intact:
  // `dist` stays published (below), and the config's source of truth still
  // exists (below); the tarball guard in scripts/validate-package.sh pins that
  // the emitted `dist/default-config.yaml` actually ships. Break any link and a
  // deployed Starter Kit's `extends:` 404s, with nothing else here failing.
  const pkg = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')
  ) as { files?: string[] };

  it('publishes `dist`, which the Starter Kit `extends:` URL resolves into', () => {
    expect(pkg.files).toContain('dist');
  });

  it('still ships the source config the build copies into dist/', () => {
    expect(
      statOrNull(resolve(process.cwd(), 'src/default-config.yaml'))
    ).not.toBeNull();
  });
});

describe('CDN version pins — every jsDelivr pin tracks this release', () => {
  // The Starter Kit and the docs both hardcode
  // `cdn.jsdelivr.net/npm/protvista-uniprot@<version>/…` URLs. The kit's
  // pins are already gated by starter-kit.spec.ts, but the docs' were
  // not: on a version bump the kit would update under test pressure
  // while the doc URLs silently went stale. This repo-wide check closes
  // that gap, covering the kit and the docs from one source of truth.
  it('names PACKAGE_VERSION in every jsDelivr protvista-uniprot URL', () => {
    const pins = findCdnVersionPins();

    // Non-vacuous guard: the files that carry a pin today must all be
    // found, so a regex typo can't let this pass on zero matches.
    expect(
      pins.map((p) => p.file),
      'expected jsDelivr pins in the kit and the docs to be scanned'
    ).toEqual(
      expect.arrayContaining([
        'starter-kit/index.html',
        'starter-kit/recipes/extend-uniprot.yaml',
        'docs/src/content/docs/configure.md',
        'docs/src/content/docs/tutorial.md',
      ])
    );

    for (const { file, version } of pins) {
      expect(
        version,
        `${file} pins protvista-uniprot@${version}, but this package is ` +
          `${PACKAGE_VERSION} — bump it alongside the release`
      ).toBe(PACKAGE_VERSION);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Repo-wide scans. A single walker (`eachRepoFile`) crosses the whole
// repository tree from the root (so root-level files like `index.html`
// and `package.json` are covered, not just a hand-picked set of
// directories), skipping VCS / dependency / build-output dirs. Test
// fixtures and snapshots are NOT excluded — a placeholder hiding in a
// config fixture is exactly the kind of regression this guards against.
// Only this spec file is skipped, since it necessarily names the
// placeholder-shaped strings below as the very markers it scans for.
//
// Two checks ride on that walk: the placeholder scan
// (`findPlaceholderReferences`) and the CDN version-pin check
// (`findCdnVersionPins`), which keeps every jsDelivr `protvista-uniprot`
// pin — in the kit and the docs alike — in step with this package.
// ─────────────────────────────────────────────────────────────

const SELF_PATH = fileURLToPath(import.meta.url);

const SCAN_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.yaml',
  '.yml',
  '.md',
  '.html',
]);
const IGNORE_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'demo',
  'site',
  'coverage',
  'build',
  '.git',
  '.yalc',
  '.lighthouseci',
  '.vscode',
  '.idea',
]);
const PLACEHOLDER_MARKERS: Array<string | RegExp> = [
  'TODO-PUBLISH-BEFORE-V5-RELEASE',
  'ebi.ac.uk/protvista/config.schema.json',
  // Any `.invalid` TLD used as a schema URL — catches a future placeholder
  // even if it isn't the exact `TODO-PUBLISH-…` string, including variants
  // like `.invalid/protvista-uniprot`. Requires `protvista` in the path so
  // the legitimate `example.invalid` fetch-failure fixture in src/__spec__/
  // doesn't trip it.
  /\.invalid\/[\w-]*protvista/,
];

function findPlaceholderReferences(): string[] {
  const offenders: string[] = [];
  eachRepoFile((relPath, content) => {
    const hit = PLACEHOLDER_MARKERS.some((marker) =>
      typeof marker === 'string'
        ? content.includes(marker)
        : marker.test(content)
    );
    if (hit) offenders.push(relPath);
  });
  return offenders;
}

// Any versioned jsDelivr pin of the component. Anchoring on the CDN
// prefix is deliberate: the bare `protvista-uniprot@4.9.3` mentions in
// docs prose name the *published* release, which predates this one, and
// must not be forced to the dev version. Broadening to another CDN host
// later is a one-line change to this pattern.
const CDN_PIN_RE = /cdn\.jsdelivr\.net\/npm\/protvista-uniprot@(\d+\.\d+\.\d+)/g;

function findCdnVersionPins(): { file: string; version: string }[] {
  const pins: { file: string; version: string }[] = [];
  eachRepoFile((file, content) => {
    for (const m of content.matchAll(CDN_PIN_RE)) {
      pins.push({ file, version: m[1] });
    }
  });
  return pins;
}

// Hand every scannable file to `visit` as a repo-relative path plus its
// text, skipping VCS / dependency / build-output dirs and this spec.
function eachRepoFile(
  visit: (relPath: string, content: string) => void
): void {
  const root = process.cwd();
  walk(root, root, visit);
}

function walk(
  path: string,
  root: string,
  visit: (relPath: string, content: string) => void
): void {
  if (path === SELF_PATH) return; // this file names the markers as data
  const stat = statOrNull(path);
  if (!stat) return; // e.g. an optional root entry that doesn't exist
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORE_DIR_NAMES.has(entry.name)) continue;
      walk(join(path, entry.name), root, visit);
    }
    return;
  }
  if (!SCAN_EXTENSIONS.has(extname(path))) return;
  visit(path.replace(`${root}/`, ''), readFileSync(path, 'utf8'));
}

function statOrNull(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}
