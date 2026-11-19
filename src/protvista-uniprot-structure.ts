import {
  LitElement,
  html,
  svg,
  type TemplateResult,
  type PropertyValues,
  css,
  nothing,
} from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import NightingaleStructure, {
  type AlphaFoldPayload,
} from '@nightingale-elements/nightingale-structure';
import ProtvistaUniprotDatatable, {
  type ColumnConfig,
} from './protvista-uniprot-datatable.js';
import { fetchAll, loadComponent } from './utils/index.js';
import { isSafeUrl } from './utils/security.js';
import downloadIcon from './icons/download.svg';
import externalLinkIcon from './icons/external-link.svg';

import loaderIcon from './icons/spinner.svg';
import { inlineSvg } from './icons/inline.js';
import loaderStyles from './styles/loader-styles.js';
import { injectStyleOnce, installTokenDefaults } from './styles/inject.js';
import { warnLostProperties } from './lost-properties.js';
import { mergeVariables, substituteTemplate } from './schema/variables.js';

/**
 * The URL templates the panel requests, by the property that overrides each
 * (`uniprot-url`, `alphafold-url`, `beacons-url`, `beacons-checksum-url`).
 * `{accession}` and `{checksum}` come from the element's attributes, and any
 * other `{token}` from its `data-*` attributes.
 */
const defaultUrls = {
  // We are showing PDBe models returned by UniProt's API as there is inconsistency between UniProt's recognised ones and 3d-beacons.
  uniprotUrl: 'https://rest.uniprot.org/uniprotkb/{accession}',
  // AlphaMissense predictions are only available in AF predictions endpoint
  alphafoldUrl:
    'https://alphafold.ebi.ac.uk/api/prediction/{accession}?include_complexes=true',
  // exclude_provider accepts only value hence 'pdbe' as majority of the models are from there if querying by accession
  beaconsUrl:
    'https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary/{accession}.json?exclude_provider=pdbe',
  beaconsChecksumUrl:
    'https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/v2/sequence/summary?id={checksum}&type=md5',
};

const alphaFoldLinkUrl = 'https://alphafold.ebi.ac.uk/search/text/';
const foldseekUrl = `https://search.foldseek.com/search`;
const uniprotKBUrl = 'https://www.uniprot.org/uniprotkb/';
const pdbUrls = [
  { name: 'PDBe', link: 'https://www.ebi.ac.uk/pdbe/entry/pdb/' },
  { name: 'RCSB-PDB', link: 'https://www.rcsb.org/structure/' },
  { name: 'PDBj', link: 'https://pdbj.org/mine/summary/' },
];

const sourceMethods = new Map([
  ['AlphaFold DB', 'Predicted'],
  ['SWISS-MODEL', 'Modeling'],
  ['ModelArchive', 'Modeling'],
  ['PED', 'Modeling'],
  ['SASBDB', 'SAS'],
  ['isoform.io', 'Predicted'],
  ['AlphaFill', 'Predicted'],
  ['HEGELAB', 'Modeling'],
  ['levylab', 'Modeling'],
  ['Bindome', 'Predicted'],
]);

// Excluded source from 3d-beacons is PDBe as we fetch them separately from UniProt
const providersFrom3DBeacons = [
  'SWISS-MODEL',
  'ModelArchive',
  'PED',
  'SASBDB',
  'isoform.io',
  'AlphaFill',
  'HEGELAB',
  'levylab',
  'Bindome',
];

type UniProtKBData = {
  uniProtKBCrossReferences: UniProtKBCrossReference[];
  sequence: Sequence;
};

type UniProtKBCrossReference = {
  database: string;
  id: string;
  properties: Record<string, string>[];
};

type Sequence = {
  value: string;
  length: number;
  molWeight: number;
  crc64: string;
  md5: string;
};

type BeaconsData = {
  uniprot_entry?: {
    ac: string;
    id: string;
    uniprot_checksum: string;
    sequence_length: number;
    segment_start: number;
    segment_end: number;
  };
  entry?: {
    sequence: string;
    checksum: string;
    checksum_type: string;
  };
  structures: {
    summary: {
      model_identifier: string;
      model_category: string;
      model_url: string;
      model_format: string;
      model_type: string | null;
      model_page_url: string;
      provider: string;
      number_of_conformers: number | null;
      ensemble_sample_url: string | null;
      ensemble_sample_format: string | null;
      created: string;
      sequence_identity: number;
      uniprot_start: number;
      uniprot_end: number;
      coverage: number;
      experimental_method: string | null;
      resolution: number | null;
      confidence_type: string;
      confidence_version: string | null;
      confidence_avg_local_score: number;
      oligomeric_state: string | null;
      preferred_assembly_id: string | null;
      entities: {
        entity_type: string;
        entity_poly_type: string;
        identifier: string;
        identifier_category: string;
        description: string;
        chain_ids: string[];
      }[];
    };
  }[];
};

export type ProcessedStructureData = {
  id: string;
  source: string;
  method?: string;
  resolution?: string;
  chain?: string;
  positions?: string;
  downloadUrl?: string;
  sourceDBLink?: string;
  protvistaFeatureId: string;
  amAnnotationsUrl?: string;
  isoformId?: string;
  isoformIsCanonical?: boolean;
  oligomericState?: string;
};

type IsoformIdSequence = Array<{
  isoformId: string;
  sequence: string;
}>;

const getIsoformNum = (s: string) => {
  const match = s.match(/-(\d+)-F1$/);
  return match ? Number(match[1]) : 0;
};

const processPDBData = (data: UniProtKBData): ProcessedStructureData[] =>
  data.uniProtKBCrossReferences
    ? data.uniProtKBCrossReferences
        .filter((xref) => xref.database === 'PDB')
        .sort((refA, refB) => refB.id.localeCompare(refA.id))
        .map(({ id, properties }) => {
          if (!properties) {
            return;
          }

          const propertyMap = properties.reduce(
            (acc, item) => {
              acc[item.key] = item.value;
              return acc;
            },
            {} as Record<string, string>
          );

          const method = propertyMap['Method'];
          const resolution = propertyMap['Resolution'];
          const chains = propertyMap['Chains'];

          let chain: string | undefined;
          let positions: string | undefined;
          if (chains) {
            const tokens = chains.split('=');
            if (tokens.length === 2) {
              [chain, positions] = tokens;
            }
          }

          const output: ProcessedStructureData = {
            id,
            source: 'PDB',
            method,
            resolution:
              !resolution || resolution === '-' ? undefined : resolution,
            downloadUrl: `https://www.ebi.ac.uk/pdbe/entry-files/download/${id.toLowerCase()}_updated.cif`,
            chain,
            positions,
            protvistaFeatureId: id,
          };
          return output;
        })
        .filter((x): x is ProcessedStructureData => x !== undefined)
    : [];

const processAFData = (
  data: AlphaFoldPayload,
  isoforms?: IsoformIdSequence,
  canonicalSequence?: string
): ProcessedStructureData[] => {
  const uniqueData = [
    ...new Map(data.map((d) => [d.modelEntityId, d])).values(),
  ];

  return uniqueData
    .map((d) => {
      const isoformMatch = isoforms?.find(
        ({ sequence }) => d.sequence === sequence
      );

      let chain = d.chainId;
      const oligomericState = d.isComplex
        ? `${d.assemblyType}${d.oligomericState}`
        : 'Monomer';

      if (d.isComplex && oligomericState === 'Homodimer') {
        chain = data
          .filter(({ modelEntityId }) => modelEntityId === d.modelEntityId)
          .flatMap(({ chainId }) => chainId)
          .sort()
          .join(', ');
      }
      return {
        id: d.modelEntityId,
        source: 'AlphaFold DB',
        positions: `${d.sequenceStart}-${d.sequenceEnd}`,
        protvistaFeatureId: d.modelEntityId,
        downloadUrl: d.cifUrl,
        amAnnotationsUrl: d.amAnnotationsUrl,
        isoformId: !d.isComplex ? isoformMatch?.isoformId : undefined,
        isoformIsCanonical:
          !d.isComplex && isoformMatch
            ? isoformMatch.sequence === canonicalSequence
            : undefined,
        afPrediction: true,
        oligomericState,
        chain,
        method: sourceMethods.get('AlphaFold DB') || undefined,
      };
    })
    .sort((a, b) => getIsoformNum(a.id) - getIsoformNum(b.id))
    .sort((a, b) => {
      const aMonomer = a.oligomericState === 'Monomer' ? 0 : 1;
      const bMonomer = b.oligomericState === 'Monomer' ? 0 : 1;
      return aMonomer - bMonomer;
    });
};

const process3DBeaconsData = (
  data: BeaconsData,
  accession: string | undefined,
  checksum: string | undefined
): ProcessedStructureData[] => {
  // If accession is provided without checksum, filter by whitelisted providers
  const filterByProviders = !!accession && !checksum;

  let structures = filterByProviders
    ? data?.structures?.filter(({ summary }) =>
        providersFrom3DBeacons.includes(summary.provider)
      )
    : data?.structures?.sort(
        (a, b) =>
          b.summary.confidence_avg_local_score -
          a.summary.confidence_avg_local_score
      );

  if (accession && checksum && structures) {
    const matchIndex = structures.findIndex(({ summary }) =>
      summary.model_identifier.includes(accession)
    );

    if (matchIndex !== -1) {
      structures = [
        structures[matchIndex],
        ...structures.slice(0, matchIndex),
        ...structures.slice(matchIndex + 1),
      ];
    }
  }

  return (
    structures?.map(({ summary }) => ({
      id: summary.model_identifier,
      source: summary.provider,
      positions:
        summary.uniprot_start && summary.uniprot_end
          ? `${summary.uniprot_start}-${summary.uniprot_end}`
          : undefined,
      protvistaFeatureId: summary.model_identifier,
      downloadUrl: summary.model_url,
      sourceDBLink:
        summary.provider === 'isoform.io'
          ? 'https://www.isoform.io/home'
          : summary.model_page_url,
      chain:
        summary.entities
          ?.flatMap((entity) =>
            entity.identifier_category === 'UNIPROT' ? entity.chain_ids : []
          )
          .join(', ') || undefined,
      oligomericState: summary.oligomeric_state || undefined,
      method: sourceMethods.get(summary.provider) || undefined,
    })) || []
  );
};

// The legend swatch colours mirror the AlphaFold pLDDT / AlphaMissense
// pathogenicity ramps used by the track rendering — they are data
// encodings, not themable UI, so they live as fixed values in classed
// rules (see `cssStyle`) rather than `--protvista-*` tokens. Classing
// them (instead of inline `style=`) keeps the template CSP-clean.
const AFMetaInfo = html`
  <strong>Model Confidence:</strong>
  <ul class="no-bullet">
    <li>
      <span class="af-legend af-legend--very-high"></span>
      Very high (pLDDT > 90)
    </li>
    <li>
      <span class="af-legend af-legend--confident"></span>
      Confident (90 > pLDDT > 70)
    </li>
    <li>
      <span class="af-legend af-legend--low"></span>
      Low (70 > pLDDT > 50)
    </li>
    <li>
      <span class="af-legend af-legend--very-low"></span>
      Very low (pLDDT < 50)
    </li>
  </ul>
  <p class="small">
    AlphaFold produces a per-residue confidence score (pLDDT) between 0 and 100.
    Some regions with low pLDDT may be unstructured in isolation.
  </p>
`;

const AMMetaInfo = html`
  <strong>Model Pathogenicity:</strong>
  <ul class="no-bullet">
    <li>
      <span class="af-legend af-legend--am-pathogenic"></span>
      Likely pathogenic (score > 0.564)
    </li>
    <li>
      <span class="af-legend af-legend--am-uncertain"></span>
      Uncertain (0.564 >= score >= 0.34)
    </li>
    <li>
      <span class="af-legend af-legend--am-benign"></span>
      Likely benign (score < 0.34)
    </li>
  </ul>
  <p class="small">
    The displayed colour for each residue is the average AlphaMissense
    pathogenicity score across all possible amino acid substitutions at that
    position.
  </p>
`;

// These links are rendered as datatable cell content, i.e. inside the
// datatable's shadow root — so their layout is styled by the datatable's
// own `.cell-link` utility classes (see protvista-uniprot-datatable.ts),
// not the structure component's global stylesheet, which cannot reach
// into the shadow tree. Classing (instead of inline `style=`) keeps the
// markup CSP-clean.
const sourceDownloadLink = (downloadUrl: string) =>
  html`<a
    href="${downloadUrl}"
    aria-label="Download source file"
    title="Download source file"
    class="cell-link"
  >
    Source
    <span class="cell-link__icon"
      >${svg`${unsafeHTML(inlineSvg(downloadIcon))}`}</span
    >
  </a>`;

const foldseekLink = (accession: string, sourceDB: string) => {
  const params = new URLSearchParams({ accession, source: sourceDB });
  return html`<a
    href="${foldseekUrl}?${params.toString()}"
    target="_blank"
    rel="noopener noreferrer"
    aria-label="Open Foldseek in a new tab"
    title="Open Foldseek in a new tab"
    class="cell-link"
  >
    Foldseek
    <span class="cell-link__icon cell-link__icon--sm"
      >${svg`${unsafeHTML(inlineSvg(externalLinkIcon))}`}</span
    >
  </a>`;
};

const styleId = 'protvista-styles';
let colorSchemeInstanceCounter = 0;

@customElement('protvista-uniprot-structure')
class ProtvistaUniprotStructure extends LitElement {
  accession?: string;
  sequence?: string;
  checksum?: string;
  data?: ProcessedStructureData[];
  structureId?: string;
  metaInfo?: TemplateResult;
  colorTheme?: string;
  isoforms?: IsoformIdSequence;
  private loading?: boolean;
  private alphamissenseAvailable?: boolean;
  private readonly colorSchemeGroupId = `protvista-color-scheme-${++colorSchemeInstanceCounter}`;

  @state()
  private modelUrl = '';

  private columns: ColumnConfig<ProcessedStructureData>[] = [];
  selectedId?: string;
  noTable?: boolean;
  uniprotUrl?: string;
  alphafoldUrl?: string;
  beaconsUrl?: string;
  beaconsChecksumUrl?: string;

  constructor() {
    super();
    loadComponent('nightingale-structure', NightingaleStructure);
    // Registered unconditionally (even when no-table is set) so the import is
    // preserved through tree-shaking; the element only renders when noTable is
    // false, so an unused registration is cheap.
    loadComponent('protvista-uniprot-datatable', ProtvistaUniprotDatatable);

    this.loading = true;
    this.addStyles();
    this.colorTheme = 'alphafold';
    this.alphamissenseAvailable = false;
  }

  static get properties() {
    return {
      accession: { type: String },
      structureId: { type: String },
      checksum: { type: String },
      sequence: { type: String },
      data: { type: Object },
      loading: { type: Boolean },
      colorTheme: { type: String, attribute: 'color-theme' },
      alphamissenseAvailable: { type: Boolean },
      isoforms: { type: Object, attribute: false },
      selectedId: { type: String, attribute: 'selected-id' },
      noTable: { type: Boolean, attribute: 'no-table' },
      uniprotUrl: { type: String, attribute: 'uniprot-url' },
      alphafoldUrl: { type: String, attribute: 'alphafold-url' },
      beaconsUrl: { type: String, attribute: 'beacons-url' },
      beaconsChecksumUrl: { type: String, attribute: 'beacons-checksum-url' },
    };
  }

  /**
   * The URL to request for `which`. With no override, the EBI default with
   * the accession or checksum put in as written, exactly as it always was.
   * An override has its `{tokens}` filled like any data URL's. Empty — no
   * request, as for the requests a checksum lookup doesn't make — when the
   * override is empty or a token has no usable value, which is reported
   * rather than requested half-built.
   */
  private requestUrl(which: keyof typeof defaultUrls): string {
    const override = this[which];
    if (override == null) {
      return defaultUrls[which].replace(
        /\{(accession|checksum)\}/g,
        (_, name: 'accession' | 'checksum') => String(this[name])
      );
    }
    const vars = mergeVariables({
      dataset: this.dataset,
      accession: this.accession,
    });
    if (this.checksum != null) vars.checksum = this.checksum;
    const result = substituteTemplate(override, vars);
    if ('url' in result) return result.url;
    const tokens = (
      'unresolved' in result ? result.unresolved : result.invalid
    ).map((t) => `{${t}}`);
    console.warn(
      `[protvista-uniprot-structure] Not fetching '${override}': ` +
        `${'unresolved' in result ? 'undefined' : 'invalid value for'} ` +
        `${tokens.join(', ')}.`
    );
    return '';
  }

  /**
   * The three URLs a load requests, in order: UniProtKB, AlphaFold DB and
   * 3D-Beacons by accession, or only 3D-Beacons by checksum. An empty one
   * is not requested.
   */
  private requestUrls(): [string, string, string] {
    const byAccession = !!this.accession && !this.checksum;
    return [
      byAccession ? this.requestUrl('uniprotUrl') : '',
      byAccession ? this.requestUrl('alphafoldUrl') : '',
      this.requestUrl(byAccession ? 'beaconsUrl' : 'beaconsChecksumUrl'),
    ];
  }

  private getColumns(): ColumnConfig<ProcessedStructureData>[] {
    const cols: ColumnConfig<ProcessedStructureData>[] = [
      {
        label: 'Source',
        key: 'source',
        filterable: true,
        render: (row) => html`<strong>${row.source}</strong>`,
      },
      { label: 'Identifier', key: 'id' },
    ];

    if (this.isoforms) {
      cols.push({
        label: 'Isoform',
        key: 'isoformId',
        render: (row) =>
          row.isoformId
            ? html`<a
                href="${uniprotKBUrl}${this.accession}/entry#${row.isoformId}"
              >
                ${row.isoformId}${row.isoformIsCanonical ? ' (Canonical)' : ''}
              </a>`
            : nothing,
      });
    }

    cols.push(
      { label: 'Method', key: 'method', filterable: true },
      {
        label: 'Resolution',
        key: 'resolution',
        render: (row) =>
          row.resolution ? row.resolution.replace('A', 'Å') : '',
      },
      { label: 'Chain', key: 'chain' },
      { label: 'Positions', key: 'positions' },
      {
        label: 'Links',
        key: 'sourceDBLink',
        render: (row) => this.renderLinksCell(row),
      },
      {
        label: '',
        key: 'downloadUrl',
        render: (row) => this.renderDownloadCell(row),
      }
    );

    return cols;
  }

  private renderLinksCell(row: ProcessedStructureData) {
    const { source, id, sourceDBLink } = row;

    return html`
      ${
        source === 'PDB'
          ? html`
              ${pdbUrls
                .map(
                  (pdbLink) =>
                    html`<a href="${pdbLink.link}${id}">${pdbLink.name}</a>`
                )
                .reduce((prev, curr) => html`${prev} · ${curr}`)}
            `
          : nothing
      }
      ${
        source === 'AlphaFold DB' && this.accession
          ? html`<a href="${alphaFoldLinkUrl}${this.accession}">AlphaFold</a>`
          : nothing
      }
      ${
        // A response's own link, from whatever server a URL override names:
        // only an http(s) one is rendered, never a `javascript:` one.
        isSafeUrl(sourceDBLink)
          ? html`<a href="${sourceDBLink}">${source}</a>`
          : nothing
      }
    `;
  }

  private renderDownloadCell(row: ProcessedStructureData) {
    const { downloadUrl, source, id } = row;

    return html`
      ${isSafeUrl(downloadUrl) ? html`${sourceDownloadLink(downloadUrl)}` : nothing}
      ${
        (source === 'PDB' || source === 'AlphaFold DB') && this.accession
          ? html` ·
            ${foldseekLink(
              source === 'PDB' ? id : this.accession,
              source === 'PDB' ? 'PDB' : 'AlphaFoldDB'
            )}`
          : nothing
      }
    `;
  }

  async connectedCallback() {
    super.connectedCallback();
    warnLostProperties(this, { data: 'data' });
    await this.load();
  }

  /**
   * Load again when a URL override is set or changed after the first load
   * (the viewer hands on new ones when a `data-*` value they use changes).
   * The first update, which carries the attributes the element was created
   * with, finds the URLs `connectedCallback` already asked for and does
   * nothing.
   */
  private reloadIfUrlsChanged(changed: PropertyValues) {
    if (
      this.requestedUrls !== undefined &&
      (changed.has('uniprotUrl') ||
        changed.has('alphafoldUrl') ||
        changed.has('beaconsUrl') ||
        changed.has('beaconsChecksumUrl')) &&
      this.requestUrls().join('\n') !== this.requestedUrls
    ) {
      this.load();
    }
  }

  /** The URLs the latest `load()` asked for, joined for comparison. */
  private requestedUrls?: string;

  /** Bumped per `load()`; an older load's responses are dropped. */
  private loadGeneration = 0;

  private async load() {
    if (!this.accession && !this.checksum) return;
    const reload = this.requestedUrls !== undefined;
    const generation = ++this.loadGeneration;
    const urls = this.requestUrls();
    this.requestedUrls = urls.join('\n');
    const [pdbUrl, alphaFoldUrl, beaconsUrl] = urls;
    if (reload) this.loading = true;

    // An empty URL is skipped, not fetched: `fetch('')` would request the
    // host page itself.
    const rawData = await fetchAll(urls.filter((url) => url !== ''));
    if (generation !== this.loadGeneration) return;
    this.loading = false;

    const pdbData = processPDBData(rawData[pdbUrl] || []);
    let afData: ProcessedStructureData[] = [];

    if (this.isoforms && rawData[alphaFoldUrl]?.length) {
      // Include isoforms that are provided in the UniProt isoforms mapping and ignore the rest from AF payload that are out of sync with UniProt
      const alphaFoldSequenceMatches = rawData[alphaFoldUrl]?.filter(
        ({ sequence: afSequence }: { sequence: string }) =>
          this.isoforms?.some(({ sequence }) => afSequence === sequence)
      );

      afData = processAFData(
        alphaFoldSequenceMatches,
        this.isoforms,
        rawData[pdbUrl]?.sequence?.value
      );

      this.alphamissenseAvailable = !!afData?.[0]?.amAnnotationsUrl;
    } else {
      // Check if AF sequence matches UniProt sequence
      const alphaFoldSequenceMatch = rawData[alphaFoldUrl]?.filter(
        ({ sequence: afSequence }: { sequence: string }) =>
          rawData[pdbUrl]?.sequence?.value === afSequence ||
          this.sequence === afSequence
      );
      if (alphaFoldSequenceMatch?.length) {
        afData = processAFData(alphaFoldSequenceMatch);
        this.alphamissenseAvailable = alphaFoldSequenceMatch.some(
          (data: { amAnnotationsUrl?: string }) => data.amAnnotationsUrl
        );
      }
    }

    const beaconsData = process3DBeaconsData(
      rawData[beaconsUrl] || [],
      this.accession,
      this.checksum
    );

    // TODO: return if no data at all
    // if (!payload) return;

    const data = [...pdbData, ...afData, ...beaconsData];

    this.data = data;
    this.columns = this.getColumns();

    // Default to the first row only if the consumer hasn't pre-set a
    // selection. A reload replaces the rows, so a selection it no longer
    // has moves to the first row too.
    if (
      data.length > 0 &&
      (!this.selectedId ||
        (reload && !data.some(({ id }) => id === this.selectedId)))
    ) {
      this.selectedId = data[0].id;
    }

    this.dispatchEvent(
      new CustomEvent<ReadonlyArray<ProcessedStructureData>>(
        'structures-loaded',
        {
          detail: data,
          bubbles: true,
          composed: true,
        }
      )
    );
  }

  addStyles() {
    // We are not using static get styles() as we are not using the shadowDOM because of Mol*.
    // Shared, keyed, install-once stylesheets (see src/styles/inject.ts):
    // the token defaults and loader styles are shared with
    // <protvista-uniprot>. These are never removed on disconnect — the
    // shared nodes back every instance, so tearing one down would strip
    // styling from any other viewer still on the page.
    installTokenDefaults();
    injectStyleOnce('loader', loaderStyles.toString());
    injectStyleOnce(styleId, ProtvistaUniprotStructure.cssStyle.toString());
  }

  protected override willUpdate(changed: PropertyValues) {
    this.reloadIfUrlsChanged(changed);
    // Apply when either selection or data changes — covers consumer
    // pre-setting selected-id before the async fetch resolves.
    if (changed.has('selectedId') || changed.has('data')) {
      this.updateSelection();
    }
    this.syncAlphaFoldLegend();
  }

  private updateSelection() {
    // Wait for the first data assignment before deciding what to show; a
    // consumer-set selectedId arriving before fetch should not clear anything.
    if (!this.data) return;

    const row = this.selectedId
      ? this.data.find((r) => r.id === this.selectedId)
      : undefined;
    if (row) {
      this.applySelection(row);
    } else {
      // No match (empty data, stale selectedId, or selection cleared) — drop
      // the viewer state so a previous structure does not linger on screen.
      this.clearViewer();
    }
  }

  // The colour scale actually shown. Pathogenicity needs the selected model's
  // AlphaMissense annotations; without them the panel shows confidence, so the
  // viewer, the radios and the legend agree. `colorTheme` keeps the requested
  // value, so it applies again once an annotated model is selected.
  private get displayedColorTheme(): string {
    return this.colorTheme === 'alphamissense' && this.alphamissenseAvailable
      ? 'alphamissense'
      : 'alphafold';
  }

  // The AlphaFold legend follows the colour scale however it was set: a radio
  // click, or the `color-theme` attribute or property, before or after load.
  private syncAlphaFoldLegend() {
    if (this.metaInfo !== AFMetaInfo && this.metaInfo !== AMMetaInfo) return;
    this.metaInfo =
      this.displayedColorTheme === 'alphamissense' ? AMMetaInfo : AFMetaInfo;
  }

  private clearViewer() {
    // No-op when nothing was ever applied — avoids handing Mol* an undefined
    // ref on the initial-load empty-data path.
    if (!this.structureId && !this.modelUrl) return;
    this.structureId = undefined;
    this.modelUrl = '';
    this.metaInfo = undefined;
  }

  private applySelection(row: ProcessedStructureData) {
    const { id, source, downloadUrl, amAnnotationsUrl, oligomericState } = row;

    if (
      this.checksum ||
      providersFrom3DBeacons.includes(source) ||
      (source === 'AlphaFold DB' && oligomericState !== 'Monomer')
    ) {
      this.modelUrl = downloadUrl ?? '';
      // Reset the rest
      this.structureId = undefined;
      this.metaInfo = undefined;
      this.colorTheme = 'alphafold';
      if (source === 'AlphaFold DB') {
        this.metaInfo = AFMetaInfo;
        // The model-url viewer has no AlphaMissense colouring, so pathogenicity
        // is unavailable here even when the row has annotations.
        this.alphamissenseAvailable = false;
      }
    } else {
      this.structureId = id;
      this.modelUrl = '';
      if (this.structureId.startsWith('AF-')) {
        this.metaInfo = AFMetaInfo;
        this.alphamissenseAvailable = !!amAnnotationsUrl;
      } else {
        this.metaInfo = undefined;
      }
    }
  }

  private onDatatableRowClick = (e: CustomEvent<ProcessedStructureData>) => {
    this.selectedId = e.detail.id;
  };

  // Built once at class definition rather than per instance: addStyles()
  // runs in every constructor but the sheet is injected only once.
  private static readonly cssStyle = css`
    .protvista-uniprot-structure {
      line-height: normal;
    }

    .theme-selection {
      border: 0;
      margin: 0;
      min-width: 0;
      padding: 0 0 1rem;
    }

    .protvista-uniprot-structure__structure {
      display: flex;
    }

    .protvista-uniprot-structure__meta {
      flex: 1;
      padding: 1rem;
    }

    .protvista-uniprot-structure__structure nightingale-structure {
      z-index: 40000;
      width: 100%;
      flex: 4;
    }

    .protvista-uniprot-structure__meta .small {
      font-size: 0.75rem;
    }

    .protvista-uniprot-structure__meta .no-bullet {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .protvista-uniprot-structure__meta .no-bullet li {
      padding: 0;
      margin: 0.5rem 0;
    }

    .protvista-uniprot-structure__meta .af-legend::before {
      content: '';
      margin: 0;
      display: inline-block;
      width: 20px;
      height: 16px;
    }

    /* Legend swatch colours: fixed data encodings mirroring the
         AlphaFold pLDDT / AlphaMissense pathogenicity ramps (not themable
         UI). Classed here rather than set via inline style= on the span. */
    .protvista-uniprot-structure__meta .af-legend--very-high {
      background-color: rgb(0, 83, 214);
    }
    .protvista-uniprot-structure__meta .af-legend--confident {
      background-color: rgb(101, 203, 243);
    }
    .protvista-uniprot-structure__meta .af-legend--low {
      background-color: rgb(255, 219, 19);
    }
    .protvista-uniprot-structure__meta .af-legend--very-low {
      background-color: rgb(255, 125, 69);
    }
    .protvista-uniprot-structure__meta .af-legend--am-pathogenic {
      background-color: rgb(154, 19, 26);
    }
    .protvista-uniprot-structure__meta .af-legend--am-uncertain {
      background-color: rgb(168, 169, 173);
    }
    .protvista-uniprot-structure__meta .af-legend--am-benign {
      background-color: rgb(61, 84, 147);
    }

    .am-disabled * {
      cursor: not-allowed;
      color: var(--protvista-color-disabled);
    }
  `;

  /**
   * we need to use the light DOM.
   * */
  createRenderRoot() {
    return this;
  }

  toggleColorTheme(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    this.colorTheme = input.value;
  }

  render() {
    const alphafoldRadioId = `${this.colorSchemeGroupId}-alphafold`;
    const alphamissenseRadioId = `${this.colorSchemeGroupId}-alphamissense`;

    return html`
      <div class="protvista-uniprot-structure">
        <div class="protvista-uniprot-structure__structure">
          ${
            this.metaInfo
              ? html`
                  <div class="protvista-uniprot-structure__meta">
                    <fieldset class="theme-selection">
                      <legend>Select color scale</legend>
                      <div>
                        <input
                          type="radio"
                          id=${alphafoldRadioId}
                          name=${this.colorSchemeGroupId}
                          value="alphafold"
                          @click=${this.toggleColorTheme}
                          .checked=${this.displayedColorTheme !== 'alphamissense'}
                        />
                        <label for=${alphafoldRadioId}>Confidence</label>
                      </div>
                      <div
                        class=${this.alphamissenseAvailable ? '' : 'am-disabled'}
                      >
                        <input
                          type="radio"
                          id=${alphamissenseRadioId}
                          name=${this.colorSchemeGroupId}
                          value="alphamissense"
                          @click=${this.toggleColorTheme}
                          .checked=${this.displayedColorTheme === 'alphamissense'}
                          ?disabled=${!this.alphamissenseAvailable}
                        />
                        <label
                          for=${alphamissenseRadioId}
                          title=${
                            this.alphamissenseAvailable
                              ? ''
                              : 'Color by pathogenicity is disabled as there are no AlphaMissense predictions available for this model'
                          }
                        >
                          Pathogenicity
                          ${this.alphamissenseAvailable ? '' : ' (unavailable)'}
                        </label>
                      </div>
                    </fieldset>
                    ${this.metaInfo}
                  </div>
                `
              : nothing
          }
          ${
            this.structureId
              ? html`<nightingale-structure
                  structure-id=${this.structureId}
                  protein-accession=${this.accession}
                  color-theme=${this.displayedColorTheme}
                ></nightingale-structure>`
              : nothing
          }
          ${
            this.modelUrl
              ? html`<nightingale-structure
                  model-url=${this.modelUrl}
                ></nightingale-structure>`
              : nothing
          }
        </div>

        ${
          this.noTable
            ? nothing
            : html`<div class="protvista-uniprot-structure__table">
                ${
                  this.data && this.data.length
                    ? html`
                        <protvista-uniprot-datatable
                          .data=${this.data}
                          .columns=${this.columns}
                          .selectedId=${this.selectedId}
                          row-id-key="id"
                          @row-click=${this.onDatatableRowClick}
                        ></protvista-uniprot-datatable>
                      `
                    : nothing
                }
                ${
                  this.loading
                    ? html`<div class="protvista-loader">
                        ${svg`${unsafeHTML(inlineSvg(loaderIcon))}`}
                      </div>`
                    : nothing
                }
                ${
                  (!this.data || this.data.length === 0) && !this.loading
                    ? html`<div class="protvista-no-results">
                        No structure information available
                        ${this.accession ? `for ${this.accession}` : ''}
                      </div>`
                    : nothing
                }
              </div>`
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protvista-uniprot-structure': ProtvistaUniprotStructure;
  }
}

export default ProtvistaUniprotStructure;
