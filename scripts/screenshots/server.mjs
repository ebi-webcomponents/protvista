/**
 * Serves the built site for capture.
 *
 * Captures run against `astro preview` (the built `site/`), never `astro dev`:
 * the dev server serves unbundled modules with different timing, so a dev-mode
 * screenshot would not be a picture of what users get.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';

/**
 * The astro CLI as `[node, entry]`, resolved from the package's own `bin`
 * field rather than from `node_modules/.bin` or from `pnpm` on PATH. pnpm's
 * `.bin` entries are /bin/sh wrappers `node` cannot execute, and a bare `pnpm`
 * spawn needs `pnpm.cmd` on Windows and fails wherever pnpm is not on PATH
 * (e.g. `node scripts/screenshots/capture.mjs` without corepack). Running the
 * entry under the current node works anywhere node does.
 */
export function astroCommand() {
  const pkgPath = createRequire(import.meta.url).resolve('astro/package.json');
  const { bin } = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const entry = typeof bin === 'string' ? bin : bin.astro;
  return [process.execPath, resolve(dirname(pkgPath), entry)];
}

/** An OS-assigned free port, so concurrent runs cannot collide. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(url, { tries = 120, everyMs = 500 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`preview server never answered at ${url}`);
}

export async function startServer() {
  if (!existsSync('site/index.html')) {
    throw new Error(
      'site/ is not built — run `pnpm site:build` first (capture.mjs does this ' +
        'for you unless --no-build).'
    );
  }
  const port = await freePort();
  const [node, astro] = astroCommand();
  const child = spawn(
    node,
    [astro, 'preview', '--root', 'docs', '--port', String(port)],
    { stdio: 'ignore' }
  );

  const baseURL = `http://localhost:${port}`;
  const stop = () => {
    if (!child.killed) child.kill();
  };
  // Do not leave a server behind if the run throws or is interrupted.
  process.once('exit', stop);
  process.once('SIGINT', () => {
    stop();
    process.exit(130);
  });

  try {
    await waitFor(`${baseURL}/protvista/`);
  } catch (e) {
    stop();
    throw e;
  }
  return { baseURL, stop };
}
