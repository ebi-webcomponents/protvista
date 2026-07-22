import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import envCompatible from 'vite-plugin-env-compatible';
import { createHtmlPlugin } from 'vite-plugin-html';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
import svg from 'vite-plugin-svgo';

const entry = (file) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  plugins: [
    viteCommonjs(),
    envCompatible(),
    createHtmlPlugin({
      inject: {
        data: {
          title: 'protvista-uniprot',
        },
      },
    }),
    svg(),
  ],
  base: './',
  build: {
    target: 'ES2021',
    outDir: 'demo',
    rollupOptions: {
      // Multi-page Pages site published from `demo/`:
      //   index.html      → landing hub
      //   playground.html → interactive config playground (#210)
      //   demo.html       → the human-facing accession demo (?accession=)
      //   bench.html      → minimal Lighthouse harness (bench/lighthouserc.cjs)
      input: {
        main: entry('index.html'),
        playground: entry('playground.html'),
        demo: entry('demo.html'),
        bench: entry('bench.html'),
      },
    },
  },
});
