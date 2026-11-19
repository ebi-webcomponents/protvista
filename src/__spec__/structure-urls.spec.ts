/**
 * The requests the real `<protvista-uniprot-structure>` makes: UniProtKB,
 * AlphaFold DB and 3D-Beacons by accession, or 3D-Beacons by checksum. Each
 * keeps its EBI default unless its attribute (`uniprot-url`,
 * `alphafold-url`, `beacons-url`, `beacons-checksum-url`) names another URL
 * template.
 *
 * `nightingale-mocks.ts` stubs this module for every other spec, so this one
 * unmocks it, as `structure-color-theme.spec.ts` does.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'lit';

vi.unmock('../protvista-uniprot-structure');
vi.mock('@nightingale-elements/nightingale-structure', () => ({
  default: class extends HTMLElement {},
  amColorScale: () => '#000000',
}));
vi.mock('../icons/download.svg', () => ({ default: '' }));
vi.mock('../icons/external-link.svg', () => ({ default: '' }));
vi.mock('../icons/spinner.svg', () => ({ default: '' }));

const DEFAULTS = {
  uniprot: 'https://rest.uniprot.org/uniprotkb/P05067',
  alphafold:
    'https://alphafold.ebi.ac.uk/api/prediction/P05067?include_complexes=true',
  beacons:
    'https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary/P05067.json?exclude_provider=pdbe',
  beaconsChecksum:
    'https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/v2/sequence/summary?id=0123abcd&type=md5',
};

const appended: HTMLElement[] = [];
afterEach(() => {
  appended.splice(0).forEach((el) => el.remove());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type StructureEl = HTMLElement & {
  data?: Array<Record<string, unknown>>;
  columns: Array<{ render?: (row: unknown) => unknown }>;
  updateComplete: Promise<boolean>;
};

/**
 * Mount with `attributes`, answering each request with `respond`, and
 * return the element and its fetch mock once the first load has landed.
 */
async function mount(
  attributes: Record<string, string>,
  respond: (url: string) => Response = () =>
    // By default every request 404s, so the element has nothing to process.
    ({ ok: false, status: 404 }) as Response
) {
  const fetchFn = vi.fn<(url: string) => Promise<Response>>(async (url) =>
    respond(String(url))
  );
  vi.stubGlobal('fetch', fetchFn);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await import('../protvista-uniprot-structure');
  const el = document.createElement(
    'protvista-uniprot-structure'
  ) as unknown as StructureEl;
  for (const [name, value] of Object.entries(attributes)) {
    el.setAttribute(name, value);
  }
  document.body.append(el);
  appended.push(el);
  await vi.waitFor(() => {
    if (el.data === undefined) throw new Error('not loaded yet');
  });
  return { el, fetchFn };
}

/**
 * Every URL fetch was called with, as written: a URL a lookup skips must
 * not appear at all, since `fetch('')` requests the host page itself.
 */
const urlsOf = (fetchFn: ReturnType<typeof vi.fn>) =>
  fetchFn.mock.calls.map(([url]) => String(url));

/** Mount with `attributes` and return every URL the element requested. */
async function requested(attributes: Record<string, string>) {
  return urlsOf((await mount(attributes)).fetchFn);
}

describe('<protvista-uniprot-structure> request URLs', () => {
  it('requests the EBI defaults by accession', async () => {
    expect(await requested({ accession: 'P05067' })).toEqual([
      DEFAULTS.uniprot,
      DEFAULTS.alphafold,
      DEFAULTS.beacons,
    ]);
  });

  it('requests the 3D-Beacons default by checksum', async () => {
    expect(await requested({ checksum: '0123abcd' })).toEqual([
      DEFAULTS.beaconsChecksum,
    ]);
  });

  it('requests each override in place of its default', async () => {
    expect(
      await requested({
        accession: 'P05067',
        'uniprot-url': 'https://mirror.example.org/uniprotkb/{accession}',
        'alphafold-url': 'https://mirror.example.org/alphafold/{accession}',
        'beacons-url': 'https://mirror.example.org/beacons/{accession}',
      })
    ).toEqual([
      'https://mirror.example.org/uniprotkb/P05067',
      'https://mirror.example.org/alphafold/P05067',
      'https://mirror.example.org/beacons/P05067',
    ]);
  });

  it('requests the checksum override in place of its default', async () => {
    expect(
      await requested({
        checksum: '0123abcd',
        'beacons-checksum-url': 'https://mirror.example.org/md5/{checksum}',
      })
    ).toEqual(['https://mirror.example.org/md5/0123abcd']);
  });

  it('fills other tokens from data-* attributes', async () => {
    expect(
      await requested({
        accession: 'P05067',
        'data-release': '2026_01',
        'beacons-url': 'https://mirror.example.org/{release}/{accession}',
      })
    ).toContain('https://mirror.example.org/2026_01/P05067');
  });

  it('warns and skips a URL whose token has no value', async () => {
    const urls = await requested({
      accession: 'P05067',
      'alphafold-url': 'https://mirror.example.org/{species}/{accession}',
    });
    expect(urls).toEqual([DEFAULTS.uniprot, DEFAULTS.beacons]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('undefined {species}')
    );
  });

  it('warns and skips a URL whose token value is refused', async () => {
    const urls = await requested({
      accession: 'P05067',
      'data-release': '..',
      'beacons-url': 'https://mirror.example.org/{release}/{accession}',
    });
    expect(urls).toEqual([DEFAULTS.uniprot, DEFAULTS.alphafold]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('invalid value for {release}')
    );
  });

  it('requests nothing for an empty override', async () => {
    expect(await requested({ accession: 'P05067', 'uniprot-url': '' })).toEqual(
      [DEFAULTS.alphafold, DEFAULTS.beacons]
    );
  });

  it('keeps an accession outside the token pattern in the defaults', async () => {
    // A versioned accession was put into the EBI URLs as written, and still
    // is: only an override's `{accession}` is held to ACCESSION_PATTERN.
    expect(await requested({ accession: 'P05067.3' })).toEqual([
      'https://rest.uniprot.org/uniprotkb/P05067.3',
      'https://alphafold.ebi.ac.uk/api/prediction/P05067.3?include_complexes=true',
      'https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary/P05067.3.json?exclude_provider=pdbe',
    ]);
  });

  it('requests a URL override set after the first load', async () => {
    const { el, fetchFn } = await mount({ accession: 'P05067' });
    el.setAttribute('beacons-url', 'https://mirror.example.org/{accession}');
    await vi.waitFor(() => {
      if (!urlsOf(fetchFn).includes('https://mirror.example.org/P05067')) {
        throw new Error('not requested yet');
      }
    });
    // Only the URL that changed is new; the panel asks for all three again.
    expect(urlsOf(fetchFn).slice(3)).toEqual([
      DEFAULTS.uniprot,
      DEFAULTS.alphafold,
      'https://mirror.example.org/P05067',
    ]);
  });
});

/**
 * Every href in the rows' cells, each column's cell template rendered as
 * the datatable renders it.
 */
function renderedHrefs(el: StructureEl): string[] {
  const host = document.createElement('div');
  for (const row of el.data ?? []) {
    for (const col of el.columns) {
      if (!col.render) continue;
      const cell = document.createElement('div');
      render(col.render(row), cell);
      host.append(cell);
    }
  }
  return [...host.querySelectorAll('a')].map(
    (a) => a.getAttribute('href') ?? ''
  );
}

describe('<protvista-uniprot-structure> links from a response', () => {
  it('never renders a javascript: href from an overridden server', async () => {
    const { el } = await mount(
      {
        accession: 'P05067',
        'beacons-url': 'https://untrusted.example.org/{accession}.json',
      },
      (url) =>
        (url === 'https://untrusted.example.org/P05067.json'
          ? {
              ok: true,
              status: 200,
              json: async () => ({
                structures: [
                  {
                    summary: {
                      model_identifier: 'SM-P05067-1',
                      provider: 'SWISS-MODEL',
                      model_url: 'javascript:alert(document.cookie)',
                      model_page_url: 'javascript:alert(document.domain)',
                      uniprot_start: 1,
                      uniprot_end: 100,
                      entities: [],
                    },
                  },
                ],
              }),
            }
          : { ok: false, status: 404 }) as Response
    );
    expect(el.data).toHaveLength(1);
    const hrefs = renderedHrefs(el);
    expect(hrefs.filter((h) => /^\s*javascript:/i.test(h))).toEqual([]);
  });

  it('renders an https link from the same response', async () => {
    const { el } = await mount(
      {
        accession: 'P05067',
        'beacons-url': 'https://mirror.example.org/{accession}.json',
      },
      (url) =>
        (url === 'https://mirror.example.org/P05067.json'
          ? {
              ok: true,
              status: 200,
              json: async () => ({
                structures: [
                  {
                    summary: {
                      model_identifier: 'SM-P05067-1',
                      provider: 'SWISS-MODEL',
                      model_url: 'https://models.example.org/m.cif?a=1&b=2',
                      model_page_url: 'https://models.example.org/page',
                      entities: [],
                    },
                  },
                ],
              }),
            }
          : { ok: false, status: 404 }) as Response
    );
    const hrefs = renderedHrefs(el);
    expect(hrefs).toContain('https://models.example.org/page');
    expect(hrefs).toContain('https://models.example.org/m.cif?a=1&b=2');
  });
});
