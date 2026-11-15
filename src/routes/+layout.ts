// Tauri doesn't have a Node.js server to do proper SSR
// so we use adapter-static with a fallback to index.html to put the site in SPA mode
// See: https://svelte.dev/docs/kit/single-page-apps
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
export const ssr = false;

// Hydrate before routes mount or start reconciliation/sync. An empty loading store must never
// overwrite a real library, and every route (including direct deep links) needs the same barrier.
export async function load() {
  // Linux, first CEF launch: take in the profile the last WebKitGTK release left behind, then
  // start over so every store reads it.
  const { importEngineMigration } = await import('$lib/engine-migration')
  const migrated = await importEngineMigration(localStorage).catch((error) => {
    console.error('[engine-migration]', error)
    return false
  })
  if (migrated) {
    location.reload()
    return new Promise<never>(() => {})
  }
  const [{ durableHistory }, { localLibrary }] = await Promise.all([
    import('$lib/player/history'), import('$lib/library/local-lists'),
  ])
  await Promise.all([durableHistory.ready, localLibrary.ready])
  return {}
}
