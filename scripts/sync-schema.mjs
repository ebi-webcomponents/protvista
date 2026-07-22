// Regenerate the served copy of the config JSON Schema from its authored
// source. Run after editing src/schema/schema.json while v5 is still in
// development and the v1 schema can still change. The schema-publishing
// spec asserts the two are byte-identical; this keeps them in sync
// without a manual copy.
//
// NOT wired into the build: once the v5.0.0 release freezes v1, the
// served copy must stay put even if the source schema evolves for v2, so
// the regeneration is deliberately a manual, explicit step.
import { copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(repoRoot, 'src/schema/schema.json');
const dest = resolve(repoRoot, 'public/schema/v1/config.schema.json');

copyFileSync(source, dest);
console.log(`schema:sync — copied ${source} -> ${dest}`);
