/**
 * The structure panel's AlphaFold legend follows `colorTheme` however it was
 * set (#390), and a model without AlphaMissense annotations (or an AlphaFold
 * complex, whose viewer has no AlphaMissense colouring) shows the confidence
 * colouring without overwriting the requested `colorTheme`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { userEvent } from 'vitest/browser';

vi.mock('@nightingale-elements/nightingale-structure', () => ({
  default: class extends HTMLElement {},
  amColorScale: () => '#000000',
}));
vi.mock('../icons/download.svg', () => ({ default: '' }));
vi.mock('../icons/external-link.svg', () => ({ default: '' }));
vi.mock('../icons/spinner.svg', () => ({ default: '' }));

type El = HTMLElement & {
  colorTheme: string | null;
  data?: unknown;
  selectedId?: string;
  noTable?: boolean;
  updateComplete: Promise<boolean>;
};
const mounted: HTMLElement[] = [];
afterEach(() => mounted.splice(0).forEach((e) => e.remove()));

const AF_MONOMER = {
  id: 'AF-P1-F1',
  source: 'AlphaFold DB',
  oligomericState: 'Monomer',
  amAnnotationsUrl: 'x',
};
const AF_MONOMER_NO_AM = {
  id: 'AF-P2-F1',
  source: 'AlphaFold DB',
  oligomericState: 'Monomer',
};

async function mount(attr?: string, row: object = AF_MONOMER): Promise<El> {
  // The browser setup stubs '../protvista-uniprot-structure' globally; the
  // query suffix bypasses that mock and loads the real module.
  // @ts-expect-error query import bypasses the global stub
  await import('../protvista-uniprot-structure.ts?real=1');
  const el = document.createElement('protvista-uniprot-structure') as El;
  el.noTable = true;
  if (attr) el.setAttribute('color-theme', attr);
  document.body.append(el);
  mounted.push(el);
  el.data = [row];
  el.selectedId = (row as { id: string }).id;
  await el.updateComplete;
  await el.updateComplete;
  return el;
}

const legend = (el: El) =>
  el.querySelector('.protvista-uniprot-structure__meta strong')?.textContent;

const checkedValue = (el: El) =>
  (el.querySelector('input[type="radio"]:checked') as HTMLInputElement | null)
    ?.value;

const viewerTheme = (el: El) =>
  el.querySelector('nightingale-structure')?.getAttribute('color-theme');

describe('structure legend follows colorTheme', () => {
  it('color-theme="alphamissense" set before load', async () => {
    const el = await mount('alphamissense');
    expect(legend(el)).toBe('Model Pathogenicity:');
  });

  it('colorTheme = "alphamissense" set after load', async () => {
    const el = await mount();
    el.colorTheme = 'alphamissense';
    await el.updateComplete;
    expect(legend(el)).toBe('Model Pathogenicity:');
  });

  it('colorTheme = "alphafold" set after load restores the confidence legend', async () => {
    const el = await mount('alphamissense');
    el.colorTheme = 'alphafold';
    await el.updateComplete;
    expect(legend(el)).toBe('Model Confidence:');
  });

  it('clicking the radios switches the legend', async () => {
    const el = await mount();
    expect(legend(el)).toBe('Model Confidence:');
    await userEvent.click(
      el.querySelector('input[value="alphamissense"]') as HTMLElement
    );
    await el.updateComplete;
    expect(legend(el)).toBe('Model Pathogenicity:');
    await userEvent.click(
      el.querySelector('input[value="alphafold"]') as HTMLElement
    );
    await el.updateComplete;
    expect(legend(el)).toBe('Model Confidence:');
  });
});

// The fallback only changes what is shown: `colorTheme` keeps the requested
// value so it applies again once an annotated model is selected.
const expectConfidenceShown = (el: El) => {
  expect(el.colorTheme).toBe('alphamissense');
  expect(checkedValue(el)).toBe('alphafold');
  expect(viewerTheme(el)).toBe('alphafold');
  expect(legend(el)).toBe('Model Confidence:');
};

const expectPathogenicityShown = (el: El) => {
  expect(el.colorTheme).toBe('alphamissense');
  expect(checkedValue(el)).toBe('alphamissense');
  expect(viewerTheme(el)).toBe('alphamissense');
  expect(legend(el)).toBe('Model Pathogenicity:');
};

async function settle(el: El) {
  await el.updateComplete;
  await el.updateComplete;
}

describe('alphamissense requested for a model without AlphaMissense annotations', () => {
  it('falls back to confidence when set before load', async () => {
    const el = await mount('alphamissense', AF_MONOMER_NO_AM);
    expectConfidenceShown(el);
  });

  it('falls back to confidence when set after load', async () => {
    const el = await mount(undefined, AF_MONOMER_NO_AM);
    el.colorTheme = 'alphamissense';
    await el.updateComplete;
    expectConfidenceShown(el);
  });

  it('re-applies alphamissense when an annotated model is selected afterwards', async () => {
    const el = await mount('alphamissense', AF_MONOMER_NO_AM);
    el.data = [AF_MONOMER_NO_AM, AF_MONOMER];
    await settle(el);
    expectConfidenceShown(el);
    el.selectedId = AF_MONOMER.id;
    await settle(el);
    expect(el.getAttribute('color-theme')).toBe('alphamissense');
    expectPathogenicityShown(el);
  });
});

// The real "set before the structure loads" case: the element renders once
// with no data, and the data arrives in a later update without colorTheme.
async function mountLate(attr: string, row: { id: string }): Promise<El> {
  // @ts-expect-error query import bypasses the global stub
  await import('../protvista-uniprot-structure.ts?real=1');
  const el = document.createElement('protvista-uniprot-structure') as El;
  el.noTable = true;
  el.setAttribute('color-theme', attr);
  document.body.append(el);
  mounted.push(el);
  await el.updateComplete;
  el.data = [row];
  el.selectedId = row.id;
  await settle(el);
  return el;
}

describe('color-theme set before data arrives in a later update', () => {
  it('shows the pathogenicity legend', async () => {
    const el = await mountLate('alphamissense', AF_MONOMER);
    expectPathogenicityShown(el);
  });

  it('falls back to confidence without AlphaMissense annotations', async () => {
    const el = await mountLate('alphamissense', AF_MONOMER_NO_AM);
    expectConfidenceShown(el);
  });
});

describe('row change while colorTheme is alphamissense', () => {
  const AF_MONOMER_2 = { ...AF_MONOMER, id: 'AF-P3-F1' };
  const PDB = { id: '1abc', source: 'PDBe' };

  async function mountRows(): Promise<El> {
    const el = await mount('alphamissense');
    el.data = [AF_MONOMER, AF_MONOMER_2, AF_MONOMER_NO_AM, PDB];
    await settle(el);
    expectPathogenicityShown(el);
    return el;
  }

  it('keeps the pathogenicity legend after switching to PDB and back', async () => {
    const el = await mountRows();
    el.selectedId = PDB.id;
    await settle(el);
    el.selectedId = AF_MONOMER.id;
    await settle(el);
    expectPathogenicityShown(el);
  });

  it('keeps the pathogenicity legend switching to a second annotated AF row', async () => {
    const el = await mountRows();
    el.selectedId = AF_MONOMER_2.id;
    await settle(el);
    expectPathogenicityShown(el);
  });

  it('falls back to confidence when switching to an AF row without annotations', async () => {
    const el = await mountRows();
    el.selectedId = AF_MONOMER_NO_AM.id;
    await settle(el);
    expectConfidenceShown(el);
  });
});

describe('AlphaFold complex (model-url viewer, never AlphaMissense-coloured)', () => {
  const AF_DIMER = {
    id: 'AF-P1-dimer',
    source: 'AlphaFold DB',
    oligomericState: 'Homodimer',
    amAnnotationsUrl: 'x',
    downloadUrl: 'https://example.org/m.cif',
  };

  it('host colorTheme = "alphamissense" keeps the confidence legend', async () => {
    const el = await mount(undefined, AF_DIMER);
    const viewer = el.querySelector('nightingale-structure');
    expect(viewer?.getAttribute('model-url')).toBe(AF_DIMER.downloadUrl);
    expect(viewer?.hasAttribute('color-theme')).toBe(false);
    expect(legend(el)).toBe('Model Confidence:');

    el.colorTheme = 'alphamissense';
    await el.updateComplete;
    expect(legend(el)).toBe('Model Confidence:');
    expect(checkedValue(el)).toBe('alphafold');
    const amRadio = el.querySelector(
      'input[value="alphamissense"]'
    ) as HTMLInputElement;
    expect(amRadio.disabled).toBe(true);
  });
});
