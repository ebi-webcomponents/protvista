#!/usr/bin/env node
/**
 * Measure raw + gzipped size of the library build (dist/).
 *
 * Writes bench/results/bundle-size.json:
 *   { commit, shortSha, capturedAt, files: [{ file, raw, gzip }], total }
 *
 * Run after `yarn build`. The `bench:bundle` script in package.json
 * does both in one go.
 */
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const distDir = join(root, 'dist');
const outDir = join(root, 'bench/results');

if (!existsSync(distDir)) {
  console.error(
    `error: ${relative(root, distDir)} does not exist. Run \`yarn build\` first.`
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

// Walk dist/ and collect anything a consumer would actually ship.
const SHIPPABLE = /\.(m?js|css)$/;
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (SHIPPABLE.test(entry.name)) return [full];
    return [];
  });
}

const files = walk(distDir).map((path) => {
  const buf = readFileSync(path);
  return {
    file: relative(distDir, path),
    raw: buf.length,
    gzip: gzipSync(buf).length,
  };
});

const total = files.reduce(
  (acc, f) => ({ raw: acc.raw + f.raw, gzip: acc.gzip + f.gzip }),
  { raw: 0, gzip: 0 }
);

// Tag the snapshot with the commit when available — but don't crash if
// git is unavailable (tarball install, shallow CI clone, etc.).
const git = (cmd) => {
  try {
    return execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
};
const result = {
  commit: git('git rev-parse HEAD'),
  shortSha: git('git rev-parse --short HEAD'),
  capturedAt: new Date().toISOString(),
  files,
  total,
};

writeFileSync(
  join(outDir, 'bundle-size.json'),
  JSON.stringify(result, null, 2)
);

const kb = (b) => (b / 1024).toFixed(1) + ' KB';
console.log(
  `bundle-size: ${kb(total.raw)} raw / ${kb(total.gzip)} gzip across ${files.length} files`
);
