/**
 * Publish-URL invariants for the JSON Schema (issue #209).
 *
 * These tests exist so the schema's hosted identity can't silently
 * regress: the `$id` must point at the canonical GitHub Pages URL, the
 * frozen `public/schema/v1/` copy must never drift from the authored
 * source, `default-config.yaml` must reference the same canonical URL,
 * and the retired `.invalid` placeholder must never reappear anywhere
 * in the repo (e.g. via a bad cherry-pick from `main` — see
 * docs/sync-from-main.md, which already forbids `main`'s
 * `src/schema/*` from landing on `next`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { parseConfigText } from '../parse';

const CANONICAL_SCHEMA_URL =
  'https://ebi-webcomponents.github.io/protvista-uniprot/schema/v1/config.schema.json';

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
    expect(publicCopy).toBe(source);
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

// ─────────────────────────────────────────────────────────────
// Repo-wide placeholder scan. Deliberately excludes this file's own
// directory (`__spec__`) since this file's source mentions the
// placeholder-shaped strings above only as historical documentation,
// and standard build/dependency output dirs already covered by
// `.gitignore`.
// ─────────────────────────────────────────────────────────────

const SCAN_ROOTS = ['src', 'public', 'docs', 'specs', 'README.md'];
const SCAN_EXTENSIONS = new Set(['.ts', '.json', '.yaml', '.yml', '.md']);
const IGNORE_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'demo',
  'coverage',
  '__spec__',
  '__snapshots__',
]);
const PLACEHOLDER_MARKERS = [
  'TODO-PUBLISH-BEFORE-V5-RELEASE',
  'ebi.ac.uk/protvista/config.schema.json',
];

function findPlaceholderReferences(): string[] {
  const root = process.cwd();
  const offenders: string[] = [];
  for (const entry of SCAN_ROOTS) {
    scanPath(join(root, entry), root, offenders);
  }
  return offenders;
}

function scanPath(path: string, root: string, offenders: string[]): void {
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
  if (PLACEHOLDER_MARKERS.some((marker) => content.includes(marker))) {
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
