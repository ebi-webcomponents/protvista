import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

// The playground page imports the framework-free component, which does
// `import icon from './icons/x.svg'` and hands the result straight to lit's
// `unsafeHTML` — the library's own Vite build inlines those as raw SVG
// *strings* (vite-plugin-svgo). Astro instead resolves an `.svg` import to an
// image-metadata *object*, which `unsafeHTML` rejects (the component's
// `inlineSvg` guard then degrades it to '' — a blank icon).
//
// Redirect just the library's own `src/icons/*.svg` imports, at resolve time,
// to Vite's built-in `?raw` loader — a reliable default-export string that is
// exempt from Astro's asset pipeline — so the raw SVG reaches `unsafeHTML` and
// the icons render. Doing this in `resolveId` (not `load`) intercepts the
// specifier before Astro's asset resolver ever sees a bare `.svg` to claim,
// which the previous `load`-hook approach did not reliably win. Scoped to that
// one directory so it never touches Astro's own asset handling.
function inlineLibIcons() {
  return {
    name: 'protvista-inline-lib-icons',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!source.endsWith('.svg')) return null;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (!resolved) return null;
      // Normalise separators so the match holds on Windows (backslash paths)
      // as well as POSIX; otherwise icons silently aren't inlined on Windows.
      const path = resolved.id.split('?')[0].replace(/\\/g, '/');
      if (path.includes('/src/icons/')) return `${resolved.id}?raw`;
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
      // Every page states which version it documents, as a chip beside the
      // social icons in the header. Starlight has no slot there, so the chip
      // rides on a `SocialIcons` override that reproduces the default markup.
      // See the component for why it exists and why it is not a banner.
      components: {
        SocialIcons: './src/components/SocialIcons.astro',
      },
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
        // A single link to the blog index, which lists every post. Keeping the
        // sidebar to one entry means a new post needs no config change — only
        // a line in blog/index.md.
        { label: 'Blog', link: '/blog/' },
        { label: 'Webinar', link: '/webinar' },
        {
          label: 'Getting started',
          items: [
            { label: 'Overview', link: '/overview' },
            { label: 'Tutorial', link: '/tutorial' },
            { label: 'Embed the viewer', link: '/embed' },
            { label: 'Author a config', link: '/configure' },
          ],
        },
        {
          label: 'How-to guides',
          items: [
            { label: 'Load your own data', link: '/your-data' },
            { label: 'Theme the viewer', link: '/theming' },
            { label: 'Customize the layout', link: '/customize-layout' },
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
