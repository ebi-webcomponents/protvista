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
import { parseConfigText } from '../parse';

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
  // https://cdn.jsdelivr.net/npm/protvista-uniprot@<version>/src/default-config.yaml
  //
  // jsDelivr serves that path straight out of the npm tarball, so it
  // exists only while `src` stays in package.json `files`. Trimming
  // that to `["dist"]` is an obvious-looking size win — the tarball
  // carries all of src/**/*.ts as dead weight — and it would silently
  // 404 every Starter Kit copy in the wild, with nothing else in this
  // repo failing. Hence this test.
  const pkg = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')
  ) as { files?: string[] };

  it('publishes `src`, which the Starter Kit `extends:` URL resolves into', () => {
    expect(pkg.files).toContain('src');
  });

  it('still ships the config that URL points at', () => {
    expect(
      statOrNull(resolve(process.cwd(), 'src/default-config.yaml'))
    ).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Repo-wide placeholder scan. Walks the whole repository tree from the
// root (so root-level files like `index.html` and `package.json` are
// covered, not just a hand-picked set of directories), skipping VCS /
// dependency / build-output dirs. Test fixtures and snapshots are NOT
// excluded — a placeholder hiding in a config fixture is exactly the
// kind of regression this guards against. Only this spec file is
// skipped, since it necessarily names the placeholder-shaped strings
// below as the very markers it scans for.
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
  const root = process.cwd();
  const offenders: string[] = [];
  scanPath(root, root, offenders);
  return offenders;
}

function scanPath(path: string, root: string, offenders: string[]): void {
  if (path === SELF_PATH) return; // this file names the markers as data
  const stat = statOrNull(path);
  if (!stat) return; // e.g. an optional root entry that doesn't exist
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORE_DIR_NAMES.has(entry.name)) continue;
      scanPath(join(path, entry.name), root, offenders);
    }
    return;
  }
  if (!SCAN_EXTENSIONS.has(extname(path))) return;
  const content = readFileSync(path, 'utf8');
  const hit = PLACEHOLDER_MARKERS.some((marker) =>
    typeof marker === 'string' ? content.includes(marker) : marker.test(content)
  );
  if (hit) {
    offenders.push(path.replace(`${root}/`, ''));
  }
}

function statOrNull(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}
