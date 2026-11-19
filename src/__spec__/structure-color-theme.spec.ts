/**
 * The real `<protvista-uniprot-structure>` attribute handling: the
 * `color-theme` mapping (a camel-cased `colorTheme` would otherwise observe
 * the lowercased `colortheme`), and the warning when React 19 stringified the
 * object-valued `data` prop into an attribute.
 *
 * Also covers colour-scale radio binding, per-instance uniqueness, and the
 * accessible fieldset group (#310).
 *
 * `nightingale-mocks.ts` stubs this whole module with a bare `HTMLElement`
 * subclass for every other spec, so this one unmocks it to exercise the real
 * property declarations.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { html, LitElement } from 'lit';

// Undo the global stub so the real (self-registering) element loads.
vi.unmock('../protvista-uniprot-structure');
// The global mock of nightingale-structure has no default export, which the
// real module imports; give it one so the module graph loads.
vi.mock('@nightingale-elements/nightingale-structure', () => ({
  default: class extends HTMLElement {},
  amColorScale: () => '#000000',
}));
vi.mock('../icons/download.svg', () => ({ default: '' }));
vi.mock('../icons/external-link.svg', () => ({ default: '' }));
vi.mock('../icons/spinner.svg', () => ({ default: '' }));

type StructureEl = LitElement & {
  colorTheme: string;
  data?: unknown;
  metaInfo?: unknown;
  updateComplete: Promise<boolean>;
};

const appended: HTMLElement[] = [];
afterEach(() => {
  appended.splice(0).forEach((el) => el.remove());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountStructure(
  overrides: Partial<StructureEl> = {}
): Promise<StructureEl> {
  await import('../protvista-uniprot-structure');
  const el = document.createElement(
    'protvista-uniprot-structure'
  ) as StructureEl;
  // metaInfo gates the colour-scale radios in render().
  el.metaInfo = html`<p data-testid="legend">legend</p>`;
  // The Pathogenicity radio is only shown checked when the model has
  // AlphaMissense annotations.
  (el as unknown as { alphamissenseAvailable: boolean }).alphamissenseAvailable =
    true;
  Object.assign(el, overrides);
  document.body.append(el);
  appended.push(el);
  await el.updateComplete;
  return el;
}

describe('<protvista-uniprot-structure> attributes', () => {
  it('observes `color-theme`, not the lowercased `colortheme`', async () => {
    await import('../protvista-uniprot-structure');
    const ctor = customElements.get('protvista-uniprot-structure') as
      | (CustomElementConstructor & { observedAttributes: string[] })
      | undefined;
    expect(ctor).toBeDefined();
    expect(ctor!.observedAttributes).toContain('color-theme');
    expect(ctor!.observedAttributes).not.toContain('colortheme');
  });

  it('sets colorTheme from the color-theme attribute', async () => {
    await import('../protvista-uniprot-structure');
    const el = document.createElement(
      'protvista-uniprot-structure'
    ) as StructureEl;
    expect(el.colorTheme).toBe('alphafold');
    el.setAttribute('color-theme', 'confidence');
    expect(el.colorTheme).toBe('confidence');
  });

  it('warns when React 19 stringified `data` into an attribute', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('../protvista-uniprot-structure');
    const el = document.createElement(
      'protvista-uniprot-structure'
    ) as StructureEl;
    el.setAttribute('data', '[object Object]');
    document.body.append(el);
    appended.push(el);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/`data`.*value was lost/)
    );
  });
});

describe('<protvista-uniprot-structure> colour-scale radios', () => {
  it('checks the radio that matches colorTheme', async () => {
    const el = await mountStructure({ colorTheme: 'alphamissense' });
    const checked = el.querySelector(
      'input[type="radio"]:checked'
    ) as HTMLInputElement | null;
    expect(checked).not.toBeNull();
    expect(checked!.value).toBe('alphamissense');
  });

  it('defaults the Confidence radio when colorTheme is alphafold', async () => {
    const el = await mountStructure();
    const checked = el.querySelector(
      'input[type="radio"]:checked'
    ) as HTMLInputElement | null;
    expect(checked).not.toBeNull();
    expect(checked!.value).toBe('alphafold');
  });

  it('gives two instances independent radio groups', async () => {
    const a = await mountStructure();
    const b = await mountStructure({ colorTheme: 'alphamissense' });

    const namesA = [...a.querySelectorAll('input[type="radio"]')].map(
      (input) => (input as HTMLInputElement).name
    );
    const namesB = [...b.querySelectorAll('input[type="radio"]')].map(
      (input) => (input as HTMLInputElement).name
    );
    expect(namesA.length).toBeGreaterThan(0);
    expect(namesA.every((n) => n === namesA[0])).toBe(true);
    expect(namesB.every((n) => n === namesB[0])).toBe(true);
    expect(namesA[0]).not.toBe(namesB[0]);

    const ids = [
      ...a.querySelectorAll('input[type="radio"]'),
      ...b.querySelectorAll('input[type="radio"]'),
    ].map((input) => input.id);
    expect(new Set(ids).size).toBe(ids.length);

    const checkedA = a.querySelector(
      'input[type="radio"]:checked'
    ) as HTMLInputElement;
    const checkedB = b.querySelector(
      'input[type="radio"]:checked'
    ) as HTMLInputElement;
    expect(checkedA.value).toBe('alphafold');
    expect(checkedB.value).toBe('alphamissense');
  });

  it('exposes an accessible name on the radio group', async () => {
    const el = await mountStructure();
    const fieldset = el.querySelector('fieldset');
    expect(fieldset).not.toBeNull();
    const legend = fieldset!.querySelector('legend');
    expect(legend).not.toBeNull();
    expect(legend!.textContent?.trim()).toBe('Select color scale');
  });
});
