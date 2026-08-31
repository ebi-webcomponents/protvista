/**
 * Real-DOM accessibility + interaction coverage for
 * `<protvista-uniprot-datatable>`.
 *
 * jsdom can't render this component's Shadow DOM the way a browser does,
 * nor run its roving-tabindex keyboard navigation or native `<select>`
 * behaviour. These tests mount the element for real (Playwright/Chromium)
 * and drive it with real events, then assert with axe-core.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from 'vitest/browser';

import '../protvista-uniprot-datatable.js';
import type { ProtvistaUniprotDatatable } from '../protvista-uniprot-datatable.js';
import { mount, track } from './mount.js';
import { expectNoA11yViolations } from './axe.js';

type Row = { id: string; source: string; method: string };

const DATA: Row[] = [
  { id: '1', source: 'PDB', method: 'Experimental' },
  { id: '2', source: 'AlphaFold', method: 'Predicted' },
  { id: '3', source: 'PDB', method: 'Experimental' },
  { id: '4', source: 'PDB', method: 'Predicted' },
];

const COLUMNS = [
  { label: 'ID', key: 'id' },
  { label: 'Source', key: 'source', filterable: true },
  { label: 'Method', key: 'method', filterable: true },
];

type El = ProtvistaUniprotDatatable<Row>;

async function mountTable(): Promise<El> {
  const el = mount<El>('protvista-uniprot-datatable');
  el.data = DATA;
  el.columns = COLUMNS;
  await el.updateComplete;
  return el;
}

const rows = (el: El) =>
  Array.from(
    el.shadowRoot!.querySelectorAll<HTMLTableRowElement>('tbody tr[data-id]')
  );

const focusedRow = (el: El) =>
  el.shadowRoot!.querySelector<HTMLTableRowElement>('tbody tr[tabindex="0"]');

describe('<protvista-uniprot-datatable> — accessibility', () => {
  it('has no axe violations when rendered', async () => {
    const el = await mountTable();
    await expectNoA11yViolations(el);
  });

  it('exposes listbox/option semantics and labelled filter selects', async () => {
    const el = await mountTable();
    const tbody = el.shadowRoot!.querySelector('tbody')!;
    expect(tbody.getAttribute('role')).toBe('listbox');
    expect(tbody.getAttribute('aria-label')).toBe('Results');

    const selects = el.shadowRoot!.querySelectorAll('select');
    expect(selects.length).toBe(2);
    expect(selects[0].getAttribute('aria-label')).toBe('Filter by Source');
    expect(selects[1].getAttribute('aria-label')).toBe('Filter by Method');
  });
});

describe('<protvista-uniprot-datatable> — filtering', () => {
  it('narrows the rows to the selected value and restores on "All"', async () => {
    const el = await mountTable();
    expect(rows(el)).toHaveLength(4);

    const sourceSelect = el.shadowRoot!.querySelector<HTMLSelectElement>(
      'select[data-key="source"]'
    )!;
    await userEvent.selectOptions(sourceSelect, 'AlphaFold');
    await el.updateComplete;

    const filtered = rows(el);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].dataset.id).toBe('2');

    // Back to "All" restores every row.
    await userEvent.selectOptions(sourceSelect, '');
    await el.updateComplete;
    expect(rows(el)).toHaveLength(4);
  });

  it('shows the empty-state row when a filter matches nothing', async () => {
    const el = await mountTable();
    // Two filters that never co-occur → zero rows.
    const sourceSelect = el.shadowRoot!.querySelector<HTMLSelectElement>(
      'select[data-key="source"]'
    )!;
    const methodSelect = el.shadowRoot!.querySelector<HTMLSelectElement>(
      'select[data-key="method"]'
    )!;
    await userEvent.selectOptions(sourceSelect, 'AlphaFold');
    await userEvent.selectOptions(methodSelect, 'Experimental');
    await el.updateComplete;

    expect(rows(el)).toHaveLength(0);
    const noResults = el.shadowRoot!.querySelector('.no-results');
    expect(noResults?.textContent).toMatch(/No matching results/);
  });
});

describe('<protvista-uniprot-datatable> — keyboard operability', () => {
  beforeEach(() => {
    // Give a fresh document focus baseline per test.
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

  it('moves a roving tabindex with Arrow/Home/End and selects on Enter', async () => {
    const el = await mountTable();
    const selected = vi.fn();
    el.addEventListener('row-click', (e) =>
      selected((e as CustomEvent<Row>).detail.id)
    );

    // Focus the first row (its tabindex is 0 by default).
    const first = rows(el)[0];
    first.focus();
    expect(el.shadowRoot!.activeElement).toBe(first);

    await userEvent.keyboard('{ArrowDown}');
    await el.updateComplete;
    expect(focusedRow(el)?.dataset.id).toBe('2');

    await userEvent.keyboard('{End}');
    await el.updateComplete;
    expect(focusedRow(el)?.dataset.id).toBe('4');

    await userEvent.keyboard('{Home}');
    await el.updateComplete;
    expect(focusedRow(el)?.dataset.id).toBe('1');

    await userEvent.keyboard('{ArrowDown}');
    await el.updateComplete;
    // Enter selects the currently-focused row.
    await userEvent.keyboard('{Enter}');
    await el.updateComplete;

    const active = el.shadowRoot!.querySelector('tbody tr.active');
    expect(active?.getAttribute('aria-selected')).toBe('true');
    expect(active?.getAttribute('data-id')).toBe('2');
    expect(selected).toHaveBeenCalledWith('2');
  });

  it('keeps exactly one row in the tab order (roving tabindex)', async () => {
    const el = await mountTable();
    const tabbable = el.shadowRoot!.querySelectorAll('tbody tr[tabindex="0"]');
    expect(tabbable).toHaveLength(1);
  });
});

describe('<protvista-uniprot-datatable> — pointer selection', () => {
  it('selecting a row via click fires row-click and marks it active', async () => {
    const el = await mountTable();
    const selected = vi.fn();
    el.addEventListener('row-click', (e) =>
      selected((e as CustomEvent<Row>).detail.id)
    );

    await userEvent.click(rows(el)[2]);
    await el.updateComplete;

    const active = el.shadowRoot!.querySelector('tbody tr.active');
    expect(active?.getAttribute('data-id')).toBe('3');
    expect(active?.getAttribute('aria-selected')).toBe('true');
    expect(selected).toHaveBeenCalledWith('3');
  });
});

describe('<protvista-uniprot-datatable> — theming reaches the shadow root', () => {
  /** Mount the table inside a wrapper carrying token overrides, which is
   *  how a consumer themes one viewer rather than the whole page. */
  async function mountUnder(vars: Record<string, string>): Promise<El> {
    const wrapper = track(document.createElement('div'));
    for (const [name, value] of Object.entries(vars)) {
      wrapper.style.setProperty(name, value);
    }
    const el = document.createElement(
      'protvista-uniprot-datatable'
    ) as unknown as El;
    wrapper.append(el);
    el.data = DATA;
    el.columns = COLUMNS;
    await el.updateComplete;
    return el;
  }

  const container = (el: El) =>
    el.shadowRoot!.querySelector('.scroll-container')!;

  it('takes a component token set on an ancestor', async () => {
    // These tokens used to be declared on `:host`, and a declaration on
    // an element beats anything inherited into it — so this override
    // reached nothing, though docs/theming.md advertises exactly it.
    const el = await mountUnder({
      '--protvista-datatable-border': 'rgb(0, 128, 0)',
    });
    expect(getComputedStyle(container(el)).borderTopColor).toBe(
      'rgb(0, 128, 0)'
    );
  });

  it('takes a global token the component token defaults from', async () => {
    const el = await mountUnder({
      '--protvista-color-surface': 'rgb(0, 128, 0)',
    });
    expect(getComputedStyle(container(el)).backgroundColor).toBe(
      'rgb(0, 128, 0)'
    );
  });

  it('still honours a legacy --protvista-dt-* override', async () => {
    const el = await mountUnder({ '--protvista-dt-border': 'rgb(0, 128, 0)' });
    expect(getComputedStyle(container(el)).borderTopColor).toBe(
      'rgb(0, 128, 0)'
    );
  });

  it('prefers the current token name over the legacy alias', async () => {
    const el = await mountUnder({
      '--protvista-dt-border': 'rgb(255, 0, 0)',
      '--protvista-datatable-border': 'rgb(0, 128, 0)',
    });
    expect(getComputedStyle(container(el)).borderTopColor).toBe(
      'rgb(0, 128, 0)'
    );
  });

  it('falls back to the shipped literal when nothing is set', async () => {
    const el = await mountUnder({});
    expect(getComputedStyle(container(el)).borderTopColor).toBe(
      'rgb(224, 224, 224)'
    );
  });
});
