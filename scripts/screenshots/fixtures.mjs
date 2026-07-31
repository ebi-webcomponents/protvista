/**
 * Pinned network fixtures.
 *
 * Every off-site request a capture makes is served from disk, so a screenshot
 * depends on nothing but this repository. That is what makes the images
 * reproducible: UniProt is curated continuously, so a live capture would drift
 * silently, and CI would additionally depend on EBI being up and fast.
 *
 * Recording is done with **Node's `fetch`, not the browser**. Chromium in some
 * sandboxed/proxied environments cannot complete HTTP/2 to www.ebi.ac.uk
 * (`ERR_HTTP2_PROTOCOL_ERROR`) while Node succeeds against the same URL, so
 * driving the recording from the browser would make refreshes impossible
 * exactly where they are most needed. Node also keeps recording independent of
 * whichever browser build is installed.
 *
 * Bodies are stored **verbatim**, never re-serialised: re-encoding JSON would
 * churn key order and float formatting and make every refresh a large,
 * unreadable diff.
 *
 * `index.json` is the reviewable surface. A refresh shows up there as
 * `bytes: 1564072 -> 1571004, sha256 changed`, which is legible in a PR next to
 * the image that changed with it.
 */
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

export const FIXTURE_DIR = 'scripts/screenshots/fixtures';
const INDEX = join(FIXTURE_DIR, 'index.json');
const NET = join(FIXTURE_DIR, 'net');

/**
 * A Chrome-ish UA for recording. Google Fonts serves a *different* stylesheet
 * per user agent (woff2 vs ttf, and which unicode-range subsets exist), so
 * recording the CSS with Node's default UA would pin font files the browser
 * then never asks for — and leave the ones it does ask for unpinned.
 */
const RECORD_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/149.0.0.0 Safari/537.36';

/** URL -> a path under `net/` that mirrors it, so provenance is readable. */
export function fixturePath(url) {
  const u = new URL(url);
  let p = u.pathname.replace(/\/$/, '');
  if (u.search) {
    // Keep the query, flattened, so two URLs differing only by query cannot
    // collide on disk.
    p += '__' + u.search.slice(1).replace(/[^a-zA-Z0-9.+@;=-]/g, '_');
  }
  return join(NET, u.host, p);
}

export function loadIndex() {
  return existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : {};
}

function saveIndex(index) {
  const sorted = Object.fromEntries(
    Object.entries(index).sort(([a], [b]) => a.localeCompare(b))
  );
  writeFileSync(INDEX, JSON.stringify(sorted, null, 2) + '\n');
}

/** Body for a recorded URL, as a Buffer. */
export function loadBody(entry) {
  return readFileSync(join(FIXTURE_DIR, entry.file));
}

/**
 * Fetch and store one URL verbatim. A non-2xx is recorded as-is rather than
 * treated as a failure: `proteins/api/rna-editing/P05067` genuinely 404s, and
 * replaying that 404 is what reproduces the real viewer.
 */
export async function record(url, index, { now }) {
  const res = await fetch(url, { headers: { 'user-agent': RECORD_UA } });
  const body = Buffer.from(await res.arrayBuffer());
  const file = fixturePath(url);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);

  const sha256 = createHash('sha256').update(body).digest('hex');
  // Keep the original timestamp when the payload has not changed. Otherwise a
  // refresh that fetched identical bytes still rewrites every `recordedAt` and
  // buries the two entries that genuinely moved under two dozen that did not —
  // exactly the noise this index exists to avoid. `recordedAt` therefore means
  // "when this content was first seen", which is also what a caption citing a
  // retrieval date wants.
  index[url] = {
    file: file.slice(FIXTURE_DIR.length + 1),
    status: res.status,
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    bytes: body.length,
    sha256,
    recordedAt: index[url]?.sha256 === sha256 ? index[url].recordedAt : now,
  };
  return { status: res.status, bytes: body.length, changed: index[url].recordedAt === now };
}

/**
 * Google Fonts serves CSS that references font binaries; those binaries are
 * separate requests the browser makes only after parsing the CSS. Recording the
 * CSS alone would leave them unpinned, so follow them here.
 */
export function fontUrlsFrom(cssBuffer) {
  return [
    ...new Set(
      [...cssBuffer.toString('utf8').matchAll(/url\((https:\/\/[^)]+)\)/g)].map(
        (m) => m[1]
      )
    ),
  ];
}

/** Record a list of URLs, following Google Fonts CSS to its font files. */
export async function recordAll(urls, { now = new Date().toISOString() } = {}) {
  mkdirSync(NET, { recursive: true });
  const index = loadIndex();
  const queue = [...new Set(urls)];
  const done = new Set();
  const results = [];

  while (queue.length) {
    const url = queue.shift();
    if (done.has(url)) continue;
    done.add(url);
    const r = await record(url, index, { now });
    results.push({ url, ...r });
    if (/fonts\.googleapis\.com/.test(url)) {
      queue.push(...fontUrlsFrom(loadBody(index[url])));
    }
  }

  saveIndex(index);
  return results;
}

/** Drop index entries whose file is gone, and vice versa. */
export function prune() {
  const index = loadIndex();
  for (const [url, e] of Object.entries(index)) {
    if (!existsSync(join(FIXTURE_DIR, e.file))) delete index[url];
  }
  saveIndex(index);
}

export function clear() {
  rmSync(NET, { recursive: true, force: true });
  rmSync(INDEX, { force: true });
}
