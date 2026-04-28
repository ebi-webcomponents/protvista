export type InterProProteinSearch = {
  count: number;
  next: string | null;
  previous: string | null;
  results: Result[];
};

type Result = {
  metadata: Metadata;
  proteins: Protein[];
};

export type Metadata = {
  accession: string;
  name: string;
  source_database: string;
  type: string;
  integrated: null | string;
  member_databases: MemberDatabases | null;
  go_terms: GoTerm[] | null;
};

type GoTerm = {
  identifier: string;
  name: string;
  category: Category;
};

type Category = {
  code: string;
  name: string;
};

type MemberDatabases = {
  profile?: Record<string, string>;
  pfam?: Record<string, string>;
  smart?: Record<string, string>;
  prints?: Record<string, string>;
};

type Protein = {
  accession: string;
  protein_length: number;
  source_database: string;
  organism: string;
  in_alphafold: boolean;
  entry_protein_locations: EntryProteinLocation[];
};

type EntryProteinLocation = {
  fragments: Fragment[];
  representative: boolean;
  model: null | string;
  score: number | null;
};

type Fragment = {
  start: number;
  end: number;
  'dc-status': string;
};

export type TransformedInterPro = {
  locations: EntryProteinLocation[];
  start: string | number;
  end: string | number;
  color: any;
  tooltipContent: string;
  length: number;
  accession: string;
  name: string;
  source_database: string;
  type: string;
  integrated: null | string;
  member_databases: MemberDatabases | null;
  go_terms: GoTerm[] | null;
}[];
