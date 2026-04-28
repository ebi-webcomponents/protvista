// Yvonne Lussi: This first dataset is for human proteins, and we decided to only show
// the RNA editing events that have missense consequence. It may be possible to import
// the synonymous events at a later timepoint.
// Fetch all of the available human rna-editing entries
// Source: https://www.ebi.ac.uk/proteins/api/rna-editing?offset=0&size=-1&taxid=9606
// Save above request to rna-editing.json then using quicktype tool (https://github.com/glideapps/quicktype):
// quicktype rna-editing.json -o rna-editing.ts --just-types
// Changed interfaces for types and replaced enums string literal types

export type RnaEditing = {
  accession: string;
  entryName: string;
  sequence: string;
  sequenceChecksum: string;
  taxid: number;
  features: RnaEditingFeature[];
};

export type RnaEditingFeature = {
  type: Type;
  xrefs: Xref[];
  dbReferenceType: DBReferenceType[];
  variantType: VariantType;
  rnaEditingInfo: RnaEditingInfo;
  locationType: LocationType;
  variantlocation: string[];
};

export type TransformedRnaEditing = RnaEditingFeature & {
  accession: string;
  variant: string;
  start: number;
  end: number;
  tooltipContent: string;
  consequenceType: string;
};

type DBReferenceType = {
  id: string;
  type: Type;
};

type Type = 'rna_editing';

type LocationType = {
  position: Position;
};

type Position = {
  position: number;
  status: Status;
};

type Status = 'certain';

type RnaEditingInfo = {
  nedBS: number;
  nsamples: number;
  nbodySites: number;
  ntissues: number;
  nedInd: number;
};

type VariantType = {
  genomicLocation: string[];
  variantLocation: VariantLocation[];
  codon: Codon;
  consequenceType: ConsequenceType;
  wildType: DType;
  mutatedType: DType;
  somaticStatus: boolean;
  sourceType: SourceType;
};

type Codon =
  | 'aCa'
  | 'aCg'
  | 'aCc'
  | 'aCu'
  | 'aGa'
  | 'aGc'
  | 'aGg'
  | 'aGu'
  | 'auG'
  | 'cCa'
  | 'cCg'
  | 'cCc'
  | 'cCu'
  | 'Cga'
  | 'cGa'
  | 'cGc'
  | 'cGg'
  | 'cGu'
  | 'Cac'
  | 'Cag'
  | 'Cau'
  | 'Cca'
  | 'Ccc'
  | 'Ccg'
  | 'Ccu'
  | 'Cgc'
  | 'Cgg'
  | 'Cgu'
  | 'Cuc'
  | 'Cuu'
  | 'gCa'
  | 'Gcc'
  | 'gCg'
  | 'gCc'
  | 'gCu'
  | 'gGa'
  | 'gGc'
  | 'gGg'
  | 'gGu'
  | 'Gaa'
  | 'Gac'
  | 'Gag'
  | 'Gau'
  | 'Gca'
  | 'Gcg'
  | 'Gcu'
  | 'Gga'
  | 'Ggc'
  | 'Ggg'
  | 'Ggu'
  | 'Gua'
  | 'Guc'
  | 'Gug'
  | 'Guu'
  | 'uCa'
  | 'uCg'
  | 'uCc'
  | 'uCu'
  | 'uGc'
  | 'uGu'
  | 'ugG';

type ConsequenceType = 'missense';

type DType =
  | 'A'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T'
  | 'U'
  | 'V'
  | 'W'
  | 'Y';

type SourceType = 'Rna Editing';

type VariantLocation = {
  loc: string;
  seqId: string;
  source: Source;
};

type Source = 'Ensembl';

type Xref = {
  id: string;
};
