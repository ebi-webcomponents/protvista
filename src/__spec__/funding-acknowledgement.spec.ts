/**
 * Drift tests for the funding acknowledgement.
 *
 * The grant's Outputs Management Plan (section 7) requires every output to
 * carry the acknowledgement below word for word: the repository README, the
 * documentation site, release notes, Zenodo records and webinar materials.
 * These tests pin each copy to that text, check that the docs site and the
 * release flow still put it where it has to go, and fail on any file that
 * quotes part of it but not all of it, so a reworded copy is caught wherever
 * it lands.
 *
 * Line breaks and repeated spaces are ignored: Markdown and Astro sources may
 * wrap the sentence, and it renders as one line either way. Nothing else may
 * differ.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

// Verbatim from the Outputs Management Plan. Change it only if the funder
// changes the required wording, and then everywhere at once.
const ACKNOWLEDGEMENT =
  'This work was supported by the Research Software Maintenance Fund, managed by the Software Sustainability Institute and funded by UKRI grant reference AH/Z000114/1.';

// Vitest runs from the repo root, so resolve paths from cwd.
const root = process.cwd();
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

/** Folds every run of whitespace to one space, as a browser renders it. */
const fold = (text: string) => text.replace(/\s+/g, ' ');

const carries = (text: string) => fold(text).includes(ACKNOWLEDGEMENT);

// Every place the plan names, as the file that puts the text there.
const REQUIRED: Record<string, string> = {
  'README.md': 'repository README, also the npm package page',
  'starter-kit/README.md': 'Starter Kit, mirrored to its template repository',
  'docs/src/components/Footer.astro': 'documentation site, every page',
  'docs/src/content/docs/webinar.md': 'webinar page',
  'docs/src/content/docs/blog/protvista-5.md': 'v5 announcement',
  'scripts/release-notes-template.md': 'release notes template',
  'scripts/release-next.sh': 'release notes check',
  'RELEASING.md': 'release instructions',
};

describe('funding acknowledgement — every required place carries it', () => {
  for (const [file, what] of Object.entries(REQUIRED)) {
    it(`${file} (${what})`, () => {
      expect(carries(read(file)), `${file} drifted from the plan's text`).toBe(
        true
      );
    });
  }
});

describe('funding acknowledgement — documentation site', () => {
  it('shows it on every Starlight page, through the Footer override', () => {
    const config = read('docs/astro.config.mjs');
    expect(config).toMatch(
      /components: \{[^}]*\bFooter: '\.\/src\/components\/Footer\.astro',?[^}]*\}/
    );
  });

  it('keeps Starlight’s own footer inside the override', () => {
    const footer = read('docs/src/components/Footer.astro');
    expect(footer).toContain(
      "import Default from '@astrojs/starlight/components/Footer.astro';"
    );
    expect(footer).toMatch(/^<Default \/>$/m);
  });
});

describe('funding acknowledgement — release notes', () => {
  const script = read('scripts/release-next.sh');

  it('release-next.sh holds the exact text it checks for', () => {
    const value = script.match(/^FUNDING_ACK='([^']*)'$/m)?.[1];
    expect(value).toBe(ACKNOWLEDGEMENT);
  });

  it('release-next.sh refuses release notes without it', () => {
    expect(script).toMatch(
      /^NOTES_TEMPLATE=scripts\/release-notes-template\.md$/m
    );
    expect(script).toContain(
      `grep -qF "$FUNDING_ACK" <<< "$(tr -s '[:space:]' ' ' < "$NOTES")"`
    );
    expect(script).toContain('cp "$NOTES_TEMPLATE" "$NOTES"');
  });

  it('the template puts it under a Funding heading', () => {
    const template = read('scripts/release-notes-template.md');
    const funding = template.split(/^## Funding$/m)[1] ?? '';
    expect(carries(funding)).toBe(true);
  });
});

describe('funding acknowledgement — Zenodo', () => {
  // No Zenodo deposit exists yet. Zenodo takes a release's metadata from
  // `.zenodo.json` when there is one, ignoring CITATION.cff, and CITATION.cff
  // has no funding field. Once `.zenodo.json` exists, its notes must carry it.
  it.skipIf(!existsSync(resolve(root, '.zenodo.json')))(
    '.zenodo.json notes carry it',
    () => {
      const zenodo = JSON.parse(read('.zenodo.json')) as { notes?: string };
      expect(carries(zenodo.notes ?? '')).toBe(true);
    }
  );
});

describe('funding acknowledgement — no partial or reworded copies', () => {
  // Phrases that only appear in the acknowledgement. A file quoting any of
  // them is meant to carry it, so it must carry all of it.
  const FRAGMENTS = [
    /supported by the Research Software Maintenance Fund/i,
    /managed by the Software Sustainability Institute/i,
    /funded by UKRI/i,
  ];

  it('every file that quotes part of it quotes all of it', () => {
    const quoting: string[] = [];
    const drifted: string[] = [];
    eachRepoFile((file, content) => {
      const text = fold(content);
      if (!FRAGMENTS.some((re) => re.test(text))) return;
      quoting.push(file);
      if (!text.includes(ACKNOWLEDGEMENT)) drifted.push(file);
    });

    // Non-vacuous: the scan must reach the required files.
    expect(quoting).toEqual(expect.arrayContaining(Object.keys(REQUIRED)));
    expect(drifted).toEqual([]);
  });
});

const SCAN_EXTENSIONS = new Set([
  '.ts',
  '.mjs',
  '.js',
  '.json',
  '.yaml',
  '.yml',
  '.md',
  '.mdx',
  '.html',
  '.astro',
  '.sh',
  '.cff',
  '.txt',
]);
// Dependencies, build output and caches; `.claude` holds agent worktrees,
// which are full copies of the repo. Same list as schema-publishing.spec.ts.
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
  '.astro',
  '.cache',
  '.claude',
]);

/** Hands every scannable file to `visit` as a `/`-separated repo path. */
function eachRepoFile(visit: (file: string, content: string) => void): void {
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIR_NAMES.has(entry.name)) walk(path);
      } else if (entry.isFile() && SCAN_EXTENSIONS.has(extname(entry.name))) {
        visit(
          relative(root, path).split(sep).join('/'),
          readFileSync(path, 'utf8')
        );
      }
    }
  };
  walk(root);
}
