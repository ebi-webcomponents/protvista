/**
 * Add a `default` export to the repo's js-yaml (ESM entry).
 *
 * The pinned js-yaml (5.x) ships an ESM entry with **named exports only** (no
 * `default`). Several Astro/Starlight internals do `import yaml from 'js-yaml'`
 * and call `yaml.load` / `yaml.dump`, which fails at build/prerender with
 * "does not provide an export named 'default'". This postinstall step appends a
 * default export (the module's own namespace) to js-yaml's **ESM** entry so
 * those imports resolve.
 *
 * Note: it targets the `import`-condition entry (via `import.meta.resolve`),
 * NOT the CommonJS entry — appending ESM syntax to the `.cjs` file would be
 * invalid. It is idempotent and guarded, and re-applies on every install (yarn
 * re-extracts js-yaml before running postinstall). The library itself uses
 * named imports, so it is unaffected. Remove this once the pinned js-yaml ships
 * a `default` export, or when the docs move off Astro.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';

// `import.meta.resolve` returns a string synchronously on Node >=20.6 (what
// CI and this repo use). On older Node it may be absent/async, which would
// silently skip the patch and surface later as an opaque Astro build error —
// so warn loudly on anything other than a genuine "not installed".
let entry;
try {
  // The ESM ("import" condition) entry — the file Astro's `import` resolves to.
  entry = fileURLToPath(import.meta.resolve('js-yaml'));
} catch (err) {
  const notInstalled =
    err?.code === 'ERR_MODULE_NOT_FOUND' ||
    err?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED';
  if (!notInstalled) {
    console.warn(
      `[patch-js-yaml] could not resolve js-yaml (${err?.message}); skipping — ` +
        `the Astro docs build may fail. Requires Node >=20.6 for import.meta.resolve.`
    );
  }
  process.exit(0);
}

const MARKER = '/* protvista: js-yaml default-export shim */';
const src = readFileSync(entry, 'utf8');
if (src.includes(MARKER) || /(^|\n)\s*export\s+default\b/.test(src)) {
  process.exit(0);
}

// Re-export the module's own namespace as the default. A self-import is legal
// in ESM (circular, but the namespace is fully populated by the time a consumer
// reads `default.load`), and does not depend on `load`/`dump` being local
// bindings — the entry may re-export them from submodules.
const self = `./${basename(entry)}`;
writeFileSync(
  entry,
  `${src}\n${MARKER}\nimport * as __protvistaSelf from '${self}';\nexport default __protvistaSelf;\n`
);
console.log(`[patch-js-yaml] added a default export to ${entry}`);
