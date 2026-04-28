const proteinsApi = 'https://www.ebi.ac.uk/proteins/api/';
const alphafoldApi = 'https://alphafold.ebi.ac.uk/api/';
const alphafoldEntry = 'https://alphafold.ebi.ac.uk/entry/';
const interproApi = 'https://www.ebi.ac.uk/interpro/wwwapi/';

const proteinsApiServices = {
  proteins: `${proteinsApi}proteins/`,
  features: `${proteinsApi}features/`,
  variation: `${proteinsApi}variation/`,
  antigen: `${proteinsApi}antigen/`,
  epitope: `${proteinsApi}epitope/`,
  mutagenesis: `${proteinsApi}mutagenesis/`,
  nonPtm: `${proteinsApi}proteomics/nonPtm/`,
  ptm: `${proteinsApi}proteomics/ptm/`,
  hpp: `${proteinsApi}proteomics/hpp/`,
};

export type TrackType =
  | 'nightingale-track-canvas'
  | 'nightingale-interpro-track'
  | 'nightingale-colored-sequence'
  | 'nightingale-variation'
  | 'nightingale-linegraph-track'
  | 'nightingale-sequence-heatmap';

export type ProtvistaTrackConfig = {
  name: string;
  label?: string;
  labelUrl?: string;
  filter?: string;
  trackType: TrackType;
  data: {
    url: string | string[];
    adapter?:
      | 'feature-adapter'
      | 'structure-adapter'
      | 'proteomics-adapter'
      | 'variation-adapter'
      | 'variation-graph-adapter'
      | 'interpro-adapter'
      | 'alphafold-confidence-adapter'
      | 'alphamissense-pathogenicity-adapter'
      | 'alphamissense-heatmap-adapter'
      | 'proteomics-ptm-adapter'
      | 'rna-editing-adapter'
      | 'rna-editing-graph-adapter';
  }[];
  tooltip: string;
  color?: string;
  shape?: string; //TODO: eventually replace with list
  scale?: string;
  filterComponent?: 'nightingale-filter';
  'color-range'?: string;
  helpPage?: string;
};

type ProtvistaCategory = {
  name: string;
  label: string;
  trackType: TrackType;
  tracks: ProtvistaTrackConfig[];
  color?: string;
  shape?: string; //TODO: eventually replace with list
  scale?: string;
  'color-range'?: string;
  helpPage?: string;
};

export type ProtvistaConfig = {
  categories: ProtvistaCategory[];
};

const config: ProtvistaConfig = {
  categories: [
    {
      name: 'MOLECULE_PROCESSING',
      label: 'Molecule processing',
      trackType: 'nightingale-track-canvas',
      tracks: [
        {
          name: 'signal',
          label: 'Signal peptide',
          filter: 'SIGNAL',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip: 'N-terminal signal peptide',
          helpPage: 'signal',
        },
        {
          name: 'chain',
          label: 'Chain',
          filter: 'CHAIN',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            '(aka mature region). This describes the extent of a polypeptide chain in the mature protein following processing',
          helpPage: 'chain',
        },
        {
          name: 'transit',
          label: 'Transit peptide',
          filter: 'TRANSIT',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip: 'This describes the extent of a transit peptide',
          helpPage: 'transit',
        },
        {
          name: 'init_met',
          label: 'Initiator methionine',
          filter: 'INIT_MET',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],

          tooltip:
            'This indicates that the initiator methionine is cleaved from the mature protein',
          helpPage: 'init_met',
        },
        {
          name: 'propep',
          label: 'Propeptide',
          filter: 'PROPEP',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'Part of a protein that is cleaved during maturation or activation',
          helpPage: 'propep',
        },
        {
          name: 'peptide',
          label: 'Peptide',
          filter: 'PEPTIDE',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'The position and length of an active peptide in the mature protein',
          helpPage: 'peptide',
        },
      ],
    },
    {
      name: 'SEQUENCE_INFORMATION',
      label: 'Sequence information',
      trackType: 'nightingale-track-canvas',
      tracks: [
        {
          name: 'compbias',
          label: 'Compositional bias',
          filter: 'COMPBIAS',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'Position of regions of compositional bias within the protein and the particular amino acids that are over-represented within those regions',
          helpPage: 'compbias',
        },
        {
          name: 'conflict',
          label: 'Sequence conflict',
          filter: 'CONFLICT',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip: 'Sequence discrepancies of unknown origin',
          helpPage: 'conflict',
        },
        {
          name: 'non_cons',
          filter: 'NON_CONS',
          trackType: 'nightingale-track-canvas',
          label: 'Non-adjacent residues',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'Indicates that two residues in a sequence are not consecutive and that there is an undetermined number of unsequenced residues between them',
          helpPage: 'non_cons',
        },
        {
          name: 'non_ter',
          filter: 'NON_TER',
          trackType: 'nightingale-track-canvas',
          label: 'Non-terminal residue',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'The sequence is incomplete. The residue is not the terminal residue of the complete protein',
          helpPage: 'non_ter',
        },
        {
          name: 'unsure',
          filter: 'UNSURE',
          trackType: 'nightingale-track-canvas',
          label: 'Sequence uncertainty',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'Regions of a sequence for which the authors are unsure about the sequence assignment',
          helpPage: 'unsure',
        },
        {
          name: 'non_std',
          filter: 'NON_STD',
          trackType: 'nightingale-track-canvas',
          label: 'Non-standard residue',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip: 'Non-standard amino acids (selenocysteine and pyrrolysine)',
          helpPage: 'non_std',
        },
      ],
    },
    {
      name: 'TOPOLOGY',
      label: 'Topology',
      trackType: 'nightingale-track-canvas',
      tracks: [
        {
          name: 'topo_dom',
          label: 'Topological domain',
          filter: 'TOPO_DOM',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'Location of non-membrane regions of membrane-spanning proteins',
          helpPage: 'topo_dom',
        },
        {
          name: 'transmem',
          label: 'Transmembrane',
          filter: 'TRANSMEM',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip: 'Extent of a membrane-spanning region',
          helpPage: 'transmem',
        },
        {
          name: 'intramem',
          label: 'Intramembrane',
          filter: 'INTRAMEM',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'Extent of a region located in a membrane without crossing it',
          helpPage: 'intramem',
        },
      ],
    },
    {
      name: 'DOMAINS',
      label: 'Domains',
      trackType: 'nightingale-track-canvas',
      tracks: [
        {
          name: 'domain',
          label: 'Domain',
          filter: 'DOMAIN',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'Specific combination of secondary structures organized into a characteristic three-dimensional structure or fold',
          helpPage: 'domain',
        },
        {
          name: 'InterPro representative domain',
          label: 'InterPro Representative Domain',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'interpro-adapter',
              url: `${interproApi}entry/all/protein/uniprot/{accession}?type=domain&page_size=100`,
            },
          ],
          tooltip: 'InterPro representative domains',
          helpPage: 'InterPro_rep_domain',
        },
        {
          name: 'region',
          label: 'Region',
          filter: 'REGION',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'Regions in multifunctional enzymes or fusion proteins, or characteristics of a region, e.g., protein-protein interactions mediation',
          helpPage: 'region',
        },
        {
          name: 'repeat',
          label: 'Repeat',
          filter: 'REPEAT',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'Repeated sequence motifs or repeated domains within the protein',
          helpPage: 'repeat',
        },
        {
          name: 'motif',
          label: 'Motif',
          filter: 'MOTIF',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip: 'Short conserved sequence motif of biological significance',
          helpPage: 'motif',
        },
        {
          name: 'zn_fing',
          label: 'Zinc finger',
          filter: 'ZN_FING',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'Small, functional, independently folded domain that coordinates one or more zinc ions',
          helpPage: 'zn_fing',
        },
      ],
    },
    {
      name: 'SITES',
      label: 'Sites',
      trackType: 'nightingale-track-canvas',
      tracks: [
        {
          name: 'metal',
          label: 'Metal binding',
          filter: 'METAL',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip: 'Binding site for a metal ion',
          helpPage: 'binding',
        },
        {
          name: 'site',
          label: 'Site',
          filter: 'SITE',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip: 'Any interesting single amino acid site on the sequence',
          helpPage: 'site',
        },
        {
          name: 'ca_bind',
          label: 'Calcium binding',
          filter: 'CA_BIND',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip: 'Calcium-binding regions, such as the EF-hand motif',
          helpPage: 'binding',
        },
        {
          name: 'dna_bind',
          label: 'DNA binding',
          filter: 'DNA_BIND',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'DNA-binding domains such as AP2/ERF domain, the ETS domain, the Fork-Head domain, the HMG box and the Myb domain',
          helpPage: 'dna_bind',
        },
        {
          name: 'np_bind',
          label: 'Nucleotide binding',
          filter: 'NP_BIND',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            '(aka flavin-binding). Region in the protein which binds nucleotide phosphates',
          helpPage: 'binding',
        },
        {
          name: 'binding',
          label: 'Binding site',
          filter: 'BINDING',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'Binding site for any chemical group (co-enzyme, prosthetic group, etc.)',
          helpPage: 'binding',
        },
        {
          name: 'act_site',
          label: 'Active site',
          filter: 'ACT_SITE',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'Amino acid(s) directly involved in the activity of an enzyme',
          helpPage: 'act_site',
        },
      ],
    },
    {
      name: 'PTM',
      label: 'PTM',
      trackType: 'nightingale-track-canvas',
      tracks: [
        {
          name: 'mod_res',
          label: 'Modified residue',
          filter: 'MOD_RES',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'Modified residues such as phosphorylation, acetylation, acylation, methylation',
          helpPage: 'mod_res',
        },
        {
          name: 'mod_res_ls',
          label: 'Modified residue (large scale data)',
          filter: 'MOD_RES_LS',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'proteomics-ptm-adapter',
              url: `${proteinsApiServices.ptm}{accession}`,
            },
          ],
          tooltip: 'Modified residues from Large scale studies',
          helpPage: 'mod_res_large_scale',
        },
        {
          name: 'carbohyd',
          label: 'Glycosylation',
          filter: 'CARBOHYD',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip: 'Covalently attached glycan group(s)',
          helpPage: 'carbohyd',
        },
        {
          name: 'disulfid',
          label: 'Disulfide bond',
          filter: 'DISULFID',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'The positions of cysteine residues participating in disulphide bonds',
          helpPage: 'disulfid',
        },
        {
          name: 'crosslnk',
          label: 'Cross-link',
          filter: 'CROSSLNK',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip:
            'Covalent linkages of various types formed between two proteins or between two parts of the same protein',
          helpPage: 'crosslnk',
        },
        {
          name: 'lipid',
          label: 'Lipidation',
          filter: 'LIPID',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip: 'Covalently attached lipid group(s)',
          helpPage: 'lipid',
        },
      ],
    },
    {
      name: 'EPITOPE',
      label: 'Epitopes',
      trackType: 'nightingale-track-canvas',
      tracks: [
        {
          name: 'epitope',
          label: 'Epitope',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.epitope}{accession}`,
            },
          ],
          tooltip: '',
          helpPage: 'epitopes',
        },
      ],
    },
    {
      name: 'ANTIGEN',
      label: 'Antigenic sequences',
      trackType: 'nightingale-track-canvas',
      tracks: [
        {
          name: 'antigen',
          label: 'Antibody binding sequences',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.antigen}{accession}`,
            },
          ],
          tooltip: '',
          helpPage: 'Antibody_binding_sequences',
        },
      ],
    },
    {
      name: 'MUTAGENESIS',
      label: 'Mutagenesis',
      trackType: 'nightingale-track-canvas',
      tracks: [
        {
          name: 'mutagen',
          label: 'Mutagenesis',
          filter: 'MUTAGEN',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.features}{accession}`,
            },
          ],
          tooltip: 'Site which has been experimentally altered by mutagenesis',
          helpPage: 'mutagen',
        },
        {
          name: 'othermutagen',
          label: 'Mutagenesis (large scale data)',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'feature-adapter',
              url: `${proteinsApiServices.mutagenesis}{accession}`,
            },
          ],
          tooltip: 'Site which has been experimentally altered by mutagenesis',
          helpPage: 'mutagen',
        },
      ],
    },
    {
      name: 'VARIATION',
      label: 'Variants',
      trackType: 'nightingale-linegraph-track',
      helpPage: 'variant_viewer',
      tracks: [
        {
          name: 'variation_graph',
          label: 'Counts',
          trackType: 'nightingale-linegraph-track',
          data: [
            {
              adapter: 'variation-graph-adapter',
              url: `${proteinsApiServices.variation}{accession}`,
            },
          ],
          tooltip:
            'Natural variant of the protein, including polymorphisms, variations between strains, isolates or cultivars, disease-associated mutations and RNA editing events',
        },
        {
          name: 'variation',
          filterComponent: 'nightingale-filter',
          trackType: 'nightingale-variation',
          data: [
            {
              adapter: 'variation-adapter',
              url: `${proteinsApiServices.variation}{accession}`,
            },
          ],
          tooltip:
            'Natural variant of the protein, including polymorphisms, variations between strains, isolates or cultivars, disease-associated mutations and RNA editing events',
        },
      ],
    },
    {
      name: 'RNA_EDITING',
      label: 'RNA Editing',
      trackType: 'nightingale-linegraph-track',
      helpPage: 'rna_editing',
      tracks: [
        {
          name: 'rna_editing_graph',
          label: 'Counts',
          trackType: 'nightingale-linegraph-track',
          data: [
            {
              adapter: 'rna-editing-graph-adapter',
              url: `${proteinsApi}rna-editing/{accession}`,
            },
          ],
          tooltip:
            'RNA editing events leading to one or more amino acid changes compared to the translation of the non-edited RNA version.',
        },
        {
          name: 'RNA Editing',
          trackType: 'nightingale-variation',
          data: [
            {
              adapter: 'rna-editing-adapter',
              url: `${proteinsApi}rna-editing/{accession}`,
            },
          ],
          tooltip:
            'RNA editing events leading to one or more amino acid changes compared to the translation of the non-edited RNA version.',
        },
      ],
    },
    {
      name: 'PROTEOMICS',
      label: 'Proteomics',
      trackType: 'nightingale-track-canvas',
      tracks: [
        {
          name: 'unique',
          label: 'Unique peptide',
          filter: 'unique',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'proteomics-adapter',
              url: `${proteinsApiServices.nonPtm}{accession}`,
            },
          ],
          tooltip: '',
          helpPage:
            'proteomics#1-data-from-public-mass-spectrometry-based-proteomics-resources',
        },
        {
          name: 'non_unique',
          label: 'Non-unique peptide',
          filter: 'non_unique',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'proteomics-adapter',
              url: `${proteinsApiServices.nonPtm}{accession}`,
            },
          ],
          tooltip: '',
          helpPage:
            'proteomics#1-data-from-public-mass-spectrometry-based-proteomics-resources',
        },
        {
          name: 'hpp',
          label: 'Human proteome project',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'proteomics-adapter',
              url: `${proteinsApiServices.hpp}{accession}`,
            },
          ],
          tooltip: '',
          helpPage: 'proteomics#3-human-proteome-project',
        },
        {
          name: 'proteomics-ptm',
          label: 'PTM-containing peptide',
          trackType: 'nightingale-track-canvas',
          data: [
            {
              adapter: 'proteomics-adapter',
              url: `${proteinsApiServices.ptm}{accession}`,
            },
          ],
          tooltip: '',
          helpPage:
            'proteomics#4-post-translational-modification-ptm-data-derived-from-large-scale-mass-spectrometry-ms-datasets',
        },
      ],
    },
    {
      name: 'STRUCTURE_COVERAGE',
      label: 'PDBe 3D structure coverage',
      trackType: 'nightingale-track-canvas',
      tracks: [
        {
          name: 'pdbe_cover',
          label: 'PDBe coverage',
          trackType: 'nightingale-track-canvas',
          tooltip: 'PDBe 3D structure coverage',
          data: [
            {
              adapter: 'structure-adapter',
              url: `${proteinsApiServices.proteins}{accession}`,
            },
          ],
          helpPage: 'structure_section#structure-coverage',
        },
      ],
    },
    {
      name: 'ALPHAFOLD_CONFIDENCE',
      label: 'AlphaFold',
      trackType: 'nightingale-colored-sequence',
      scale: 'H:90,M:70,L:50,D:0',
      'color-range': '#ff7d45:0,#ffdb13:50,#65cbf3:70,#0053d6:90,#0053d6:100',
      helpPage: 'structure_section#alphafold-structural-models',
      tracks: [
        {
          name: 'alphafold_confidence',
          label: 'AlphaFold Confidence',
          labelUrl: `${alphafoldEntry}{accession}`,
          trackType: 'nightingale-colored-sequence',
          data: [
            {
              adapter: 'alphafold-confidence-adapter',
              url: [
                `${alphafoldApi}prediction/{accession}`,
                `${proteinsApiServices.proteins}{accession}`,
              ],
            },
          ],
          tooltip: 'AlphaFold prediction confidence',
        },
      ],
    },
    {
      name: 'ALPHAMISSENSE_PATHOGENICITY',
      label: 'AlphaMissense',
      trackType: 'nightingale-colored-sequence',
      scale:
        'B:0,H:0.1132,V:0.2264,L:0.3395,A:0.4527,l:0.5895,h:0.7264,p:0.8632,P:1',
      'color-range':
        '#2166ac:0,#4290bf:0.1132,#8cbcd4:0.2264,#c3d6e0:0.3395,#e2e2e2:0.4527,#edcdba:0.5895,#e99e7c:0.7264,#d15e4b:0.8632,#b2182b:1',
      helpPage:
        'structure_section#alphamissense-prediction-of-genetic-variation-consequence-in-the-feature-viewer',
      tracks: [
        {
          name: 'alphamissense_pathogenicity',
          label: 'Average Pathogenicity Score',
          trackType: 'nightingale-colored-sequence',
          data: [
            {
              adapter: 'alphamissense-pathogenicity-adapter',
              url: [
                `${alphafoldApi}prediction/{accession}`,
                `${proteinsApiServices.proteins}{accession}`,
              ],
            },
          ],
          tooltip: 'AlphaMissense pathogenicity',
        },
        {
          name: 'alphamissense_pathogenicity_heatmap',
          label: 'AlphaMissense Pathogenicity',
          labelUrl: `${alphafoldEntry}{accession}`,
          trackType: 'nightingale-sequence-heatmap',
          data: [
            {
              adapter: 'alphamissense-heatmap-adapter',
              url: [
                `${alphafoldApi}prediction/{accession}`,
                `${proteinsApiServices.proteins}{accession}`,
              ],
            },
          ],
          tooltip: 'AlphaMissense pathogenicity',
        },
      ],
    },
  ],
};

export default config;
