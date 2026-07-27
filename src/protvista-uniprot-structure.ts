import { LitElement, html, svg, type TemplateResult, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import NightingaleStructure, {
  type AlphaFoldPayload,
} from '@nightingale-elements/nightingale-structure';
import type { ColumnConfig } from './protvista-uniprot-datatable.js';
import './protvista-uniprot-datatable.js';
import { fetchAll, loadComponent } from './utils/index.js';
import downloadIcon from './icons/download.svg';
import externalLinkIcon from './icons/external-link.svg';

import loaderIcon from './icons/spinner.svg';
import { inlineSvg } from './icons/inline.js';
import loaderStyles from './styles/loader-styles.js';
import { injectStyleOnce, installTokenDefaults } from './styles/inject.js';

const PDBLinks = [
  { name: 'PDBe', link: 'https://www.ebi.ac.uk/pdbe-srv/view/entry/' },
  { name: 'RCSB-PDB', link: 'https://www.rcsb.org/structure/' },
  { name: 'PDBj', link: 'https://pdbj.org/mine/summary/' },
  { name: 'PDBsum', link: 'https://www.ebi.ac.uk/pdbsum/' },
];
const alphaFoldUrl = 'https://alphafold.ebi.ac.uk/entry/';
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
]);

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

type ProcessedStructureData = {
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
  isoform?: TemplateResult;
  afPrediction?: boolean; // Flag to differentiate the structure source as AlphaFold prediction API vs 3DBeacons AlphaFold
};

type IsoformIdSequence = [
  {
    isoformId: string;
    sequence: string;
  },
];

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
            downloadUrl: `https://www.ebi.ac.uk/pdbe/entry-files/download/pdb${id.toLowerCase()}.ent`,
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
  accession?: string,
  isoforms?: IsoformIdSequence,
  canonicalSequence?: string
): ProcessedStructureData[] =>
  data
    .map((d) => {
      const isoformMatch = isoforms?.find(
        ({ sequence }) => d.sequence === sequence
      );

      const isoformElement = isoformMatch
        ? html`<a
            href="${uniprotKBUrl}${accession}/entry#${isoformMatch.isoformId}"
          >
            ${isoformMatch.isoformId}
            ${isoformMatch.sequence === canonicalSequence ? '(Canonical)' : ''}
          </a>`
        : null;

      return {
        id: d.modelEntityId,
        source: 'AlphaFold DB',
        method: 'Predicted',
        positions: `${d.sequenceStart}-${d.sequenceEnd}`,
        protvistaFeatureId: d.modelEntityId,
        downloadUrl: d.pdbUrl,
        amAnnotationsUrl: d.amAnnotationsUrl,
        isoform: isoformElement,
        afPrediction: true,
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
      method: sourceMethods.get(summary.provider),
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
    <span class="cell-link__icon">${svg`${unsafeHTML(inlineSvg(downloadIcon))}`}</span>
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
  private selectedRowId?: string;

  constructor() {
    super();
    loadComponent('nightingale-structure', NightingaleStructure);

    this.loading = true;
    this.addStyles();
    this.colorTheme = 'alphafold';
    this.alphamissenseAvailable = false;

    this.columns = this.getColumns();
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
        key: 'isoform',
        render: (row) => row.isoform ?? nothing,
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
        ? html`<a href="${alphaFoldUrl}${this.accession}">AlphaFold</a>`
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
        ({ sequence: afSequence }) =>
          this.isoforms?.some(({ sequence }) => afSequence === sequence)
      );

      afData = processAFData(
        alphaFoldSequenceMatches,
        this.accession,
        this.isoforms,
        rawData[pdbUrl]?.sequence?.value
      );

      this.alphamissenseAvailable = !!afData?.[0]?.amAnnotationsUrl;
    } else {
      // Check if AF sequence matches UniProt sequence
      const alphaFoldSequenceMatch = rawData[alphaFoldUrl]?.filter(
        ({ sequence: afSequence }) =>
          rawData[pdbUrl]?.sequence?.value === afSequence ||
          this.sequence === afSequence
      );
      if (alphaFoldSequenceMatch?.length) {
        afData = processAFData(alphaFoldSequenceMatch);
        this.alphamissenseAvailable = alphaFoldSequenceMatch.some(
          (data) => data.amAnnotationsUrl
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

    if (!data || !data.length) return;

    this.data = data;
    this.columns = this.getColumns();

    // Select first row by default
    this.selectedRowId = data[0].id;
    this.onRowSelected(data[0]);
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

  private onRowSelected(row: ProcessedStructureData) {
    const { id, source, downloadUrl, amAnnotationsUrl, afPrediction } = row;
    this.selectedRowId = id;

    if (
      this.checksum ||
      (providersFrom3DBeacons.includes(source) && !afPrediction)
    ) {
      this.modelUrl = downloadUrl;
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
    this.onRowSelected(e.detail);
  };

  // Built once at class definition rather than per instance: addStyles()
  // runs in every constructor but the sheet is injected only once.
  private static readonly cssStyle = css`
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

        <div class="protvista-uniprot-structure__table">
          ${this.data && this.data.length
            ? html`
                <protvista-uniprot-datatable
                  .data=${this.data}
                  .columns=${this.columns}
                  .selectedId=${this.selectedRowId}
                  row-id-key="id"
                  @row-click=${this.onDatatableRowClick}
                ></protvista-uniprot-datatable>
              `
            : nothing}
          ${this.loading
            ? html`<div class="protvista-loader">
                ${svg`${unsafeHTML(inlineSvg(loaderIcon))}`}
              </div>`
            : nothing}
          ${!this.data && !this.loading
            ? html`<div class="protvista-no-results">
                No structure information available
                ${this.accession ? `for ${this.accession}` : ''}
              </div>`
            : nothing}
        </div>
      </div>
    `;
  }
}

export default ProtvistaUniprotStructure;
