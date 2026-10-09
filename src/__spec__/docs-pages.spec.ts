/**
 * Drift tests for the docs pages that describe authored data: links from a
 * field, the delimiter hint, opening a local file in the playground, proteins
 * outside UniProt, and per-residue conservation. Each pins what a page says
 * against the code or the example it describes, so a change to either
 * without the other fails here rather than going unnoticed until someone
 * reads the page.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runPipeline } from '../schema/adapters/pipeline.js';
import { parseConfigText } from '../schema/parse.js';
import { validateConfig } from '../schema/validate.js';
import { createRegistry } from '../schema/registry.js';
import { getPreset } from '../playground/presets.js';
import { PRIVACY_NOTE } from '../playground/local-files.js';
import type { ProtvistaViewerConfig } from '../schema/types.js';

// Vitest runs from the repo root, so resolve paths from cwd.
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');
const doc = (name: string) => read(`docs/src/content/docs/${name}.md`);

// Pull every fenced code block of a given language out of a Markdown doc, in
// document order (`''` for an untagged fence). Fences are paired in order, so
// a closing fence is never read as an untagged opening one.
function allFenced(md: string, lang: string): string[] {
  const blocks: string[] = [];
  let open: { lang: string; body: string[] } | undefined;
  for (const line of md.split('\n')) {
    const fence = line.match(/^```(\S*)\s*$/);
    if (open && fence && fence[1] === '') {
      if (open.lang === lang) blocks.push(open.body.join('\n') + '\n');
      open = undefined;
    } else if (open) open.body.push(line);
    else if (fence) open = { lang: fence[1], body: [] };
  }
  return blocks;
}

/** The slug Starlight gives a heading, as a `#fragment` names it. */
const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[`*]/g, '')
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/ /g, '-');

/**
 * The text of the section under the heading whose slug is `anchor`, up to the
 * next heading of the same or a higher level. Throws when there is none, so a
 * renamed heading (and so a broken link to it) fails loudly.
 */
function section(md: string, anchor: string): string {
  const lines = md.split('\n');
  const start = lines.findIndex(
    (line) => /^#{2,6} /.test(line) && slug(line.replace(/^#+ /, '')) === anchor
  );
  if (start < 0) throw new Error(`no heading #${anchor}`);
  const level = lines[start].match(/^#+/)![0].length;
  const end = lines.findIndex(
    (line, i) =>
      i > start && /^#+ /.test(line) && line.match(/^#+/)![0].length <= level
  );
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

/** What the pipeline throws for `body`, read as `format` from `source`. */
function thrown(format: 'csv' | 'tsv', body: string, source: string): string {
  try {
    runPipeline('feature', format, body, { source });
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected runPipeline to throw');
}

describe('data-tooltip.md and your-data.md on links from a field', () => {
  it('"Links from a field" describes {% link %}, its allowlist and //host as off-site', () => {
    const text = section(doc('data-tooltip'), 'links-from-a-field');
    expect(text).toContain('{% link href=$url %}');
    expect(text).toContain('{% link href=$url /%}');
    for (const scheme of [
      '`http:`',
      '`https:`',
      '`mailto:`',
      '`javascript:`',
    ]) {
      expect(text).toContain(scheme);
    }
    expect(text).toContain('`//example.org/x` links to another site');
  });

  it('the styled section says //host links to that host', () => {
    const text = section(
      doc('your-data'),
      'style-and-annotate-each-feature-from-your-file'
    );
    expect(text).toMatch(
      /`\/\/host\/…` value counts as `\/…` and links to that host/
    );
  });

  it('describes examples/csv-styled as it is', () => {
    const text = section(
      doc('your-data'),
      'style-and-annotate-each-feature-from-your-file'
    );
    // The page's own claims about the runnable example…
    expect(text).toContain('a lab-notebook `ref` column in place of\n`pmid`');
    expect(text).toContain('a "Read more" link');
    expect(text).toContain('one more `DOMAIN` row');
    // …hold for the example.
    const config = read('examples/csv-styled/config.yaml');
    const csv = read('examples/csv-styled/hits.csv');
    expect(config).toContain(
      'Notebook {% $ref %} · {% link href=$url %}Read more{% /link %}'
    );
    expect(csv.split('\n')[0]).toBe('type,start,end,description,color,ref,url');
    const domains = (rows: string) =>
      rows.split('\n').filter((row) => row.startsWith('DOMAIN,')).length;
    const [pageCsv] = allFenced(text, 'csv');
    expect(domains(csv)).toBe(domains(pageCsv) + 1);
    // The styled.csv fixture is the example's file.
    expect(read('src/__fixtures__/local-files/styled.csv')).toBe(csv);
  });
});

describe('troubleshooting.md on the delimiter hint', () => {
  const text = section(doc('troubleshooting'), 'a-data-file-is-malformed');

  it('shows the hint exactly as the decoder words it', () => {
    const [example] = allFenced(text, '');
    const tabCsv = 'type\tstart\tend\tdescription\nDOMAIN\t1\t9\tkinase\n';
    expect(example.trim()).toBe(thrown('csv', tabCsv, './hits.csv'));
  });

  it('lists `format:` first, before a rename', () => {
    expect(text.indexOf('`format:` always works')).toBeGreaterThan(-1);
    expect(text.indexOf('`format:` always works')).toBeLessThan(
      text.indexOf('a rename is\noffered')
    );
  });

  it("your-data.md's spreadsheet example starts as the decoder words it", () => {
    const [example] = allFenced(
      section(doc('your-data'), 'spreadsheet-exports'),
      ''
    );
    const shown = example.trim().replace(/ …$/, '');
    expect(
      thrown(
        'csv',
        'type;start;end;description\nDOMAIN;1;9;x\n',
        './hotspots.csv'
      )
    ).toMatch(new RegExp('^' + shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

describe('your-data.md#try-your-file-in-the-playground', () => {
  const text = section(doc('your-data'), 'try-your-file-in-the-playground');

  it('describes the button, the drop zone, the privacy wording and relabelling', () => {
    expect(text).toContain('**Load data file…**');
    expect(text).toContain('drop the\nfile onto the config editor');
    // The playground's own note, said the same way.
    expect(PRIVACY_NOTE).toMatch(/never uploaded/);
    expect(text).toContain('read in your browser and never uploaded');
    expect(text).toContain('Only its *name* goes into the config');
    // Problems are listed by the file's `./name`, not its `blob:` URL.
    expect(text).toContain(
      '`./hits.csv (parsed as CSV): row 3, column "start": …`'
    );
    expect(text).toContain('`data: ./hits.csv`');
  });
});

describe('sequence-only.md, "Proteins outside UniProt"', () => {
  const md = doc('sequence-only');
  const registry = () => createRegistry();

  it('is titled "Proteins outside UniProt"', () => {
    expect(md).toMatch(/^---\ntitle: Proteins outside UniProt\n/);
  });

  it('every yaml example is a valid config, given rows', async () => {
    const blocks = allFenced(md, 'yaml');
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    for (const block of blocks) {
      const parsed = (await parseConfigText(block)) as Record<string, unknown>;
      const config = { rows: [], ...parsed } as ProtvistaViewerConfig;
      expect(validateConfig(config, registry()).issues, block).toEqual([]);
    }
  });

  it('quotes the accession-and-sequence error as validateConfig words it', () => {
    const { issues } = validateConfig(
      {
        accession: 'P05067',
        sequence: 'MKT',
        rows: [],
      } as ProtvistaViewerConfig,
      registry()
    );
    expect(issues.map((i) => i.code)).toEqual(['accession-and-sequence']);
    expect(md).toContain(`\`${issues[0].message}\``);
  });

  it('quotes the needs-accession error as validateConfig words it', () => {
    const { issues } = validateConfig(
      {
        sequence: 'MKT',
        rows: [
          {
            id: 'hotspots',
            kind: 'features',
            data: 'https://www.ebi.ac.uk/proteins/api/features/{accession}',
          },
        ],
      } as ProtvistaViewerConfig,
      registry()
    );
    expect(issues.map((i) => i.code)).toEqual(['needs-accession']);
    expect(md).toContain(`\`${issues[0].message}\``);
  });

  it('describes the multi-record and file-path errors and the 80-character cut', () => {
    expect(md).toContain('contains 2 records; the viewer shows one protein. …');
    expect(md).toContain(
      '(`protein.txt`) is told to write it as `./protein.txt`'
    );
    expect(md).toContain('A header longer than 80\ncharacters is cut short');
  });

  it('describes the start-from-blank summary for an extends: config', () => {
    expect(section(md, 'start-from-a-blank-config')).toContain(
      'followed by a summary\nsaying to start from a blank config instead'
    );
  });
});

describe('the conservation and sequence-only docs link their presets', () => {
  it('your-data.md#per-residue-conservation explains the method, the source and the family', () => {
    const text = section(doc('your-data'), 'per-residue-conservation');
    expect(text).toContain('Pfam PF00301');
    expect(text).toContain('PROVENANCE.md');
    expect(text).toContain('Jensen–Shannon divergence');
    expect(text).toContain('**They are within one family.**');
    expect(text).toContain('across the Pfam\n  domain family');
    expect(text).toContain('(/protvista/playground/#preset=conservation)');
    expect(getPreset('conservation')).toBeDefined();
  });

  it('sequence-only.md mentions the inline-FASTA preset and loading a .fasta file', () => {
    const md = doc('sequence-only');
    expect(md).toContain('(/protvista/playground/#preset=own-sequence)');
    expect(getPreset('own-sequence')).toBeDefined();
    expect(md).toContain('load a `.fasta` file');
    expect(section(md, 'try-your-fasta-in-the-playground')).toContain(
      '**Load data file…**'
    );
  });
});
