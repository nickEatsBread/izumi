// Android self-update. `tauri-plugin-updater` is desktop-only (it hot-swaps the app
// binary, which Android's package model forbids), so on Android we roll our own: ask the
// GitHub Releases API for the latest tag, and if it's newer than the running build,
// download the .apk asset and hand it to the system package installer (which shows its own
// confirmation dialog). Every published APK is signed with the same release key, so Android
// accepts it as an in-place update.
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { writable } from 'svelte/store'
import { hasEmbeddedPlayer } from '$lib/player/android-mpv'

const REPO = 'nickEatsBread/izumi'
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`

export type UpdateInfo = { version: string; notes: string; apkUrl: string }

/** Compare dotted numeric versions. >0 if a is newer than b, 0 equal, <0 older. */
function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

/**
 * Check GitHub for a newer release. Returns the update info if one is available, else null.
 * Never throws — a network error or a malformed response just means "no update".
 */
export async function checkAndroidUpdate(): Promise<UpdateInfo | null> {
  try {
    const current = await getVersion()
    const res = await invoke<{ status: number; body: string }>('http_get', {
      url: LATEST_API,
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (res.status !== 200) return null
    const rel = JSON.parse(res.body) as {
      tag_name?: string
      body?: string
      assets?: { name?: string; browser_download_url?: string }[]
    }
    // Tags may be prefixed (v0.1.1, app-v0.1.1) — strip everything up to the first digit.
    const tag = String(rel.tag_name ?? '').replace(/^[^0-9]*/, '')
    if (!tag || cmpVersion(tag, current) <= 0) return null
    // Fetch the APK matching THIS build's flavor: full (embedded libmpv) vs lite (external player).
    // The full build ships the mpv plugin, so hasEmbeddedPlayer() distinguishes them. Fall back to
    // any .apk for older single-artifact releases.
    const apks = (rel.assets ?? []).filter((a) => String(a.name ?? '').toLowerCase().endsWith('.apk'))
    const suffix = (await hasEmbeddedPlayer()) ? 'full.apk' : 'lite.apk'
    const apk = apks.find((a) => String(a.name ?? '').toLowerCase().endsWith(suffix)) ?? apks[0]
    if (!apk?.browser_download_url) return null
    return { version: tag, notes: String(rel.body ?? ''), apkUrl: apk.browser_download_url }
  } catch {
    return null
  }
}

/** Download the update APK and launch the system installer. Throws on failure. */
export async function downloadAndInstall(info: UpdateInfo): Promise<void> {
  const path = await invoke<string>('updater_download_apk', { url: info.apkUrl })
  await invoke('plugin:extplayer|install_apk', { payload: { path } })
}

/**
 * Shared banner state for an available update (set by the on-launch check, shown by the shell
 * and by Settings). `dismissed` hides the banner for this session without forgetting the info.
 */
export const androidUpdate = writable<UpdateInfo | null>(null)
export const androidUpdateDismissed = writable(false)
