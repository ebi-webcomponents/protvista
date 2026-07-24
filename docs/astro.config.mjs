import { readFile } from 'node:fs/promises';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

// The playground page imports the framework-free component, which does
// `import icon from './icons/x.svg'` and hands the result straight to lit's
// `unsafeHTML` — the library's own Vite build inlines those as raw SVG
// *strings* (vite-plugin-svgo). Astro instead resolves an `.svg` import to an
// image-metadata object, which `unsafeHTML` rejects. This pre-load hook inlines
// just the library's own `src/icons/*.svg` as default-exported strings so the
// icons render. Scoped to that one directory so it never touches Astro's own
// asset handling; if it ever fails to win over Astro's resolver the component's
// `inlineSvg` guard still keeps a non-string from crashing the viewer.
function inlineLibIcons() {
  return {
    name: 'protvista-inline-lib-icons',
    enforce: 'pre',
    async load(id) {
      const path = id.split('?')[0];
      if (path.endsWith('.svg') && path.includes('/src/icons/')) {
        const source = await readFile(path, 'utf-8');
        return `export default ${JSON.stringify(source)};`;
      }
      return null;
    },
  };
}

// ProtVista documentation site (Astro + Starlight).
//
// Astro is rooted at `docs/` (via `astro <cmd> --root docs` in package.json) so
// its `src/` does not collide with the library `src/` at the repo root. The
// whole site — docs and the native /playground page — builds into the repo-root
// `site/` directory. The only separate step is the tiny Lighthouse harness
// (bench.html), which `vite.bench.config.mjs` merges into the same `site/`
// afterwards (`emptyOutDir: false`); everything user-facing is one `astro build`.
//
// Deployed at https://ebi-webcomponents.github.io/protvista/ (matches the
// `$schema` URL in src/default-config.yaml). Confirm before merging.
export default defineConfig({
  site: 'https://ebi-webcomponents.github.io',
  base: '/protvista',
  outDir: '../site',
  // The playground is a full-screen app view; the dev-only Astro toolbar (the
  // bottom Inspect/Audit/Settings bar) just clutters it. Off everywhere — it
  // never ships in the production build regardless.
  devToolbar: { enabled: false },
  // The native /playground page (docs/src/pages/playground.astro) imports the
  // library source (the component + playground modules) from the repo root at
  // `../../../src`, which is outside Astro's project root (docs/). Allow it.
  vite: {
    plugins: [inlineLibIcons()],
    server: { fs: { allow: ['..'] } },
    // Pre-bundle the playground page's heavy client-side deps at server start.
    // Otherwise Vite discovers them mid-load on the first open of /playground
    // (its script pulls the whole component graph), re-optimizes, and 504s the
    // in-flight requests ("Outdated Optimize Dep"). Listing the top-level deps
    // trades a slightly slower cold start for no re-optimize churn.
    optimizeDeps: {
      include: [
        'lit',
        'lit/decorators.js',
        'lit/directives/unsafe-html.js',
        'timing-functions',
        'color-hash',
        'lodash-es',
        'ajv',
        'js-yaml',
        '@floating-ui/dom',
        'codemirror',
        '@codemirror/state',
        '@codemirror/lang-yaml',
        '@codemirror/lang-json',
        '@codemirror/lint',
        '@nightingale-elements/nightingale-colored-sequence',
        '@nightingale-elements/nightingale-filter',
        '@nightingale-elements/nightingale-linegraph-track',
        '@nightingale-elements/nightingale-manager',
        '@nightingale-elements/nightingale-navigation',
        '@nightingale-elements/nightingale-sequence',
        '@nightingale-elements/nightingale-sequence-heatmap',
        '@nightingale-elements/nightingale-structure',
        '@nightingale-elements/nightingale-track-canvas',
        '@nightingale-elements/nightingale-variation-canvas',
      ],
    },
  },
  integrations: [
    // Renders ```mermaid fenced blocks as diagrams (e.g. the one in
    // configuration-vs-data). Must precede starlight. Requires the
    // `astro-mermaid` + `mermaid` packages.
    mermaid({ theme: 'default' }),
    starlight({
      title: 'ProtVista',
      description:
        'Embed an interactive protein feature viewer and load your own data — no framework required.',
      // Keeps the splash home's three hero buttons on one row (see the file).
      customCss: ['./src/styles/hero.css'],
      // Serve the site favicon (docs/public/favicon.svg → /protvista/favicon.svg).
      // Written base-absolute because Astro does not prefix `base` onto head hrefs.
      head: [
        {
          tag: 'link',
          attrs: {
            rel: 'icon',
            href: '/protvista/favicon.svg',
            type: 'image/svg+xml',
          },
        },
      ],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/ebi-webcomponents/protvista',
        },
      ],
      // The playground is a full-screen, framework-free Astro page (not a
      // Starlight doc), linked from the top nav.
      // Sidebar links are page slugs; pages land under src/content/docs/.
      sidebar: [
        // The playground is a separate full-screen Astro page (not a doc);
        // link to it from the top of the sidebar. Starlight prepends the base.
        { label: 'Playground ↗', link: '/playground/' },
        {
          label: 'Getting started',
          items: [
            { label: 'Overview', link: '/overview' },
            { label: 'Embed the viewer', link: '/embed' },
            { label: 'Author a config', link: '/configure' },
          ],
        },
        {
          label: 'How-to guides',
          items: [
            { label: 'Load your own data', link: '/your-data' },
            { label: 'Theme the viewer', link: '/theming' },
            { label: 'Author tooltips', link: '/data-tooltip' },
            { label: 'Rich tooltips in React', link: '/react-integration' },
            { label: 'Troubleshoot errors', link: '/troubleshooting' },
            { label: 'Escape hatches', link: '/escape-hatches' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Built-in track kinds', link: '/track-kinds' },
            { label: 'Adapter reference', link: '/adapter-reference' },
          ],
        },
        {
          label: 'Explanation',
          items: [
            { label: 'Configuration vs data', link: '/configuration-vs-data' },
          ],
        },
      ],
    }),
  ],
});
