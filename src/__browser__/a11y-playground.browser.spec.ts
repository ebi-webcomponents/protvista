/**
 * Automated browser check (Chromium) of the configuration playground for
 * the WCAG audit (`docs/accessibility-audit.md`, issue #382), on the page as
 * it ships: the markup and stylesheet of `docs/src/pages/playground.astro`
 * (`playground-astro-page.ts`) driven by the real page controller. It
 * checks landmarks and headings, reading order in Chromium's accessibility
 * tree, keyboard order and traps (including the code editor), focus
 * visibility and obscuring, what focusing or changing a control does,
 * single-character keys, pointer cancellation, target sizes and validation
 * messages.
 *
 * Nightingale stays stubbed here (`setup.ts`), so the preview shows the
 * viewer's own controls with empty tracks; the viewer is checked with real
 * Nightingale in `a11y-viewer-keyboard.browser.spec.ts`.
 *
 * The tests run in order against one live page. Where the page fails a
 * criterion today, the test pins the current behaviour and names the
 * audit's issue letter, so CI stays green and a fix shows up as a test to
 * update.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import axe from 'axe-core';

import {
  byId,
  closePlayground,
  choose,
  editorText,
  listItems,
  openPlayground,
  preview,
  setEditorText,
} from './playground-page.js';
import { PAGE_MARKUP, installPageStyles } from './playground-astro-page.js';
import {
  PRINTABLE_KEYS,
  accessibilityTreeWith,
  deepActive,
  describeEl,
  focusIndicator,
  outline,
  partlyVisible,
  snapshotLooks,
  stateDiff,
  stateOf,
  tabWalk,
  targetSizes,
} from './a11y-checks.js';

/** A small valid config: its own sequence, one group of two inline tracks. */
const CONFIG = `sequence: MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRV
rows:
  - id: lab
    label: Lab hits
    tracks:
      - id: a
        label: Domains
        kind: features
        data:
          from: inline
          format: csv
          inlineData: "type,start,end,description\\nDOMAIN,5,20,first domain"
      - id: b
        label: Regions
        kind: features
        data:
          from: inline
          format: csv
          inlineData: "type,start,end,description\\nREGION,25,34,a region"
`;

let uninstall: () => void;
const opened: string[] = [];

beforeAll(async () => {
  await page.viewport(1280, 720);
  uninstall = installPageStyles();
  vi.spyOn(window, 'open').mockImplementation((url) => {
    opened.push(String(url));
    return null;
  });
  await openPlayground({
    markup: PAGE_MARKUP,
    state: { config: CONFIG, accession: 'P05067' },
    // An accession UniProt does not have.
    respond: (url) =>
      url.includes('NOPE00') ? new Response('Not Found', { status: 404 }) : undefined,
  });
  await vi.waitFor(
    () => {
      if (!preview()?.querySelector('[data-group-toggle="lab"]')) {
        throw new Error('no preview yet');
      }
    },
    { timeout: 10000 }
  );
});

afterAll(() => {
  closePlayground();
  uninstall();
});

/** Sentinels outside the page, so a walk has somewhere to start and end. */
function withSentinels() {
  const start = Object.assign(document.createElement('button'), { textContent: 'START' });
  const end = Object.assign(document.createElement('button'), { textContent: 'END' });
  document.body.prepend(start);
  document.body.append(end);
  return { start, end, remove: () => (start.remove(), end.remove()) };
}

/** What the page shows, minus the editor's own DOM (its cursor layer redraws on focus). */
const pageRoots = () =>
  ['header.bar', '#preset-desc', '.local-files', '.errors', '#preview-stale', '#preview']
    .map((s) => document.querySelector(s)!)
    .filter(Boolean);
const pageState = () =>
  [stateOf(pageRoots()), editorText(), byId('splitter').getAttribute('aria-valuenow')].join('\n');

const EXPECTED_STOPS = [
  /^a "← Docs"$/,
  /^a "v0\.0\.0-test"$/,
  /^select#preset "Configuration preset"$/,
  // The accession is disabled while the config sets its own `sequence:`.
  /^button#load-data "Load data file…"$/,
  /^button#copy-link "Copy link"$/,
  /^button#download-config "Download config"$/,
  /^button#run "▶ Run"$/,
  /^div\[role=textbox\] "ProtVista configuration editor \(YAML or JSON\)"$/,
  /^div#splitter\[role=separator\] "Resize panels"$/,
  /^button "Customize"$/,
  /^div\[role=button\] "Lab hits"$/,
];

describe('playground: landmarks, headings and reading order (2.4.1, 1.3.2)', () => {
  it('has a banner, a main landmark, named regions and headings to skip by', async () => {
    const expected = [
      /^banner$/,
      /^link "← Docs"$/,
      /^heading "Configuration playground"$/,
      /^combobox "Configuration preset"$/,
      /^textbox "Accession"$/,
      /^button "Run"$/,
      /^main$/,
      /^region "Config editor"$/,
      /^heading "CONFIG \(YAML OR JSON\)"$/,
      /^textbox "ProtVista configuration editor \(YAML or JSON\)"$/,
      /^region "Validation results"$/,
      /^separator "Resize panels"$/,
      /^region "Live preview"$/,
      /^heading "PREVIEW"$/,
      /^button "Customize"$/,
      /^button "Lab hits"$/,
    ];
    const lines = outline(
      await accessibilityTreeWith((tree) => {
        const read = outline(tree);
        return expected.every((re) => read.some((l) => re.test(l)));
      })
    );
    const order = expected.map((re) => lines.findIndex((l) => re.test(l)));
    expect(order.every((i) => i >= 0), lines.join('\n')).toBe(true);
    // The tree reads in the visual order: header, then the editor (left),
    // then the preview (right).
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const { violations } = await axe.run(document, {
      runOnly: ['bypass', 'landmark-one-main', 'landmark-no-duplicate-main', 'page-has-heading-one', 'document-title', 'html-has-lang'],
    });
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});

describe('playground: keyboard order, focus and traps (2.1.2, 2.4.3, 2.4.7, 2.4.11, 3.2.1)', () => {
  it('Tab reaches every control once in reading order, through the editor and out', async () => {
    const s = withSentinels();
    const looks = snapshotLooks([document]);
    const start = pageState();
    const noRing: string[] = [];
    const hidden: string[] = [];
    const changed: string[] = [];
    try {
      const walk = await tabWalk(s.start, s.end, {
        each: (el) => {
          if (el === s.end) return;
          if (!focusIndicator(el, looks)) noRing.push(describeEl(el));
          if (!partlyVisible(el)) hidden.push(describeEl(el));
          const diff = stateDiff(start, pageState());
          if (diff.length) changed.push(`${describeEl(el)}: ${diff.join('; ')}`);
        },
      });
      const names = walk.stops.slice(0, -1).map(describeEl);
      expect(names.length, names.join('\n')).toBe(EXPECTED_STOPS.length);
      names.forEach((n, i) => expect(n).toMatch(EXPECTED_STOPS[i]));
      expect(walk.lost).toEqual([]);
      // Tab in the code editor moves focus on: the editor does not take Tab
      // for indentation (`basicSetup` has no `indentWithTab`).
      expect(noRing).toEqual([]);
      expect(hidden).toEqual([]);
      expect(changed).toEqual([]);

      const back = await tabWalk(s.end, s.start, { back: true });
      expect(back.stops.slice(0, -1).map(describeEl)).toEqual([...names].reverse());
    } finally {
      s.remove();
    }
  });

  it('focus is never entirely hidden in a short window', async () => {
    await page.viewport(1280, 400);
    const s = withSentinels();
    const hidden: string[] = [];
    try {
      await tabWalk(s.start, s.end, {
        each: (el) => {
          if (el !== s.end && !partlyVisible(el)) hidden.push(describeEl(el));
        },
      });
    } finally {
      s.remove();
      await page.viewport(1280, 720);
    }
    expect(hidden).toEqual([]);
  });
});

describe('playground: single-character keys (2.1.4)', () => {
  it('no printable key does anything outside the editor and the text fields', async () => {
    const start = pageState();
    const changed: string[] = [];
    for (const target of [null, byId('run'), byId('copy-link'), byId('splitter')]) {
      if (target) target.focus();
      else (document.activeElement as HTMLElement | null)?.blur();
      await userEvent.keyboard(PRINTABLE_KEYS);
      const diff = stateDiff(start, pageState());
      if (diff.length) changed.push(`${describeEl(target)}: ${diff.join('; ')}`);
    }
    expect(changed).toEqual([]);
  });
});

describe('playground: pointer cancellation (2.5.2)', () => {
  it('pressing a header button and releasing off it does nothing; a click acts', async () => {
    const clicks = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const anchors = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const writes: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t: string) => void writes.push(t) },
    });
    const end = page.getByText('Configuration playground');
    const actions: [string, () => number][] = [
      ['load-data', () => clicks.mock.calls.length],
      ['copy-link', () => writes.length],
      ['download-config', () => anchors.mock.calls.length],
    ];
    for (const [id, count] of actions) {
      const before = count();
      await userEvent.dragAndDrop(page.elementLocator(byId(id)), end);
      expect(count(), `press on #${id}, release off it`).toBe(before);
      await userEvent.click(byId(id));
      await vi.waitFor(() => expect(count(), `click on #${id}`).toBeGreaterThan(before));
    }
    // Run re-renders the preview: a new <protvista-uniprot>.
    const viewer = preview();
    await userEvent.dragAndDrop(page.elementLocator(byId('run')), end);
    expect(preview()).toBe(viewer);
    await userEvent.click(byId('run'));
    await vi.waitFor(() => expect(preview()).not.toBe(viewer));
    clicks.mockRestore();
    anchors.mockRestore();
  });
});

describe('playground: target size (2.5.8)', () => {
  it('every header control is 24×24 px or spaced; the panel splitter is 8 px wide (#425)', async () => {
    await vi.waitFor(() => {
      if (!preview()?.querySelector('[data-group-toggle="lab"]')) throw new Error('no preview');
    });
    const targets = [
      ...document.querySelectorAll<HTMLElement>(
        'header.bar a, header.bar button, header.bar select, header.bar input:not([hidden])'
      ),
      document.querySelector<HTMLElement>('.cm-content')!,
      byId('splitter'),
      ...preview()!.querySelectorAll<HTMLElement>('button, [role="button"]'),
    ];
    const sizes = targetSizes(targets);
    const failing = sizes.filter((s) => !s.big && !s.spaced).map((s) => `${s.what} ${s.width}×${s.height}`);
    // The splitter is 8 px wide and its 24 px circle reaches the editor.
    expect(failing).toEqual([expect.stringMatching(/^div#splitter\[role=separator\] "Resize panels" 8×/)]);
    // The two header links are under 24 px tall but have room around them.
    const links = sizes.filter((s) => s.what.startsWith('a '));
    expect(links.every((s) => !s.big && s.spaced)).toBe(true);
  });
});

describe('playground: error suggestions (3.3.3)', () => {
  /** Set the editor text and wait for the new validation result. */
  async function validate(text: string): Promise<string[]> {
    const before = byId('error-summary').textContent;
    setEditorText(text);
    await vi.waitFor(
      () => {
        if (byId('error-summary').textContent === before && listItems().length === 0) {
          throw new Error('not validated yet');
        }
      },
      { timeout: 4000 }
    );
    await new Promise((r) => setTimeout(r, 600));
    return listItems().map((li) => li.textContent ?? '');
  }

  it('messages for common mistakes say what to change', async () => {
    const cases: [string, string, RegExp][] = [
      ['unknown kind', CONFIG.replace('kind: features', 'kind: featurez'), /Valid values: .*'features'/],
      ['misspelt tracks:', CONFIG.replace('tracks:', 'tracs:'), /a group needs 'tracks:', a single track needs 'data:'\. Add one\./],
      ['bad residue', CONFIG.replace('sequence: MKT', 'sequence: 123MKT'), /uses the one-letter codes A–Z/],
      ['YAML syntax', 'rows:\n  - id: x\n   kind: features\n', /bad indentation .*\(3:4\)/s],
      ['JSON syntax', '{"rows": [ {"id": "x", } ]}', /line 1 column 24/],
      ['no rows', 'sequence: MKT\n', /must have required property 'rows'/],
      [
        'undefined variable',
        'sequence: MKT\nrows:\n  - id: x\n    kind: features\n    data: https://example.org/{dataset}.json\n',
        /Define it in top-level 'variables:'/,
      ],
    ];
    for (const [what, text, expected] of cases) {
      const messages = await validate(text);
      expect(messages.join('\n'), what).toMatch(expected);
    }
  });

  // Issue #429. A value outside an enum, or an unknown key inside a
  // track, reaches the author as the schema validator's raw messages: they
  // neither list the allowed values nor name the key, and one says `data`
  // is missing although it is there. When they are rewritten, expect the
  // allowed formats here instead.
  it('a wrong data format gets raw schema messages with no suggestion (#429)', async () => {
    const messages = await validate(CONFIG.replace('format: csv', 'format: xls'));
    expect(messages).toContain('must be equal to one of the allowed values (/rows/0/tracks/0/data/format)');
    expect(messages).toContain("must have required property 'data' (/rows/0)");
    expect(messages.some((m) => /\bcsv\b|\btsv\b|\bjson\b/.test(m))).toBe(false);
  });
});

describe('playground: changing a control (3.2.2)', () => {
  it('arrowing through the preset picker loads each preset but leaves focus on it', async () => {
    const select = byId<HTMLSelectElement>('preset');
    await choose('basic');
    await vi.waitFor(() => expect(editorText()).toContain('id:'));
    select.focus();
    const path = location.pathname + location.search;
    const text = editorText();
    await userEvent.keyboard('{ArrowDown}');
    await vi.waitFor(() => expect(select.value).toBe('inline-data'));
    await new Promise((r) => setTimeout(r, 800));
    expect(editorText()).not.toBe(text);
    expect(deepActive()).toBe(select);
    expect(location.pathname + location.search).toBe(path);
    expect(opened).toEqual([]);
  });

  it('a new valid accession re-renders the preview; Tab still goes to the next control', async () => {
    setEditorText('rows:\n  - id: x\n    kind: features\n    data: https://example.org/x.json\n');
    const old = preview();
    await userEvent.click(byId('run'));
    await vi.waitFor(() => expect(preview()).not.toBe(old));
    const accession = byId<HTMLInputElement>('accession');
    await vi.waitFor(() => expect(accession.disabled).toBe(false));
    const viewer = preview();
    accession.focus();
    accession.select();
    await userEvent.keyboard('P12345{Tab}');
    // The change re-rendered the preview: a new viewer for the new entry.
    await vi.waitFor(() => {
      expect(preview()).not.toBe(viewer);
      expect(preview()?.getAttribute('accession')).toBe('P12345');
    });
    await new Promise((r) => setTimeout(r, 1500));
    expect(deepActive()).toBe(byId('load-data'));
  });

  // Issue #426. When the new accession has no UniProt entry, the
  // preview's error panel appears and takes focus: a keyboard user who
  // pressed Tab to move on lands in the preview instead. When focus stays
  // put (and the panel is announced instead), expect `load-data` here.
  it('an unknown accession pulls focus into the preview on Tab (#426)', async () => {
    const accession = byId<HTMLInputElement>('accession');
    accession.focus();
    accession.select();
    await userEvent.keyboard('NOPE00{Tab}');
    await vi.waitFor(
      () => {
        const active = deepActive();
        expect(active?.getAttribute('role')).toBe('alert');
      },
      { timeout: 4000 }
    );
    const active = deepActive()!;
    expect(byId('preview').contains(active)).toBe(true);
    expect(active.textContent).toContain("No UniProt entry found for 'NOPE00'");
  });
});

describe('playground: the accession field in the Tab order (2.4.3, 2.4.7, 2.4.11, 3.2.1)', () => {
  // The other walks use a config with its own `sequence:`, which disables
  // the accession field; the config here has none (set by the tests above),
  // so the field is enabled and takes a stop.
  it('Tab stops on the accession between the preset and Load data, with focus shown and nothing changed', async () => {
    const accession = byId<HTMLInputElement>('accession');
    expect(accession.disabled).toBe(false);
    for (const [w, h] of [
      [1280, 720],
      [1280, 400],
    ]) {
      await page.viewport(w, h);
      const s = withSentinels();
      try {
        const looks = snapshotLooks([document]);
        const start = pageState();
        const problems: string[] = [];
        const walk = await tabWalk(s.start, byId('load-data'), {
          each: (el) => {
            if (el !== accession) return;
            if (!focusIndicator(el, looks)) problems.push('no focus indicator');
            if (!partlyVisible(el)) problems.push('hidden');
            const diff = stateDiff(start, pageState());
            if (diff.length) problems.push(`changed: ${diff.join('; ')}`);
          },
        });
        const names = walk.stops.map(describeEl);
        expect(names.slice(-3), `${w}×${h}`).toEqual([
          expect.stringMatching(/^select#preset /),
          expect.stringMatching(/^input#accession /),
          expect.stringMatching(/^button#load-data /),
        ]);
        expect(problems, `${w}×${h}`).toEqual([]);
        expect(walk.lost).toEqual([]);
      } finally {
        s.remove();
      }
    }
    await page.viewport(1280, 720);
  });
});
