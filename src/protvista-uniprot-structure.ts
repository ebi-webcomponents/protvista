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
} from './protvista-uniprot-datatable';
import { fetchAll, loadComponent } from './utils';
import downloadIcon from './icons/download.svg';
import externalLinkIcon from './icons/external-link.svg';

import loaderIcon from './icons/spinner.svg';
import loaderStyles from './styles/loader-styles';

const PDBLinks = [
  { name: 'PDBe', link: 'https://www.ebi.ac.uk/pdbe-srv/view/entry/' },
  { name: 'RCSB-PDB', link: 'https://www.rcsb.org/structure/' },
  { name: 'PDBj', link: 'https://pdbj.org/mine/summary/' },
];
const alphaFoldLinkUrl = 'https://alphafold.ebi.ac.uk/search/text/';
const foldseekUrl = `https://search.foldseek.com/search`;
const uniprotKBUrl = 'https://www.uniprot.org/uniprotkb/';

// Excluded source from 3d-beacons is PDBe as we fetch them separately from UniProt
const providersFrom3DBeacons = [
  'AlphaFold DB',
  'SWISS-MODEL',
  'ModelArchive',
  'PED',
  'SASBDB',
  'isoform.io',
  'AlphaFill',
  'HEGELAB',
  'levylab',
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
  afPrediction?: boolean; // Flag to differentiate the structure source as AlphaFold prediction API vs 3DBeacons AlphaFold
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
        .sort((refA, refB) => refA.id.localeCompare(refB.id))
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
): ProcessedStructureData[] =>
  data
    .map((d) => {
      const isoformMatch = isoforms?.find(
        ({ sequence }) => d.sequence === sequence
      );

      return {
        id: d.modelEntityId,
        source: 'AlphaFold DB',
        method: 'Predicted',
        positions: `${d.sequenceStart}-${d.sequenceEnd}`,
        protvistaFeatureId: d.modelEntityId,
        downloadUrl: d.pdbUrl,
        amAnnotationsUrl: d.amAnnotationsUrl,
        isoformId: isoformMatch?.isoformId,
        isoformIsCanonical: isoformMatch
          ? isoformMatch.sequence === canonicalSequence
          : undefined,
        afPrediction: true,
        oligomericState: 'MONOMER',
      };
    })
    .sort((a, b) => getIsoformNum(a.id) - getIsoformNum(b.id));

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
        summary.entities?.flatMap((entity) => entity.chain_ids).join(', ') ||
        undefined,
      oligomericState: summary.oligomeric_state || undefined,
    })) || []
  );
};

const AFMetaInfo = html`
  <strong>Model Confidence:</strong>
  <ul class="no-bullet">
    <li>
      <span class="af-legend" style="background-color: rgb(0, 83, 214)"></span>
      Very high (pLDDT > 90)
    </li>
    <li>
      <span
        class="af-legend"
        style="background-color: rgb(101, 203, 243)"
      ></span>
      Confident (90 > pLDDT > 70)
    </li>
    <li>
      <span class="af-legend" style="background-color:rgb(255, 219, 19)"></span>
      Low (70 > pLDDT > 50)
    </li>
    <li>
      <span class="af-legend" style="background-color:rgb(255, 125, 69)"></span>
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
      <span class="af-legend" style="background-color: rgb(154, 19, 26)"></span>
      Likely pathogenic (score > 0.564)
    </li>
    <li>
      <span
        class="af-legend"
        style="background-color: rgb(168, 169, 173)"
      ></span>
      Uncertain (0.564 >= score >= 0.34)
    </li>
    <li>
      <span class="af-legend" style="background-color: rgb(61, 84, 147)"></span>
      Likely benign (score < 0.34)
    </li>
  </ul>
  <p class="small">
    The displayed colour for each residue is the average AlphaMissense
    pathogenicity score across all possible amino acid substitutions at that
    position.
  </p>
`;

const sourceDownloadLink = (downloadUrl: string) =>
  html`<a
    href="${downloadUrl}"
    aria-label="Download source file"
    title="Download source file"
    style="text-decoration: none; display: inline-flex; align-items: center; gap: 4px;"
  >
    Source
    <span style="display: inline-flex; width: 0.9em; height: 0.9em;">
      ${svg`${unsafeHTML(downloadIcon)}`}
    </span>
  </a>`;

const foldseekLink = (accession: string, sourceDB: string) => {
  const params = new URLSearchParams({ accession, source: sourceDB });
  return html`<a
    href="${foldseekUrl}?${params.toString()}"
    target="_blank"
    rel="noopener noreferrer"
    aria-label="Open Foldseek in a new tab"
    title="Open Foldseek in a new tab"
    style="text-decoration: none; display: inline-flex; align-items: center; gap: 4px;"
  >
    Foldseek
    <span style="display: inline-flex; width: 0.8em; height: 0.8em;">
      ${svg`${unsafeHTML(externalLinkIcon)}`}
    </span>
  </a>`;
};

const styleId = 'protvista-styles';

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

  @state()
  private modelUrl = '';

  private columns: ColumnConfig<ProcessedStructureData>[] = [];
  selectedId?: string;
  noTable?: boolean;

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
      colorTheme: { type: String },
      alphamissenseAvailable: { type: Boolean },
      isoforms: { type: Object, attribute: false },
      selectedId: { type: String, attribute: 'selected-id' },
      noTable: { type: Boolean, attribute: 'no-table' },
    };
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
      ${source === 'PDB'
        ? html`
            ${PDBLinks.map(
              (pdbLink) =>
                html`<a href="${pdbLink.link}${id}">${pdbLink.name}</a>`
            ).reduce((prev, curr) => html`${prev} · ${curr}`)}
          `
        : nothing}
      ${source === 'AlphaFold DB' && this.accession
        ? html`<a href="${alphaFoldLinkUrl}${this.accession}">AlphaFold</a>`
        : nothing}
      ${sourceDBLink ? html`<a href="${sourceDBLink}">${source}</a>` : nothing}
    `;
  }

  private renderDownloadCell(row: ProcessedStructureData) {
    const { downloadUrl, source, id } = row;

    return html`
      ${downloadUrl ? html`${sourceDownloadLink(downloadUrl)}` : nothing}
      ${(source === 'PDB' || source === 'AlphaFold DB') && this.accession
        ? html` ·
          ${foldseekLink(
            source === 'PDB' ? id : this.accession,
            source === 'PDB' ? 'PDB' : 'AlphaFoldDB'
          )}`
        : nothing}
    `;
  }

  async connectedCallback() {
    super.connectedCallback();
    if (!this.accession && !this.checksum) return;
    // We are showing PDBe models returned by UniProt's API as there is inconsistency between UniProt's recognised ones and 3d-beacons.
    const pdbUrl =
      this.accession && !this.checksum
        ? `https://rest.uniprot.org/uniprotkb/${this.accession}`
        : '';
    // AlphaMissense predictions are only available in AF predictions endpoint
    const alphaFoldUrl =
      this.accession && !this.checksum
        ? `https://alphafold.ebi.ac.uk/api/prediction/${this.accession}`
        : '';
    // exclude_provider accepts only value hence 'pdbe' as majority of the models are from there if querying by accession
    const beaconsUrl =
      this.accession && !this.checksum
        ? `https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary/${this.accession}.json?exclude_provider=pdbe`
        : `https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/v2/sequence/summary?id=${this.checksum}&type=md5`;

    const rawData = await fetchAll([pdbUrl, alphaFoldUrl, beaconsUrl]);
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

    const beaconsAFData = beaconsData.filter(
      ({ source }) => source === 'AlphaFold DB'
    );
    const beaconsNonAFData = beaconsData.filter(
      ({ source }) => source !== 'AlphaFold DB'
    );

    const uniqueAFData = [
      ...new Map(
        // The order of the spread is important as we want to prioritise AF data from AF predictions API over 3DBeacons
        [...beaconsAFData, ...afData].map((obj) => [obj.id, obj])
      ).values(),
    ];

    const data = [...pdbData, ...uniqueAFData, ...beaconsNonAFData];

    this.data = data;
    this.columns = this.getColumns();

    // Default to the first row only if the consumer hasn't pre-set a selection.
    if (data.length > 0 && !this.selectedId) {
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

  disconnectedCallback() {
    this.removeStyles();
  }

  addStyles() {
    // We are not using static get styles() as we are not using the shadowDOM because of Mol*
    if (!document.getElementById(styleId)) {
      const styleTag = document.createElement('style');
      styleTag.id = styleId;
      styleTag.textContent = `
      ${loaderStyles.toString()}
      ${this.cssStyle}
      `;
      document.querySelector('head')?.append(styleTag);
    }
  }

  removeStyles() {
    document.getElementById(styleId)?.remove();
  }

  protected override willUpdate(changed: PropertyValues) {
    // Apply when either selection or data changes — covers consumer
    // pre-setting selected-id before the async fetch resolves.
    if (!changed.has('selectedId') && !changed.has('data')) return;
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

  private clearViewer() {
    // No-op when nothing was ever applied — avoids handing Mol* an undefined
    // ref on the initial-load empty-data path.
    if (!this.structureId && !this.modelUrl) return;
    this.structureId = undefined;
    this.modelUrl = '';
    this.metaInfo = undefined;
  }

  private applySelection(row: ProcessedStructureData) {
    const { id, source, downloadUrl, amAnnotationsUrl, afPrediction } = row;

    if (
      this.checksum ||
      (providersFrom3DBeacons.includes(source) && !afPrediction)
    ) {
      this.modelUrl = downloadUrl ?? '';
      // Reset the rest
      this.structureId = undefined;
      this.metaInfo = undefined;
      this.colorTheme = 'alphafold';
      if (source === 'AlphaFold DB') {
        this.metaInfo = AFMetaInfo;
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

  get cssStyle() {
    return css`
      .protvista-uniprot-structure {
        line-height: normal;
      }

      .theme-selection {
        padding-bottom: 1rem;
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

      .am-disabled * {
        cursor: not-allowed;
        color: #808080;
      }
    `;
  }

  /**
   * we need to use the light DOM.
   * */
  createRenderRoot() {
    return this;
  }

  toggleColorTheme(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    this.colorTheme = input.value;
    this.metaInfo = input.value === 'alphafold' ? AFMetaInfo : AMMetaInfo;
  }

  render() {
    return html`
      <div class="protvista-uniprot-structure">
        <div class="protvista-uniprot-structure__structure">
          ${this.metaInfo
            ? html`
                <div class="protvista-uniprot-structure__meta">
                  <div class="theme-selection">
                    Select color scale
                    <div>
                      <input
                        type="radio"
                        id="alphafold"
                        name="colorScheme"
                        value="alphafold"
                        @click=${this.toggleColorTheme}
                        checked
                      />
                      <label for="alphafold">Confidence</label>
                    </div>
                    <div
                      class=${this.alphamissenseAvailable ? '' : 'am-disabled'}
                    >
                      <input
                        type="radio"
                        id="alphamissense"
                        name="colorScheme"
                        value="alphamissense"
                        @click=${this.toggleColorTheme}
                        ?disabled=${!this.alphamissenseAvailable}
                      />
                      <label
                        for="alphamissense"
                        title=${this.alphamissenseAvailable
                          ? ''
                          : 'Color by pathogenicity is disabled as there are no AlphaMissense predictions available for this model'}
                      >
                        Pathogenicity
                        ${this.alphamissenseAvailable ? '' : ' (unavailable)'}
                      </label>
                    </div>
                  </div>
                  ${this.metaInfo}
                </div>
              `
            : nothing}
          ${this.structureId
            ? html`<nightingale-structure
                structure-id=${this.structureId}
                protein-accession=${this.accession}
                color-theme=${this.colorTheme}
              ></nightingale-structure>`
            : nothing}
          ${this.modelUrl
            ? html`<nightingale-structure
                model-url=${this.modelUrl}
              ></nightingale-structure>`
            : nothing}
        </div>

        ${this.noTable
          ? nothing
          : html`<div class="protvista-uniprot-structure__table">
              ${this.data && this.data.length
                ? html`
                    <protvista-uniprot-datatable
                      .data=${this.data}
                      .columns=${this.columns}
                      .selectedId=${this.selectedId}
                      row-id-key="id"
                      @row-click=${this.onDatatableRowClick}
                    ></protvista-uniprot-datatable>
                  `
                : nothing}
              ${this.loading
                ? html`<div class="protvista-loader">
                    ${svg`${unsafeHTML(loaderIcon)}`}
                  </div>`
                : nothing}
              ${(!this.data || this.data.length === 0) && !this.loading
                ? html`<div class="protvista-no-results">
                    No structure information available
                    ${this.accession ? `for ${this.accession}` : ''}
                  </div>`
                : nothing}
            </div>`}
      </div>
    `;
  }
}

export default ProtvistaUniprotStructure;
