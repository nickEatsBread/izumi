import { assToVtt, type DrmSubtitle, type StreamDrm } from '$lib/player/drm'
import { selectOfflineTracks } from '$lib/player/preferred-drm'
import type { SubLang } from '$lib/settings/ui'

interface ShakaResolution {
  url: string
  drm: StreamDrm
  subtitles?: DrmSubtitle[]
  audioLang?: string
  preferredHeight?: number
  preferredSubLang?: SubLang
  filename: string
  provider?: string
}

interface OfflineProgress {
  downloaded: number
  bytes: number
  speed: number
}

interface ActiveJob {
  abort: () => Promise<unknown>
}

const jobs = new Map<string, ActiveJob>()
let serial = Promise.resolve()

function shakaMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error)
  const value = error as { message?: string; code?: number; data?: unknown[] }
  const detail = value.data ? Array.from(value.data).map(String).join(' ') : ''
  return value.message
    || (value.code != null ? `Shaka offline error ${value.code}${detail ? `: ${detail}` : ''}` : String(error))
}

function asDataUrl(text: string, mime: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

/** Chromium may expose persistent Widevine only under the `.experiment` alias. */
function keySystemCandidates(keySystem: string): string[] {
  return keySystem === 'com.widevine.alpha'
    ? ['com.widevine.alpha', 'com.widevine.alpha.experiment']
    : [keySystem]
}

/** Restrict Shaka to the provider's key system. Windows WebView2 supports persistent
 *  PlayReady, so leaving Shaka's default preference in place makes it pick PlayReady,
 *  then fail with 6012 because the source only supplies a Widevine license server. */
export function shakaDrmConfig(drm: StreamDrm, persistentLicense: boolean) {
  const keySystem = drm.keySystem
  const robustness = drm.videoRobustness || 'SW_SECURE_CRYPTO'
  return {
    servers: drm.licenseUrl ? { [keySystem]: drm.licenseUrl } : {},
    advanced: {
      [keySystem]: {
        videoRobustness: [robustness],
        audioRobustness: [drm.audioRobustness || robustness],
        persistentStateRequired: persistentLicense,
        distinctiveIdentifierRequired: false,
      },
    },
    preferredKeySystems: [keySystem],
  }
}

export async function persistentLicenseSupported(drm: StreamDrm): Promise<boolean> {
  const request = globalThis.navigator?.requestMediaKeySystemAccess?.bind(globalThis.navigator)
  if (!request) return false
  const robustness = drm.videoRobustness || 'SW_SECURE_CRYPTO'
  const config: MediaKeySystemConfiguration[] = [{
    initDataTypes: ['cenc'],
    audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"', robustness }],
    videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.640028"', robustness }],
    persistentState: 'required',
    sessionTypes: ['persistent-license'],
  }]
  for (const keySystem of keySystemCandidates(drm.keySystem)) {
    try {
      await request(keySystem, config)
      return true
    } catch { /* try the next CDM alias */ }
  }
  return false
}

async function externalText(tracks: DrmSubtitle[] = []): Promise<Array<Record<string, string>>> {
  const output: Array<Record<string, string>> = []
  for (const track of tracks) {
    if (!track.url || track.switchUrl) continue
    let uri = track.url
    let mime = /\.vtt(?:$|\?)/i.test(uri) ? 'text/vtt' : 'text/plain'
    if (/\.(?:ass|ssa)(?:$|\?)/i.test(uri)) {
      const response = await fetch(uri)
      if (!response.ok) continue
      uri = asDataUrl(assToVtt(await response.text()), 'text/vtt')
      mime = 'text/vtt'
    }
    output.push({
      uri,
      language: track.lang || 'und',
      kind: track.kind === 'captions' ? 'caption' : 'subtitle',
      mime,
      codecs: '',
    })
  }
  return output
}

// Shaka stores protected segments and persistent CDM sessions in IndexedDB. Serialize these jobs:
// providers often grant one live playback lease, and overlapping manifest downloads can invalidate
// each other's lease even when the client itself permits several ordinary file downloads.
export async function storeShakaOffline(
  id: string,
  resolution: ShakaResolution,
  onProgress: (progress: OfflineProgress) => void,
): Promise<{ offlineUri: string; bytes: number; drmKeySystem: string; persistentLicense: boolean }> {
  let unlock!: () => void
  const previous = serial
  serial = new Promise<void>((resolve) => { unlock = resolve })
  await previous
  let storage: any
  try {
    const raw: any = await import('shaka-player')
    const shaka = raw.Player ? raw : raw.default
    shaka.polyfill?.installAll?.()
    if (!shaka.offline?.Storage?.support?.()) {
      throw new Error('Offline adaptive playback is not supported on this device.')
    }
    storage = new shaka.offline.Storage()
    let lastAt = performance.now()
    let lastBytes = 0
    const persistentLicense = await persistentLicenseSupported(resolution.drm)
    console.info('[offline] DRM', resolution.drm.keySystem, { persistentLicense })
    storage.configure({
      drm: shakaDrmConfig(resolution.drm, persistentLicense),
      offline: {
        usePersistentLicense: persistentLicense,
        numberOfParallelDownloads: 4,
        trackSelectionCallback: async (tracks: Array<Record<string, any>>) =>
          selectOfflineTracks(tracks, resolution),
        progressCallback: (content: { size?: number }, progress: number) => {
          const bytes = Math.max(0, Number(content.size) || 0)
          const downloaded = Math.round(bytes * Math.min(1, Math.max(0, progress)))
          const now = performance.now()
          const seconds = Math.max(0.001, (now - lastAt) / 1000)
          const speed = Math.max(0, (downloaded - lastBytes) / seconds)
          lastAt = now
          lastBytes = downloaded
          onProgress({ downloaded, bytes, speed })
        },
      },
    })
    const net = storage.getNetworkingEngine?.()
    net?.registerRequestFilter((type: number, request: { headers: Record<string, string> }) => {
      const LICENSE = shaka.net?.NetworkingEngine?.RequestType?.LICENSE
      if (LICENSE != null && type === LICENSE && resolution.drm.licenseHeaders) {
        Object.assign(request.headers, resolution.drm.licenseHeaders)
      }
    })
    const texts = await externalText(resolution.subtitles)
    const operation = storage.store(
      resolution.url,
      { id, title: resolution.filename, provider: resolution.provider },
      'application/dash+xml',
      [],
      texts,
    )
    jobs.set(id, { abort: () => operation.abort() })
    const content = await operation.promise
    return {
      offlineUri: String(content.offlineUri),
      bytes: Math.max(0, Number(content.size) || lastBytes),
      drmKeySystem: resolution.drm.keySystem,
      persistentLicense,
    }
  } catch (error) {
    const detail = error && typeof error === 'object'
      ? error as { code?: number; data?: unknown[] }
      : {}
    const context = detail.data?.length ? ` (${detail.data.map(String).join(', ')})` : ''
    console.warn('[offline] store failed', JSON.stringify({ code: detail.code, data: detail.data }))
    throw new Error(`${shakaMessage(error)}${context}`)
  } finally {
    jobs.delete(id)
    try { await storage?.destroy?.() } catch { /* release Shaka resources */ }
    if (resolution.drm.releaseUrl) {
      try { await fetch(resolution.drm.releaseUrl, { method: 'DELETE', keepalive: true }) } catch { /* best effort */ }
    }
    unlock()
  }
}

export async function abortShakaOffline(id: string): Promise<void> {
  await jobs.get(id)?.abort().catch(() => {})
}

export async function removeShakaOffline(offlineUri: string): Promise<void> {
  const raw: any = await import('shaka-player')
  const shaka = raw.Player ? raw : raw.default
  const storage = new shaka.offline.Storage()
  try { await storage.remove(offlineUri) } finally { await storage.destroy() }
}
