/**
 * Automated browser check (Chromium) of the structure panel and its
 * datatable for the WCAG audit (`docs/accessibility-audit.md`, issue #382):
 * keyboard order and traps, focus visibility and obscuring (the table's
 * sticky header), what focusing or changing a control does (the colour
 * radios and the table filters), and target sizes.
 *
 * The panel is the real `<protvista-uniprot-structure>` (loaded past the
 * global stub, as in `structure-color-radios.browser.spec.ts`); the 3D view
 * inside it, `<nightingale-structure>` (Mol*, WebGL), is a stub, so its own
 * keyboard behaviour is not checked here.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { html } from 'lit';

vi.mock('@nightingale-elements/nightingale-structure', () => ({
  default: class extends HTMLElement {},
  amColorScale: () => '#000000',
}));
vi.mock('../icons/download.svg', () => ({ default: '' }));
vi.mock('../icons/external-link.svg', () => ({ default: '' }));
vi.mock('../icons/spinner.svg', () => ({ default: '' }));

import '../protvista-uniprot-datatable.js';
import type { ProtvistaUniprotDatatable } from '../protvista-uniprot-datatable.js';
import {
  applyTextSpacing,
  deepActive,
  deepElements,
  layoutProblems,
  sidewaysScroll,
  describeEl,
  focusIndicator,
  partlyVisible,
  snapshotLooks,
  stateDiff,
  stateOf,
  tabWalk,
  targetSizes,
} from './a11y-checks.js';

type Panel = HTMLElement & {
  colorTheme: string | null;
  metaInfo?: unknown;
  data?: unknown;
  selectedId?: string;
  updateComplete: Promise<boolean>;
};

const mounted: HTMLElement[] = [];
afterEach(() => {
  mounted.splice(0).forEach((e) => e.remove());
});
const add = <T extends HTMLElement>(el: T): T => {
  document.body.append(el);
  mounted.push(el);
  return el;
};
const button = (text: string) =>
  add(Object.assign(document.createElement('button'), { textContent: text }));

/** Three structures: two experimental, one AlphaFold model. */
const ROWS = [
  { id: '1AAP', source: 'PDB', method: 'X-ray', resolution: '1.50 A', chain: 'A', positions: '287-344', downloadUrl: 'https://example.org/1aap.cif' },
  { id: '1MWP', source: 'PDB', method: 'X-ray', resolution: '1.80 A', chain: 'A', positions: '18-122', downloadUrl: 'https://example.org/1mwp.cif' },
  { id: 'AF-P05067-F1', source: 'AlphaFold DB', method: 'Predicted', chain: 'A', positions: '1-770', amAnnotationsUrl: 'x', downloadUrl: 'https://example.org/af.cif' },
];

/**
 * Define the real `<protvista-uniprot-structure>`. The browser setup stubs
 * the structure module; the query bypasses it. Every test that mounts the
 * panel calls this, so each also runs alone (`-t`).
 */
async function loadReal() {
  // @ts-expect-error query import
  await import('../protvista-uniprot-structure.ts?real=1');
}

async function mountPanel(): Promise<{ panel: Panel; before: HTMLElement; after: HTMLElement }> {
  await loadReal();
  const before = button('Before the panel');
  const panel = document.createElement('protvista-uniprot-structure') as Panel;
  panel.metaInfo = html`<p>legend</p>`;
  (panel as unknown as { alphamissenseAvailable: boolean }).alphamissenseAvailable = true;
  add(panel);
  panel.data = ROWS;
  panel.selectedId = 'AF-P05067-F1';
  // The panel builds its columns when it loads its own data; these rows are
  // handed in, so build them the same way.
  const internals = panel as unknown as { columns: unknown; getColumns(): unknown };
  internals.columns = internals.getColumns();
  await panel.updateComplete;
  await panel.updateComplete;
  const after = button('After the panel');
  await vi.waitFor(() => {
    const table = panel.querySelector('protvista-uniprot-datatable');
    if (!table?.shadowRoot?.querySelector('tbody tr[data-id]')) throw new Error('no rows');
  });
  return { panel, before, after };
}

/** The rows of the panel's table, in document order. */
const tableRows = (table: Element) => [...table.shadowRoot!.querySelectorAll<HTMLElement>('tbody tr[data-id]')];

/** The links a Tab can reach in `row`. */
const rowLinks = (row: Element) =>
  [...row.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(
    (a) => a.tabIndex >= 0 && a.getClientRects().length > 0
  );

describe('structure panel: keyboard (2.1.2, 2.4.3, 2.4.7, 2.4.11, 3.2.1)', () => {
  afterEach(async () => {
    await page.viewport(1280, 720);
  });

  it('Tab reaches the colour radios, the filters and the table, shows focus and leaves', async () => {
    const { panel, before, after } = await mountPanel();
    const table = panel.querySelector('protvista-uniprot-datatable')!;
    const looks = snapshotLooks([panel, table.shadowRoot! as unknown as Element]);
    const start = stateOf([panel, table.shadowRoot! as unknown as Element]);
    const noRing: string[] = [];
    const hidden: string[] = [];
    const changed: string[] = [];
    const walk = await tabWalk(before, after, {
      each: (el) => {
        if (el === after) return;
        if (!focusIndicator(el, looks)) noRing.push(describeEl(el));
        if (!partlyVisible(el)) hidden.push(describeEl(el));
        const diff = stateDiff(start, stateOf([panel, table.shadowRoot! as unknown as Element]));
        if (diff.length) changed.push(`${describeEl(el)}: ${diff.join('; ')}`);
      },
    });
    const names = walk.stops.slice(0, -1).map((el) => describeEl(el).replace(/#\S+?(?=[ [])/, ''));
    // One stop for the radio group (Pathogenicity is disabled for this
    // model), one per filter, then the table: one stop for the rows (the
    // selected one; the arrow keys move between them) among the links in
    // every row, in document order.
    expect(names.slice(0, 3)).toEqual([
      'input "Confidence"',
      'select "Filter by Source"',
      'select "Filter by Method"',
    ]);
    const rest = names.slice(3);
    expect(rest.filter((n) => n.startsWith('tr[role=option]'))).toEqual([
      expect.stringMatching(/^tr\[role=option\] "AlphaFold DBAF-P05067-F1/),
    ]);
    // Every link in every row is a stop, in document order (top to
    // bottom, left to right), and the selected row comes just before its
    // own links: so the links of the rows above it come before it.
    const rows = tableRows(table);
    const expected = rows.flatMap((row) => [...(row.tabIndex === 0 ? [row] : []), ...rowLinks(row)]);
    expect(rows.flatMap(rowLinks).length).toBeGreaterThanOrEqual(ROWS.length);
    expect(walk.stops.slice(3, -1).map(describeEl)).toEqual(expected.map(describeEl));
    expect(walk.stops.slice(3, -1)).toEqual(expected);
    expect(walk.lost).toEqual([]);
    expect(noRing).toEqual([]);
    expect(hidden).toEqual([]);
    expect(changed).toEqual([]);

    // Shift+Tab walks the same stops backwards and leaves the panel, also
    // changing nothing.
    const back = await tabWalk(after, before, { back: true });
    expect(back.lost).toEqual([]);
    expect(back.stops.slice(0, -1)).toEqual(walk.stops.slice(0, -1).reverse());
    expect(stateDiff(start, stateOf([panel, table.shadowRoot! as unknown as Element]))).toEqual([]);
  });

  it('focus is never entirely hidden in a short window (1280×400), either way', async () => {
    await page.viewport(1280, 400);
    const { before, after } = await mountPanel();
    for (const [from, to, back] of [
      [before, after, false],
      [after, before, true],
    ] as const) {
      const hidden: string[] = [];
      const walk = await tabWalk(from, to, {
        back,
        each: (el) => {
          if (el !== to && !partlyVisible(el)) hidden.push(describeEl(el));
        },
      });
      expect(walk.stops.length).toBeGreaterThan(5);
      expect(hidden, back ? 'Shift+Tab' : 'Tab').toEqual([]);
    }
  });

  it('a colour radio changes on input without moving focus (3.2.2)', async () => {
    // A panel with AlphaMissense colouring available, as
    // `structure-color-radios.browser.spec.ts` mounts it.
    await loadReal();
    const radios = document.createElement('protvista-uniprot-structure') as Panel;
    radios.metaInfo = html`<p>legend</p>`;
    (radios as unknown as { alphamissenseAvailable: boolean }).alphamissenseAvailable = true;
    add(radios);
    await radios.updateComplete;
    const radio = radios.querySelector<HTMLInputElement>('input[value="alphafold"]')!;
    radio.focus();
    await userEvent.keyboard('{ArrowDown}');
    await radios.updateComplete;
    expect(radios.colorTheme).toBe('alphamissense');
    expect(deepActive()).toBe(radios.querySelector('input[value="alphamissense"]'));
  });

  // Issue #427. The datatable's `updated()` moves focus to a row
  // whenever its filters change while it has focus, and the filter that was
  // just changed is inside it. With the keyboard, ArrowDown on a closed
  // <select> changes its value at once (Chromium on Windows and Linux), so a
  // keyboard user is moved out of the filter after one step. When focus
  // stays on the filter, expect `filter` here.
  it('changing a table filter moves focus to a row (#427)', async () => {
    const { panel } = await mountPanel();
    const table = panel.querySelector('protvista-uniprot-datatable')!;
    const filter = table.shadowRoot!.querySelector<HTMLSelectElement>('select[data-key="method"]')!;
    filter.focus();
    await userEvent.keyboard('{ArrowDown}');
    await (table as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(filter.value).not.toBe('');
    expect(table.shadowRoot!.querySelectorAll('tbody tr[data-id]').length).toBeLessThan(ROWS.length);
    expect(deepActive()?.getAttribute('role')).toBe('option');
  });

  // The radios are the browser's own 13 px controls, one per line. In a
  // wide panel their lines are 20 px apart, so their 24 px circles meet and
  // they do not have the spacing 2.5.8 allows; they pass only under its
  // exception for a target whose size the user agent sets and the author
  // does not change. (In a narrow panel the labels wrap and the radios end
  // up far enough apart.) Each also has a linked text label.
  it('the colour radios are the browser-default size, 20 px apart, with linked labels (2.5.8)', async () => {
    await page.viewport(1280, 720);
    const { panel } = await mountPanel();
    const radios = [...panel.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios).toHaveLength(2);
    // Sized by the browser: the same size as a radio with no styles.
    const plain = add(Object.assign(document.createElement('input'), { type: 'radio' }));
    const { width, height } = plain.getBoundingClientRect();
    expect(width).toBeLessThan(24);
    const sizes = targetSizes(radios);
    expect(sizes.map((s) => [s.width, s.height])).toEqual(radios.map(() => [width, height]));
    expect(sizes.map((s) => [s.big, s.spaced]), JSON.stringify(sizes)).toEqual([
      [false, false],
      [false, false],
    ]);
    const [a, b] = radios.map((r) => r.getBoundingClientRect());
    expect(Math.round(b.top - a.top)).toBe(20);
    // Each radio has a text label that selects it.
    for (const radio of radios) {
      const label = radio.labels?.[0];
      expect(label?.textContent?.trim()).toBeTruthy();
      expect(label?.control).toBe(radio);
    }
  });
});

describe('datatable: focus under the sticky header (2.4.11)', () => {
  it('arrowing up through a scrolled table hides the focused row under the header (#428)', async () => {
    const before = button('Before the table');
    const table = add(document.createElement('protvista-uniprot-datatable')) as unknown as ProtvistaUniprotDatatable<{ id: string; source: string; method: string }>;
    (table as unknown as HTMLElement).style.setProperty('--protvista-datatable-max-height', '240px');
    table.data = Array.from({ length: 30 }, (_, i) => ({
      id: String(i + 1),
      source: i % 2 ? 'PDB' : 'AlphaFold',
      method: i % 3 ? 'X-ray' : 'Predicted',
    }));
    table.columns = [
      { label: 'ID', key: 'id' },
      { label: 'Source', key: 'source', filterable: true },
      { label: 'Method', key: 'method', filterable: true },
    ];
    await table.updateComplete;
    before.focus();
    // Tab to the rows (past the two filters), then End, then up again.
    await userEvent.keyboard('{Tab}{Tab}{Tab}');
    expect(deepActive()?.getAttribute('role')).toBe('option');
    await userEvent.keyboard('{End}');
    const hidden: string[] = [];
    for (let i = 0; i < 29; i++) {
      await userEvent.keyboard('{ArrowUp}');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const row = deepActive()!;
      if (!partlyVisible(row)) hidden.push(row.getAttribute('data-id')!);
    }
    // Issue #428. Once the table has to scroll up, the browser brings
    // the focused row to the top edge of the scroll box, where the sticky
    // header (with its filters) covers it completely. When the table keeps
    // rows clear of the header (`scroll-padding-top`, or scrolling them in
    // itself), expect no hidden rows here.
    expect(hidden.length).toBeGreaterThan(20);
    expect(hidden).toContain('1');
  });
});

describe('structure panel: zoom, reflow and text spacing (1.4.4, 1.4.10, 1.4.12)', () => {
  afterEach(async () => {
    await page.viewport(1280, 720);
  });

  /** Boxes that scroll sideways, other than the table's own scroll box. */
  const sideways = (panel: Element) =>
    deepElements(panel)
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowX))
      .filter((el) => !el.matches('.scroll-container'))
      .map(describeEl);

  it.each([
    [640, 360, false],
    [960, 540, false],
    [320, 256, false],
    [1280, 720, true],
  ])('at %i×%i CSS px (text spacing: %s) nothing is clipped or overlaps', async (w, h, spacing) => {
    await page.viewport(w, h);
    const { panel } = await mountPanel();
    const undo = spacing ? applyTextSpacing() : () => undefined;
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      // The 3D view is a stub here; the table is two-dimensional data, so
      // only its own scroll box may scroll sideways (1.4.10 exempts it):
      // its columns may run on past the page's edge inside that box, but its
      // cells and sticky header are still checked for clipped and
      // overlapping text.
      const problems = layoutProblems([panel], (el) => el.localName === 'nightingale-structure', {
        scrolls: (el) => el.matches('.scroll-container'),
      });
      expect(problems.map((p) => `${p.kind}: ${p.what}`)).toEqual([]);
      expect(sideways(panel)).toEqual([]);
      expect(sidewaysScroll()).toBe(0);
    } finally {
      undo();
    }
  });
});
