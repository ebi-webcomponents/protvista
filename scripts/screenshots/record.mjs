/** Recording entry point, shared by the CLI and `capture.mjs --refresh-fixtures`. */
import { recordAll, loadIndex, FIXTURE_DIR } from './fixtures.mjs';
import { SEED_URLS } from './seeds.mjs';

export async function recordFixtures(urls = SEED_URLS) {
  console.log(`recording ${urls.length} url(s) into ${FIXTURE_DIR}\n`);
  const results = await recordAll(urls);

  let total = 0;
  let changed = 0;
  for (const r of results.sort((a, b) => b.bytes - a.bytes)) {
    total += r.bytes;
    if (r.changed) changed++;
    console.log(
      `  ${r.changed ? '*' : ' '} ${String(r.bytes).padStart(9)}  ${r.url}` +
        `${r.status >= 400 ? ` [${r.status}]` : ''}`
    );
  }
  console.log(`\n  ${changed} payload(s) changed (marked *)`);
  console.log(
    `\n  ${results.length} files, ${(total / 1024 / 1024).toFixed(2)} MB total`
  );
  console.log(`  index: ${Object.keys(loadIndex()).length} entries`);
  return results;
}
