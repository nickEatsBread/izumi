import { persisted } from 'svelte-persisted-store'
// Seed a fresh install with a popular Stremio stream addon so there's something to
// resolve out of the box; users add/remove their own in Settings. Torrentio pairs with
// the debrid key entered in Settings to return cached streams.
export const addonUrls = persisted<string[]>('stremio-addon-urls', ['https://torrentio.strem.fun'])
// Normalize a pasted addon URL to an absolute https base (strip trailing
// /manifest.json). Forcing a scheme matters: a scheme-less base would resolve
// relative to the app page and hit the wrong host.
export const normalizeBase = (u: string) => {
  let s = u.trim().replace(/\/manifest\.json\/?$/i, '').replace(/\/$/, '').replace(/^http:\/\//i, 'https://')
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  return s
}
