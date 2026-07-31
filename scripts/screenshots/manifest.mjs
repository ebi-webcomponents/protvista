/**
 * The shot list — the single source of truth for what is captured, where it
 * lands, and what it claims.
 *
 * Alt text and captions live here rather than only in the markdown so they are
 * reviewed alongside the image, and so `screenshots-doc.spec.mjs` can assert the
 * docs actually say what the manifest says.
 *
 * `expectGroups` is not decoration: it is asserted as a set at capture time
 * (see ready.mjs). If the fixtures or the rendering change so that a different
 * set of rows is drawn, the run fails instead of quietly producing a picture
 * that no longer matches the prose beside it. The values below were measured,
 * not guessed.
 */
import { readFileSync } from 'node:fs';

const PLAYGROUND = '/protvista/playground/';

/** The tutorial's Step 3 config, loaded verbatim so the figure cannot drift
 *  from the YAML block printed beside it (which `tutorial-doc.spec.ts` already
 *  pins to this same file). Passed through the playground's `#config=`. */
const extendDefault = readFileSync(
  'examples/extend-default/config.yaml',
  'utf8'
);
const asHash = (yaml) => `#config=${Buffer.from(yaml).toString('base64')}`;

/** Every row the default UniProt viewer draws for P05067, as measured.
 *
 *  RNA_EDITING is absent: that endpoint genuinely 404s for this accession and
 *  the fixture replays the 404, so the row has no data to show. It reappears in
 *  Customize mode, which deliberately reveals errored rows so their ⚠ badge is
 *  reachable — hence `blog-customize-mode` expects one row more than this. Both
 *  are deterministic; they are simply different views. */
const DEFAULT_GROUPS = [
  'MOLECULE_PROCESSING',
  'SEQUENCE_INFORMATION',
  'TOPOLOGY',
  'DOMAINS',
  'SITES',
  'PTM',
  'EPITOPE',
  'ANTIGEN',
  'MUTAGENESIS',
  'VARIATION',
  'PROTEOMICS',
  'STRUCTURE_COVERAGE',
  'ALPHAFOLD_CONFIDENCE',
  'ALPHAMISSENSE_PATHOGENICITY',
];


/** The inline-data example, and the same config with its `theme:` block
 *  removed. Capturing both makes a before/after where the *only* difference is
 *  the theming — using two different presets would compare different data. */
const inlineData = readFileSync('examples/inline-data/config.yaml', 'utf8');
const unthemed = inlineData.replace(/^theme:\n(?:[ \t]+.*\n)*/m, '');

const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';

export const shots = [
  {
    id: 'home-hero',
    // The default viewer, whose fourteen dense rows actually fill a square. The
    // two-row `json` preset was tried first and left three quarters of the hero
    // empty.
    url: `${PLAYGROUND}#preset=uniprot-default&accession=P05067`,
    // Below ~900 the playground stacks the editor above the preview and the
    // viewer lands thousands of pixels down the page, out of the viewport. Stay
    // wide enough for the side-by-side layout; the 604px-wide viewer gives a
    // 604² crop that downsamples cleanly to the 400² Starlight renders.
    viewport: { width: 1280, height: 1400 },
    expectGroups: DEFAULT_GROUPS,
    clip: { aspect: 1 },
    resizeTo: { width: 400, height: 400 },
    doc: 'docs/src/content/docs/index.md',
    hero: true,
    alt: 'A ProtVista viewer showing many rows of protein annotation — molecule processing, sequence information, topology, domains, sites and modifications — drawn as coloured tracks aligned to the amino-acid sequence of P05067.',
    caption: null, // the splash hero takes no caption
  },
  {
    id: 'tutorial-standalone-csv',
    url: `${PLAYGROUND}#preset=csv`,
    viewport: { width: 1280, height: 900 },
    expectGroups: ['hotspots'],
    doc: 'docs/src/content/docs/tutorial.md',
    alt: 'A ProtVista viewer showing a single track named Hotspots, with three labelled feature blocks positioned along the amino-acid sequence of P05067.',
    caption: 'A standalone track loaded from a CSV file.',
  },
  {
    id: 'tutorial-default-viewer',
    url: `${PLAYGROUND}#preset=uniprot-default&accession=P05067`,
    viewport: { width: 1280, height: 1400 },
    expectGroups: DEFAULT_GROUPS,
    doc: 'docs/src/content/docs/tutorial.md',
    alt: "The default UniProt viewer for P05067, showing collapsed track groups for molecule processing, sequence information, topology, domains, sites, PTMs, epitopes, antigens, mutagenesis, variation, proteomics, structure coverage, AlphaFold confidence and AlphaMissense pathogenicity, aligned to the protein's sequence.",
    caption: 'The full default UniProt viewer, from one accession and no configuration.',
  },
  {
    id: 'blog-custom-track',
    url: `${PLAYGROUND}#preset=json`,
    viewport: { width: 1280, height: 900 },
    expectGroups: ['UNIPROT_DOMAINS', 'MY_LAB'],
    doc: 'docs/src/content/docs/blog/protvista-5.md',
    alt: "A ProtVista viewer showing a lab's own Hotspots track directly beneath a track of UniProt domains, both aligned to the same protein sequence.",
    caption: "Your own annotations beside UniProt's, from one configuration file.",
  },
  {
    id: 'blog-customize-mode',
    url: `${PLAYGROUND}#preset=uniprot-default&accession=P05067`,
    viewport: { width: 1280, height: 1400 },
    // Customize mode reveals errored rows so their badge is reachable, so this
    // view legitimately shows one row more than the default one.
    expectGroups: [...DEFAULT_GROUPS, 'RNA_EDITING'],
    actions: [{ clickRole: { role: 'button', name: /^Customize$/ } }],
    doc: 'docs/src/content/docs/blog/protvista-5.md',
    alt: 'The ProtVista viewer in Customize mode. Each track row has gained move-up and move-down buttons and a show/hide switch beside its label.',
    caption: 'Customize mode: reorder and hide rows without touching a configuration file.',
  },
  {
    id: 'tutorial-extended',
    url: `${PLAYGROUND}${asHash(extendDefault)}&accession=P05067`,
    viewport: { width: 1280, height: 1400 },
    expectGroups: [...DEFAULT_GROUPS, 'MY_LAB'],
    doc: 'docs/src/content/docs/tutorial.md',
    alt: "The full default UniProt viewer for P05067 with an additional group labelled My lab at the bottom, containing the lab's own Hotspots track.",
    caption: "A lab's own group layered on top of the canonical UniProt viewer with `extends:`.",
  },
  {
    id: 'tutorial-themed',
    url: `${PLAYGROUND}#preset=inline-data`,
    viewport: { width: 1280, height: 900 },
    expectGroups: ['MY_ANNOTATIONS'],
    doc: 'docs/src/content/docs/tutorial.md',
    alt: 'A ProtVista viewer whose row labels are tinted pale green, showing a track of features supplied inline in the configuration.',
    caption:
      "The `inline-data` preset's `theme:` block: `labelColor` tints the row-label panel.",
  },
];

/* ------------------------------------------------------------------ *
 * Recommended shots — pages that describe something visual and had no
 * picture of it. Same machinery, no new concepts.
 * ------------------------------------------------------------------ */
shots.push(
  {
    id: 'readme-hero',
    // Replaces a repo-root image last touched in July 2019, which showed a UI
    // several majors out of date on both the GitHub landing page and npm.
    // Written to the repo root rather than docs/src/assets because GitHub and
    // npm resolve README image paths relative to the file, and npm rewrites
    // them — a docs/ path is fragile in a way a sibling file is not.
    url: `${PLAYGROUND}#preset=uniprot-default&accession=P05067`,
    viewport: { width: 1280, height: 1400 },
    expectGroups: DEFAULT_GROUPS,
    out: 'protvista.png',
    doc: 'README.md',
    alt: 'ProtVista showing the full default UniProt view of P05067: rows of domains, sites, modifications, variants and structure coverage drawn along the protein sequence.',
    caption: null,
  },
  {
    id: 'customize-controls',
    // The page describes controls a reader currently cannot see. Cropped tight
    // to one row so the buttons are legible rather than lost in a full viewer.
    url: `${PLAYGROUND}#preset=uniprot-default&accession=P05067`,
    viewport: { width: 1280, height: 1400 },
    expectGroups: [...DEFAULT_GROUPS, 'RNA_EDITING'],
    actions: [{ clickRole: { role: 'button', name: /^Customize$/ } }],
    // Tuned so the crop ends on a row boundary rather than slicing one.
    clip: { element: 'protvista-uniprot', stopBefore: null, aspect: 2.2 },
    doc: 'docs/src/content/docs/customize-layout.md',
    alt: 'A close view of ProtVista track rows in Customize mode. Each row shows its label, a show/hide switch, and move-up and move-down buttons.',
    caption: 'The per-row controls: show or hide, and move up or down.',
  },
  {
    id: 'playground-ui',
    // The one shot that captures page chrome, including the version chip, so it
    // needs retaking when the version changes.
    url: `${PLAYGROUND}#preset=csv`,
    // Short enough that the panes fill the frame and the 3D pane's empty state
    // stays below the fold. That message ("No structure information available")
    // is an artefact of stubbing the structure endpoints for determinism, not
    // something a real user sees for P05067 — it must not appear in a figure.
    viewport: { width: 1280, height: 620 },
    expectGroups: ['hotspots'],
    clip: { element: 'body', stopBefore: null },
    hide: ['protvista-uniprot-structure'],
    doc: 'docs/src/content/docs/overview.md',
    alt: 'The ProtVista playground: a configuration editor on the left and a live protein viewer on the right, with preset and accession selectors along the top.',
    caption: 'The playground: edit a configuration on the left, see it render on the right.',
  },
  {
    id: 'theming-comparison',
    // Two captures of the same configuration, joined: default on the left, the
    // `theme:` block applied on the right.
    frames: [
      {
        url: `${PLAYGROUND}${asHash(unthemed)}&accession=P05067`,
        expectGroups: ['MY_ANNOTATIONS'],
      },
      {
        url: `${PLAYGROUND}${asHash(inlineData)}&accession=P05067`,
        expectGroups: ['MY_ANNOTATIONS'],
      },
    ],
    viewport: { width: 1280, height: 900 },
    expectGroups: ['MY_ANNOTATIONS'],
    doc: 'docs/src/content/docs/theming.md',
    alt: 'Two ProtVista viewers side by side showing the same track. The left has default grey row labels; the right has the same labels tinted pale green by a theme block.',
    caption: 'The same viewer before and after a `theme:` block: default on the left, themed on the right.',
  }
);

export const licence = `Licensed under [CC BY 4.0](${CC_BY}).`;

export function byId(ids) {
  if (!ids?.length) return shots;
  const found = shots.filter((s) => ids.includes(s.id));
  const missing = ids.filter((id) => !shots.some((s) => s.id === id));
  if (missing.length) {
    throw new Error(
      `unknown shot id(s): ${missing.join(', ')}\nknown: ${shots.map((s) => s.id).join(', ')}`
    );
  }
  return found;
}

export const OUT_DIR = 'docs/src/assets/screenshots';
/** Where a shot's image lands. Most go to the docs asset pipeline; a shot may
 *  override `out` when something outside Astro consumes it (the README image is
 *  resolved by GitHub and npm, not by the site build). */
export const outPath = (id) => {
  const shot = shots.find((s) => s.id === id);
  return shot?.out ?? `${OUT_DIR}/${id}.png`;
};
