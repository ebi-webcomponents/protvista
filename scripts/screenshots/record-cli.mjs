/**
 * Records the fixture set. Usually reached via `yarn screenshots
 * --refresh-fixtures`; run directly to pin extra URLs a capture reported.
 *
 *   node scripts/screenshots/record-cli.mjs
 *   node scripts/screenshots/record-cli.mjs "https://example.org/thing.json"
 */
import { recordFixtures } from './record.mjs';

const extra = process.argv.slice(2).filter((a) => a.startsWith('http'));
await recordFixtures(extra.length ? extra : undefined);
