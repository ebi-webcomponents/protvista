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

async function mountPanel(): Promise<{ panel: Panel; before: HTMLElement; after: HTMLElement }> {
  // The browser setup stubs the structure module; the query bypasses it.
  // @ts-expect-error query import
  await import('../protvista-uniprot-structure.ts?real=1');
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

describe('structure panel: keyboard (2.1.2, 2.4.3, 2.4.7, 2.4.11, 3.2.1)', () => {
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
    expect(rest.filter((n) => !n.startsWith('tr[') && !n.startsWith('a '))).toEqual([]);
    expect(walk.lost).toEqual([]);
    expect(noRing).toEqual([]);
    expect(hidden).toEqual([]);
    expect(changed).toEqual([]);
  });

  it('a colour radio changes on input without moving focus (3.2.2)', async () => {
    // A panel with AlphaMissense colouring available, as
    // `structure-color-radios.browser.spec.ts` mounts it.
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

  // Issue to file: L. The datatable's `updated()` moves focus to a row
  // whenever its filters change while it has focus, and the filter that was
  // just changed is inside it. With the keyboard, ArrowDown on a closed
  // <select> changes its value at once (Chromium on Windows and Linux), so a
  // keyboard user is moved out of the filter after one step. When focus
  // stays on the filter, expect `filter` here.
  it('changing a table filter moves focus to a row (issue to file: L)', async () => {
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

  it('radios are under 24 px but spaced, and their labels widen the target (2.5.8)', async () => {
    const { panel } = await mountPanel();
    const radios = [...panel.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    const sizes = targetSizes(radios);
    expect(sizes.every((s) => s.big || s.spaced), JSON.stringify(sizes)).toBe(true);
  });
});

describe('datatable: focus under the sticky header (2.4.11)', () => {
  it('arrowing up through a scrolled table hides the focused row under the header (issue to file: M)', async () => {
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
    // Issue to file: M. Once the table has to scroll up, the browser brings
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
    [320, 256, false],
    [1280, 720, true],
  ])('at %i×%i CSS px (text spacing: %s) nothing is clipped or overlaps', async (w, h, spacing) => {
    await page.viewport(w, h);
    const { panel } = await mountPanel();
    const undo = spacing ? applyTextSpacing() : () => undefined;
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      // The 3D view is a stub here; the table is two-dimensional data, so
      // only its own scroll box may scroll sideways (1.4.10 exempts it).
      // The table's columns may run on inside its own scroll box.
      const problems = layoutProblems(
        [panel],
        (el) =>
          el.localName === 'nightingale-structure' ||
          (w <= 320 && el.matches('.scroll-container'))
      );
      expect(problems.map((p) => `${p.kind}: ${p.what}`)).toEqual([]);
      expect(sideways(panel)).toEqual([]);
      expect(sidewaysScroll()).toBe(0);
    } finally {
      undo();
    }
  });
});
