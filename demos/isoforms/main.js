import 'protvista-uniprot';
import { uniprotIsoforms } from './isoforms-adapter.js';

// Inject the Biology Check note
const bioCheck = document.createElement('div');
bioCheck.style.cssText = "background: #eef5fa; padding: 15px; border-left: 4px solid #0053d6; margin-bottom: 20px; border-radius: 4px;";
bioCheck.innerHTML = `
    <h3 style="margin-top: 0;">Biology Check: What is an Isoform?</h3>
    <p style="margin-bottom: 0;">Most human proteins have multiple variants, or <strong>isoforms</strong>, created by alternative splicing. 
    Positions often differ between the canonical sequence and specific isoforms due to missing or altered residues. 
    This mapper dynamically visualizes those edits. For example, Tau's famous P301L variant sits at 618 in the canonical sequence, but at 301 in the Tau-F isoform that researchers actually study.</p>
`;
document.body.prepend(bioCheck);

const acc = new URLSearchParams(location.search).get('acc') || 'P05067';

const viewer = document.createElement('protvista-uniprot');
viewer.setAttribute('nostructure', '');
viewer.adapters = { 'uniprot-isoforms': uniprotIsoforms };

// The tau-441 projection (Milestone 3) has its own page, gold.html: it only
// makes sense for tau, so it is not a track here.
viewer.viewerConfig = {
  accession: acc,
  sources: {
    features: 'https://www.ebi.ac.uk/proteins/api/features/{accession}',
    uniprotEntry: 'https://rest.uniprot.org/uniprotkb/{accession}.json?fields=sequence,ft_var_seq,cc_alternative_products',
  },
  rows: [
    { id: 'ISOFORMS', label: 'Isoforms', tracks: [
      { id: 'isoforms', label: 'Isoforms (canonical coordinates)', kind: 'features',
        data: { source: 'uniprotEntry', adapter: 'uniprot-isoforms' },
        rendering: { layout: 'non-overlapping', height: 160 } },
      { id: 'splice', label: 'Splice variant (VAR_SEQ)', kind: 'features', filter: 'VAR_SEQ', data: 'features',
        rendering: { layout: 'non-overlapping', height: 110 } },
    ] },
    { id: 'DOMAINS', label: 'Domains', tracks: [
      { id: 'domain', kind: 'features', filter: 'DOMAIN', data: 'features' } ] },
  ],
};

viewer.addEventListener('protvista-error', (e) => console.log('PVERR', JSON.stringify(e.detail).slice(0, 300)));
document.body.append(viewer);
window.__viewer = viewer;
