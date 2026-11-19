/**
 * JSX typings for using the elements from React 19, published as the
 * types-only `protvista-uniprot/react` subpath. Requires `@types/react` 19 or
 * later, which declares `React.JSX`; React 18 is not supported (it writes
 * `suspend={false}` as an attribute that still suspends):
 *
 *   import type {} from 'protvista-uniprot/react';
 *
 *   <protvista-uniprot accession="P05067" notooltip suspend />
 *   <protvista-uniprot-structure accession="P05067" no-table color-theme="alphafold" />
 *
 * Props use the **attribute** spelling. React 19 sets an attribute rather
 * than a property on an element that is not defined yet, and HTML lowercases
 * attribute names, so a camel-cased `noTable` would arrive as the unobserved
 * `notable`. Object-valued props (`viewerConfig`, `adapters`, `data`) can only
 * be set as properties: import the element before rendering it, or set them
 * through a ref. Otherwise React stringifies them into an attribute, and the
 * element warns that the value was lost.
 *
 * Emits no runtime code.
 */
import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type ProtvistaUniprot from './protvista-uniprot.js';
import type ProtvistaUniprotStructure from './protvista-uniprot-structure.js';
import type { ProcessedStructureData } from './protvista-uniprot-structure.js';
import type { AdapterFunction, ProtvistaViewerConfig } from './schema/types.js';

/** The standard element props (`className`, `style`, `ref`, events, …). */
type ElementProps<E extends HTMLElement> = DetailedHTMLProps<
  HTMLAttributes<E>,
  E
>;

/** `<protvista-uniprot>` attributes and properties, as JSX props. */
export interface ProtvistaUniprotProps extends ElementProps<ProtvistaUniprot> {
  accession?: string;
  sequence?: string;
  /** Hold off loading until removed. */
  suspend?: boolean;
  /** Turn off the built-in click tooltip. */
  notooltip?: boolean;
  nostructure?: boolean;
  'no-persist-layout'?: boolean;
  'config-src'?: string;
  /** Turn visitor notices off. */
  'quiet-notices'?: boolean;
  /** Author mode: list every warning on the viewer. */
  'show-warnings'?: boolean;
  /** Property only — import the element before rendering, or use a ref. */
  viewerConfig?: ProtvistaViewerConfig | string;
  /** Property only — import the element before rendering, or use a ref. */
  adapters?: Record<string, AdapterFunction>;
}

/** `<protvista-uniprot-structure>` attributes and properties, as JSX props. */
export interface ProtvistaUniprotStructureProps extends ElementProps<ProtvistaUniprotStructure> {
  accession?: string;
  sequence?: string;
  checksum?: string;
  /** Attribute `structureid`; React passes `structureId` through as that. */
  structureId?: string;
  'selected-id'?: string;
  'no-table'?: boolean;
  'color-theme'?: string;
  /** URL templates replacing the EBI lookups; `{accession}` is filled in. */
  'uniprot-url'?: string;
  'alphafold-url'?: string;
  'beacons-url'?: string;
  /** As `beacons-url`, for a lookup by `checksum`; `{checksum}` is filled in. */
  'beacons-checksum-url'?: string;
  /** Property only — import the element before rendering, or use a ref. */
  data?: ProcessedStructureData[];
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'protvista-uniprot': ProtvistaUniprotProps;
      'protvista-uniprot-structure': ProtvistaUniprotStructureProps;
    }
  }
}
