import 'protvista-uniprot';
import { projectFeatures, projectTo } from './isoforms-adapter.js';

const iso = 'P10636-8';
const canon = 'P10636';

const sources = {
  canonFeatures: `https://www.ebi.ac.uk/proteins/api/features/${canon}`,
  canonEntry: `https://rest.uniprot.org/uniprotkb/${canon}.json?fields=sequence,ft_var_seq,cc_alternative_products`,
};

const TRACKS = [
  ['repeat', 'Repeats', 'REPEAT'],
  ['region', 'Regions', 'REGION'],
  ['variant', 'Natural variants', 'VARIANT'],
  ['modres', 'Modified residues', 'MOD_RES'],
];

// Track labels say how many canonical features of their type Tau-F lacks
// entirely. Counting needs the data before the config, so fetch it here too
// (the viewer then fetches the same URLs); without it, the labels just omit
// the count.
async function countDropped() {
  try {
    const [features, entry] = await Promise.all(
      [sources.canonFeatures, sources.canonEntry].map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} at ${url}`);
        return response.json();
      })
    );
    const count = {};
    for (const f of features.features) {
      count[f.type] ??= { dropped: 0, total: 0 };
      count[f.type].total++;
    }
    for (const f of projectFeatures(features.features, entry, iso).dropped) {
      count[f.type].dropped++;
    }
    return count;
  } catch (error) {
    console.warn('Could not count the dropped features:', error);
    return null;
  }
}

function mount(count) {
  const label = (name, type) =>
    count?.[type]
      ? `${name} (projected; ${count[type].dropped} of ${count[type].total} dropped)`
      : `${name} (projected)`;

  const viewer = document.createElement('protvista-uniprot');
  viewer.setAttribute('nostructure', '');
  viewer.adapters = { 'project-to-isoform': projectTo(iso) };
  viewer.viewerConfig = {
    accession: iso,
    sources,
    rows: [
      {
        id: 'PROJECTED',
        label: 'Canonical annotations on Tau-F',
        tracks: TRACKS.map(([id, name, type]) => ({
          id,
          label: label(name, type),
          kind: 'features',
          filter: type,
          data: {
            source: ['canonFeatures', 'canonEntry'],
            adapter: 'project-to-isoform',
          },
        })),
      },
    ],
  };

  viewer.addEventListener('protvista-error', (e) =>
    console.log('PVERR', JSON.stringify(e.detail).slice(0, 400))
  );
  document.body.append(viewer);
  window.__viewer = viewer;
}

// Not awaited, so the page's loader sees the module finish straight away.
countDropped().then(mount);
