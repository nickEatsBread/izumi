import { langsEqual, normalizeLang } from '$lib/stremio/sublang'
import { pickSubtitleTrackId } from './track-policy'
import type { DrmAudioChoice, DrmSubtitle, StreamDrm } from './drm'

/** How long the first encrypted load may wait for sidecar/hardsub catalog. The
 *  overlay spinner is already up; waiting here avoids a second Shaka load. */
export const DRM_CATALOG_WAIT_MS = 4_000

/** Burned-in subs are a different MPD. Auto-reloading after the first Shaka load
 *  is what made the overlay clock bounce 0 → duration → 0 → duration. The first
 *  load waits for the catalog instead. */
export function shouldAutoReloadHardsub(_state: {
  preferredId: number | 'no' | undefined
  switchIdMin: number
  skipHardReload?: boolean
  playbackStarted?: boolean
}): boolean {
  return false
}

/** Resolve a source catalog if it arrives quickly; otherwise continue with what
 *  the first stream object already had so Shaka can start. */
export async function waitForCatalog<T>(catalog: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      catalog,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs)
      }),
    ])
  } catch {
    return undefined
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function withManifestQuery(target: string, extra: Record<string, string | undefined>): string {
  const next = new URL(target)
  for (const [key, value] of Object.entries(extra)) {
    if (value) next.searchParams.set(key, value)
    else next.searchParams.delete(key)
  }
  return next.toString()
}

/** Hint for a DASH source: this load is a full store, not ABR playback. */
export function offlineManifestUrl(target: string, preferredHeight?: number): string {
  return withManifestQuery(target, {
    offline: '1',
    height: preferredHeight && Number.isFinite(preferredHeight) ? String(preferredHeight) : undefined,
  })
}

export function downloadAudioLang(
  downloadAudio: 'any' | 'sub' | 'dub' | undefined,
  preferredAudio: string[],
): string[] {
  if (downloadAudio === 'dub') return ['eng']
  if (downloadAudio === 'sub') return ['jpn']
  return preferredAudio
}

function asSubtitle(track: DrmSubtitle & { language?: string }): DrmSubtitle {
  return {
    url: track.url,
    lang: track.lang ?? track.language,
    title: track.title,
    isDefault: track.isDefault,
    kind: track.kind,
    switchUrl: track.switchUrl,
  }
}

function asAudio(track: DrmAudioChoice & { language?: string }): DrmAudioChoice {
  return {
    lang: track.lang ?? track.language,
    title: track.title,
    switchUrl: track.switchUrl,
  }
}

/** Fetch the provider's post-materialize catalog (`refreshUrl` or `/source`). Encrypted
 *  sources often omit sidecar/hardsub lists on the first resolve. */
export async function refreshDrmSource(
  drm: StreamDrm | undefined,
  url: string,
): Promise<{ audioLang?: string; subtitles?: DrmSubtitle[]; audioTracks?: DrmAudioChoice[] }> {
  const meta = drm?.refreshUrl || url.replace(/\/manifest\.[^/?]+(?:\?.*)?$/, '/source')
  if (!meta || meta === url) return {}
  try {
    const response = await fetch(meta)
    if (!response.ok) return {}
    const src = await response.json() as {
      audioLang?: string
      subtitles?: Array<DrmSubtitle & { language?: string }>
      audioTracks?: Array<DrmAudioChoice & { language?: string }>
    }
    return {
      audioLang: typeof src.audioLang === 'string' ? src.audioLang : undefined,
      subtitles: Array.isArray(src.subtitles) ? src.subtitles.map(asSubtitle) : undefined,
      audioTracks: Array.isArray(src.audioTracks) ? src.audioTracks.map(asAudio) : undefined,
    }
  } catch {
    return {}
  }
}

/** Pick the encrypted presentation that matches the user's audio/subtitle prefs.
 *  Alternate audio and burned-in subs are separate manifests (`switchUrl`), not muxed tracks. */
export function preferredDrmPresentation(input: {
  url: string
  audioLang?: string
  subtitles?: DrmSubtitle[]
  audioTracks?: DrmAudioChoice[]
  /** Audio languages, most wanted first. */
  preferredAudio: string[]
  /** Subtitle languages, most wanted first; `['none']` = off. */
  preferredSub: string[]
  switchAudio?: boolean
}): { url: string; audioLang?: string; subtitles: DrmSubtitle[] } {
  let url = input.url
  let audioLang = input.audioLang
  if (input.switchAudio !== false) {
    // Alternate audio is a separate manifest. Walk the wanted languages: the current audio stops the
    // walk, the first other language with a manifest is switched to.
    for (const lang of input.preferredAudio) {
      if (langsEqual(audioLang, lang)) break
      const audio = (input.audioTracks ?? []).find((track) => track.switchUrl && langsEqual(track.lang, lang))
      if (audio?.switchUrl) {
        url = audio.switchUrl
        audioLang = audio.lang ?? audioLang
        break
      }
    }
  }

  const choices = (input.subtitles ?? []).map((track, id) => ({
    id,
    type: track.kind === 'captions' ? 'caption' : 'sub',
    lang: track.lang,
    title: track.title,
    switchUrl: track.switchUrl,
  }))
  const picked = pickSubtitleTrackId(choices, audioLang ?? input.preferredAudio[0], input.preferredSub)
  if (picked === 'no' || typeof picked !== 'number') {
    return { url: withManifestQuery(url, { hard: undefined }), audioLang, subtitles: [] }
  }
  const selected = input.subtitles?.[picked]
  if (selected?.switchUrl) {
    const audio = new URL(url).searchParams.get('audio') || undefined
    return {
      url: withManifestQuery(selected.switchUrl, { audio }),
      audioLang,
      subtitles: [],
    }
  }
  return {
    url: withManifestQuery(url, { hard: undefined }),
    audioLang,
    subtitles: selected ? [selected] : [],
  }
}

export function selectOfflineTracks(
  tracks: Array<Record<string, any>>,
  resolution: { preferredHeight?: number; audioLang?: string; preferredSubLang?: string | string[] },
): Array<Record<string, any>> {
  const variants = tracks.filter((track) => track.type === 'variant')
  const target = resolution.preferredHeight ?? Number.POSITIVE_INFINITY
  const under = variants.filter((track) => !track.height || track.height <= target)
  const pool = under.length ? under : variants
  const language = resolution.audioLang?.toLowerCase()
  const languagePool = language
    ? pool.filter((track) => {
      const trackLang = String(track.language ?? '').toLowerCase()
      return trackLang === language || normalizeLang(track.language) === normalizeLang(resolution.audioLang)
    })
    : []
  const best = [...(languagePool.length ? languagePool : pool)].sort((a, b) =>
    (Number(b.height) || 0) - (Number(a.height) || 0)
    || (Number(b.bandwidth) || 0) - (Number(a.bandwidth) || 0),
  )[0]
  const texts = tracks.filter((track) => track.type === 'text')
  // A single code is what an older resolution carried.
  const preferred = typeof resolution.preferredSubLang === 'string' ? [resolution.preferredSubLang] : resolution.preferredSubLang ?? []
  // Keep the first wanted language the manifest carries; none of them (or no order) keeps every text track.
  const wanted = preferred.map((lang) => texts.filter((track) => langsEqual(String(track.language ?? ''), lang)))
    .find((matches) => matches.length)
  const keptTexts = preferred[0] === 'none' ? [] : wanted ?? texts
  return [...(best ? [best] : []), ...keptTexts]
}
