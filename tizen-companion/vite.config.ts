import { resolve } from 'node:path'
import preact from '@preact/preset-vite'
import legacy from '@vitejs/plugin-legacy'
import autoprefixer from 'autoprefixer'
import { defineConfig } from 'vite'
import { legacyTvCss } from './scripts/legacy-css.ts'

export default defineConfig({
  base: './',
  plugins: [
    preact(),
    legacy({
      targets: ['Safari >= 8', 'Chrome >= 47'],
      additionalLegacyPolyfills: [
        'core-js/modules/web.url.js',
        'core-js/modules/web.url-search-params.js',
      ],
      renderLegacyChunks: true,
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    fs: { allow: [resolve(import.meta.dirname, '..')] },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  css: {
    postcss: {
      plugins: [
        legacyTvCss(),
        autoprefixer({ overrideBrowserslist: ['Safari >= 8', 'Chrome >= 47'] }),
      ],
    },
  },
  build: {
    cssCodeSplit: false,
    // Lightning CSS currently mis-parses the duplicated legacy fallbacks emitted for Tizen 2.3.
    cssMinify: 'esbuild',
    sourcemap: true,
  },
})
