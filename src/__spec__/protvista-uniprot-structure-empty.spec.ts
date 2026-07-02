import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@nightingale-elements/nightingale-structure', () => {
  class MockNightingaleStructure extends HTMLElement {}
  return { default: MockNightingaleStructure };
});

vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof import('../utils')>('../utils');
  return {
    ...actual,
    fetchAll: vi.fn(),
  };
});

import { fetchAll } from '../utils';
import '../protvista-uniprot-structure';
import type ProtvistaUniprotStructure from '../protvista-uniprot-structure';
import type { ProcessedStructureData } from '../protvista-uniprot-structure';

const mockedFetchAll = fetchAll as unknown as ReturnType<typeof vi.fn>;

const emptyFetchAll = async (urls: string[]) =>
  Object.fromEntries(urls.map((u) => [u, null]));

const flushMicrotasks = async () => {
  // Two passes is enough for fetchAll's resolution callback to run and
  // for the subsequent dispatchEvent to land.
  await Promise.resolve();
  await Promise.resolve();
};

const waitForEventOrFlush = async (
  el: HTMLElement,
  listener: ReturnType<typeof vi.fn>
) => {
  await flushMicrotasks();
  // updateComplete is on LitElement; settle Lit's reactive cycle too.
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await flushMicrotasks();
  return listener;
};

const createElementWith = (
  attrs: { accession?: string; checksum?: string; noTable?: boolean } = {}
) => {
  const el = document.createElement(
    'protvista-uniprot-structure'
  ) as ProtvistaUniprotStructure;
  if (attrs.accession) el.setAttribute('accession', attrs.accession);
  if (attrs.checksum) el.setAttribute('checksum', attrs.checksum);
  if (attrs.noTable) el.setAttribute('no-table', '');
  return el;
};

describe('<protvista-uniprot-structure> structures-loaded event', () => {
  beforeEach(() => {
    mockedFetchAll.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('dispatches structures-loaded with [] when the merged result is empty', async () => {
    mockedFetchAll.mockImplementation(emptyFetchAll);

    const el = createElementWith({ accession: 'P00000', noTable: true });
    const listener = vi.fn();
    el.addEventListener('structures-loaded', listener);
    document.body.appendChild(el);

    await waitForEventOrFlush(el, listener);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as CustomEvent<
      ReadonlyArray<ProcessedStructureData>
    >;
    expect(Array.isArray(event.detail)).toBe(true);
    expect(event.detail).toHaveLength(0);
    expect(el.data).toEqual([]);
    expect(el.selectedId).toBeUndefined();
    expect((el as unknown as { loading?: boolean }).loading).toBe(false);
  });

  it('dispatches structures-loaded exactly once for a non-empty payload', async () => {
    mockedFetchAll.mockImplementation(async (urls: string[]) => {
      const [pdbUrl, alphaFoldUrl, beaconsUrl] = urls;
      return {
        [pdbUrl]: {
          uniProtKBCrossReferences: [
            {
              database: 'PDB',
              id: '1ABC',
              properties: [
                { key: 'Method', value: 'X-ray' },
                { key: 'Resolution', value: '2.0 A' },
                { key: 'Chains', value: 'A=1-100' },
              ],
            },
          ],
        },
        [alphaFoldUrl]: null,
        [beaconsUrl]: null,
      };
    });

    const el = createElementWith({ accession: 'P00001', noTable: true });
    const listener = vi.fn();
    el.addEventListener('structures-loaded', listener);
    document.body.appendChild(el);

    await waitForEventOrFlush(el, listener);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as CustomEvent<
      ReadonlyArray<ProcessedStructureData>
    >;
    expect(event.detail).toHaveLength(1);
    expect(event.detail[0]).toMatchObject({ id: '1ABC', source: 'PDB' });
    expect(el.selectedId).toBe('1ABC');
  });

  it('respects a consumer-preset selectedId when payload is empty', async () => {
    mockedFetchAll.mockImplementation(emptyFetchAll);

    const el = createElementWith({ accession: 'P00002', noTable: true });
    el.selectedId = 'foo';
    const listener = vi.fn();
    el.addEventListener('structures-loaded', listener);
    document.body.appendChild(el);

    await waitForEventOrFlush(el, listener);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(el.selectedId).toBe('foo');
  });

  it('does not dispatch when accession and checksum are both missing', async () => {
    mockedFetchAll.mockImplementation(emptyFetchAll);

    const el = createElementWith();
    const listener = vi.fn();
    el.addEventListener('structures-loaded', listener);
    document.body.appendChild(el);

    await waitForEventOrFlush(el, listener);

    expect(listener).not.toHaveBeenCalled();
    expect(mockedFetchAll).not.toHaveBeenCalled();
  });

  it('renders the "No structure information available" message for an empty payload with no-table absent', async () => {
    mockedFetchAll.mockImplementation(emptyFetchAll);

    const el = createElementWith({ accession: 'P00003' });
    const listener = vi.fn();
    el.addEventListener('structures-loaded', listener);
    document.body.appendChild(el);

    await waitForEventOrFlush(el, listener);

    expect(el.textContent).toContain('No structure information available');
  });

  it('does not render the internal data table for an empty payload', async () => {
    mockedFetchAll.mockImplementation(emptyFetchAll);

    const el = createElementWith({ accession: 'P00004' });
    const listener = vi.fn();
    el.addEventListener('structures-loaded', listener);
    document.body.appendChild(el);

    await waitForEventOrFlush(el, listener);

    expect(el.querySelector('protvista-uniprot-datatable')).toBeNull();
  });
});
