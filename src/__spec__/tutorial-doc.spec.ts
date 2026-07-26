/**
 * Drift test for the paired examples embedded in
 * `docs/src/content/docs/tutorial.md`. The end-to-end tutorial hand-copies its
 * config and CSV snippets from the CI-validated `examples/` directory into
 * fenced `yaml`/`csv` blocks. Nothing else pins those embedded copies to the
 * real files, so `examples/csv/*` or `examples/extend-default/*` could change
 * and the tutorial would silently drift. This closes that gap, exactly as
 * `configuration-vs-data-doc.spec.ts` does for that page.
 *
 * The tutorial embeds two example pairs, so it has multiple `yaml`/`csv`
 * blocks. `allFenced` returns them in document order:
 *   - yaml[0] / csv[0] — Step 2, the standalone CSV track (examples/csv).
 *   - yaml[1] / csv[1] — Step 3, the `extends` layer (examples/extend-default).
 * Step 4's illustrative `theme:` block is yaml[2] and is not pinned (it is not
 * copied from an example file).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vitest runs from the repo root, so resolve paths from cwd.
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

// Pull every fenced code block of a given language out of a Markdown doc, in
// document order.
const allFenced = (md: string, lang: string): string[] => {
  const re = new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g');
  const blocks = [...md.matchAll(re)].map((m) => m[1]);
  if (blocks.length === 0) throw new Error(`no ${lang} block found`);
  return blocks;
};

describe('docs/src/content/docs/tutorial.md embedded examples stay in sync', () => {
  const doc = read('docs/src/content/docs/tutorial.md');
  const yaml = allFenced(doc, 'yaml');
  const csv = allFenced(doc, 'csv');

  it('the Step 2 csv block matches examples/csv/hotspots.csv verbatim', () => {
    expect(csv[0].trim()).toBe(read('examples/csv/hotspots.csv').trim());
  });

  it('the Step 2 yaml block matches examples/csv/config.yaml', () => {
    // The doc omits the file's leading `#` comment header, so the embedded
    // block is a contiguous slice of the file — assert containment.
    expect(read('examples/csv/config.yaml')).toContain(yaml[0].trim());
  });

  it('the Step 3 csv block matches examples/extend-default/hotspots.csv verbatim', () => {
    expect(csv[1].trim()).toBe(read('examples/extend-default/hotspots.csv').trim());
  });

  it('the Step 3 yaml block matches examples/extend-default/config.yaml', () => {
    // Same as above: the doc slices off the leading comment header.
    expect(read('examples/extend-default/config.yaml')).toContain(yaml[1].trim());
  });
});
