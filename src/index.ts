// Must be first: installs a browser `process` global before any element / Mol*
// module is evaluated, so the published dist runs in a bare-browser / CDN
// `<script type="module">` context. See src/process-shim.ts.
import './process-shim.js';

export { default as filterConfig, colorConfig } from './filter-config.js';
export { default as ProtvistaUniprotStructure } from './protvista-uniprot-structure.js';
import ProtvistaUniprot from './protvista-uniprot.js';
export default ProtvistaUniprot;
