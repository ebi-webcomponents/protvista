/**
 * Drift tests for the funding acknowledgement.
 *
 * The grant's Outputs Management Plan (section 7) requires every output to
 * carry the acknowledgement below word for word: the repository README, the
 * documentation site, release notes, Zenodo records and webinar materials.
 * These tests pin each copy to that text, check that the docs site and the
 * release flow still put it where it has to go (by running release-next.sh's
 * notes check, and by reading the built site when there is one), and fail on
 * any file that quotes part of it but not all of it, so a reworded copy is
 * caught wherever it lands.
 *
 * Line breaks and repeated spaces are ignored: Markdown and Astro sources may
 * wrap the sentence, and it renders as one line either way. Nothing else may
 * differ.
 */

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  delimiter,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

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

  it('the template puts it under a Funding heading', () => {
    const template = read('scripts/release-notes-template.md');
    const funding = template.split(/^## Funding$/m)[1] ?? '';
    expect(carries(funding)).toBe(true);
  });
});

// Runs the real release-next.sh in a scratch copy of the repo with git, npm
// and gh stubbed on PATH, so these check what the script does with the notes,
// not how its source reads. The stubs report a clean `next` level with origin,
// nothing published, logged in. `npm version` is the first thing the prepare
// step runs, so its stub stops the script there with exit 97: reaching it
// means preflight passed. Resuming (HEAD is already the release commit) skips
// prepare and stops at the publish prompt, which stdin answers "n".
// Not on Windows: releases are cut on macOS or Linux, and on Windows CI the
// spawned bash finds the real git ahead of the stub, so the script fails
// before the notes check.
describe.skipIf(process.platform === 'win32')(
  'funding acknowledgement — release-next.sh preflight',
  () => {
    const NOTES = 'RELEASE_NOTES.md';
    const TEMPLATE = 'scripts/release-notes-template.md';
    const VERSION = '5.0.0-beta.5';
    const REACHED_PREPARE = 'STUB npm version: preflight passed';

    const STUBS: Record<string, string> = {
      git: `case "$1" in
  rev-parse) [ "$2" = --abbrev-ref ] && echo next || exit 1 ;;
  status|fetch) ;;
  rev-list) echo 0 ;;
  log) echo "$STUB_HEAD_SUBJECT" ;;
  *) echo "unexpected stub call: git $*" >&2; exit 98 ;;
esac`,
      npm: `case "$1" in
  view) ;;
  whoami) echo tester ;;
  version) echo '${REACHED_PREPARE}' >&2; exit 97 ;;
  *) echo "unexpected stub call: npm $*" >&2; exit 98 ;;
esac`,
      gh: `case "$1" in
  auth) ;;
  *) echo "unexpected stub call: gh $*" >&2; exit 98 ;;
esac`,
    };

    // The HEAD commit subject the git stub reports in each mode.
    const MODES = {
      fresh: 'Merge pull request #1',
      resuming: `Release ${VERSION}`,
    } as const;

    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'release-next-'));
      mkdirSync(join(dir, 'scripts'));
      mkdirSync(join(dir, 'bin'));
      copyFileSync(
        resolve(root, 'scripts/release-next.sh'),
        join(dir, 'scripts/release-next.sh')
      );
      copyFileSync(resolve(root, TEMPLATE), join(dir, TEMPLATE));
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ version: VERSION })
      );
      writeFileSync(
        join(dir, 'CHANGELOG.md'),
        '# Changelog\n\n## Unreleased\n'
      );
      for (const [name, body] of Object.entries(STUBS)) {
        writeFileSync(
          join(dir, 'bin', name),
          `#!/usr/bin/env bash\n${body}\n`,
          {
            mode: 0o755,
          }
        );
      }
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const release = (mode: keyof typeof MODES, notes?: string) => {
      if (notes !== undefined) writeFileSync(join(dir, NOTES), notes);
      const result = spawnSync('bash', ['scripts/release-next.sh'], {
        cwd: dir,
        encoding: 'utf8',
        input: 'n\n',
        env: {
          ...process.env,
          // The script reads package.json with node, so keep it reachable.
          PATH: [join(dir, 'bin'), dirname(process.execPath), process.env.PATH]
            .filter(Boolean)
            .join(delimiter),
          STUB_HEAD_SUBJECT: MODES[mode],
        },
      });
      const output = `${result.stdout}${result.stderr}`;
      return {
        status: result.status,
        output,
        // Got past the notes check: into prepare, or (resuming) to the prompt.
        passed:
          output.includes(REACHED_PREPARE) || output.includes('==> Publish'),
      };
    };

    const WRITTEN = "## What's changed\n\n- Fixes a bug.\n";
    // Wrapped as an editor would wrap it: the check folds whitespace.
    const WRAPPED = ACKNOWLEDGEMENT.replace(
      ' managed by ',
      '\nmanaged by '
    ).replace(' grant reference ', '\n  grant reference ');

    for (const mode of Object.keys(MODES) as (keyof typeof MODES)[]) {
      describe(mode, () => {
        it('passes notes that carry it, wrapped over lines', () => {
          const run = release(mode, `${WRITTEN}\n## Funding\n\n${WRAPPED}\n`);
          expect(run.passed, run.output).toBe(true);
          expect(run.status).toBe(mode === 'fresh' ? 97 : 1);
        });

        it('refuses notes without it', () => {
          const run = release(mode, WRITTEN);
          expect(run.status, run.output).toBe(1);
          expect(run.output).toContain(
            `${NOTES} must carry the funding acknowledgement word for word`
          );
          expect(run.passed).toBe(false);
        });

        it('refuses notes with a reworded copy', () => {
          const reworded = ACKNOWLEDGEMENT.replace('grant reference', 'grant');
          const run = release(mode, `${WRITTEN}\n## Funding\n\n${reworded}\n`);
          expect(run.status, run.output).toBe(1);
          expect(run.output).toContain(
            'must carry the funding acknowledgement'
          );
          expect(run.passed).toBe(false);
        });

        // The template carries the acknowledgement, so only this check stops
        // a release going out with the template's empty notes.
        it('refuses the unedited template', () => {
          const run = release(mode, read(TEMPLATE));
          expect(run.status, run.output).toBe(1);
          expect(run.output).toContain(
            `${NOTES} is still the unedited template`
          );
          expect(run.passed).toBe(false);
        });

        it('refuses empty notes', () => {
          const run = release(mode, '');
          expect(run.status, run.output).toBe(1);
          expect(run.output).toContain(`${NOTES} is empty`);
          expect(run.passed).toBe(false);
        });

        it('starts missing notes from the template, then stops', () => {
          const run = release(mode);
          expect(run.status, run.output).toBe(1);
          expect(run.output).toContain(`${NOTES} was missing`);
          expect(run.passed).toBe(false);
          expect(readFileSync(join(dir, NOTES), 'utf8')).toBe(read(TEMPLATE));
        });
      });
    }
  }
);

// The built docs site, checked when there is one: CI runs this file again
// after `pnpm site:build`, as it does package-contract.spec.ts after building
// dist/. The source checks above cannot see a footer that stops rendering
// (commented out, behind a false condition, or dropped by a Starlight
// upgrade); the built pages can. If this fails locally on an old site/,
// rebuild it with `pnpm site:build`.
const SITE = resolve(root, 'site');
// Built into site/ but not Starlight pages, so they have no Starlight footer.
const NOT_STARLIGHT = ['bench.html', 'playground/index.html'];

describe.skipIf(!existsSync(join(SITE, 'index.html')))(
  'funding acknowledgement — built documentation site',
  () => {
    // A function, not a value: describe bodies run even when skipped, and
    // site/ does not exist then.
    const builtPages = () =>
      readdirSync(SITE, { recursive: true, encoding: 'utf8' })
        .map((entry) => entry.split(sep).join('/'))
        .filter((entry) => entry.endsWith('.html'))
        .sort();
    // Without comments: a commented-out footer does not show.
    const html = (page: string) =>
      readFileSync(join(SITE, page), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const isStarlight = (page: string) =>
      /<meta name="generator" content="Starlight\b/.test(html(page));

    it('every Starlight page shows it in the footer, word for word', () => {
      const pages = builtPages();
      // Non-vacuous: the splash home, content pages, a blog post and the 404.
      expect(pages).toEqual(
        expect.arrayContaining([
          'index.html',
          '404.html',
          'tutorial/index.html',
          'webinar/index.html',
          'blog/protvista-5/index.html',
        ])
      );
      const missing = pages
        .filter((page) => !NOT_STARLIGHT.includes(page))
        .filter((page) => {
          // Only the footer's own paragraph counts: the webinar page and the
          // v5 announcement carry a copy in their body as well.
          const footer = html(page).match(
            /<p class="pv-funding\b[^"]*"[^>]*>([\s\S]*?)<\/p>/
          )?.[1];
          return (
            footer === undefined || fold(footer).trim() !== ACKNOWLEDGEMENT
          );
        });
      expect(missing).toEqual([]);
    });

    it('leaves out only pages that are not Starlight pages', () => {
      const pages = builtPages();
      expect(isStarlight('index.html')).toBe(true);
      for (const page of NOT_STARLIGHT) {
        expect(pages, `${page} was not built`).toContain(page);
        expect(isStarlight(page), `${page} is a Starlight page now`).toBe(
          false
        );
      }
    });
  }
);

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
