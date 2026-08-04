import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";

// @ts-ignore process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/lib/paraglide",
      strategy: ["localStorage", "preferredLanguage", "baseLocale"],
      emitTsDeclarations: true,
    }),
    sveltekit(),
  ],

  // @lucide/svelte ships a ~3.4KB ISC header in EVERY icon module, which Vite inlines by default:
  // measured at 277KB across the built JS (15.8% of the total), 94KB of it in the /app layout chunk
  // that is parsed before first paint. `external` moves them to sidecar .LEGAL.txt files, which
  // keeps the ISC notice shipped (it is not optional — and lucide has no THIRD-PARTY-NOTICES.md
  // entry to fall back on) while taking the bytes off the boot path. Do NOT use 'none'.
  esbuild: /** @type {import('vite').ESBuildOptions} */ ({ legalComments: "external" }),

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
