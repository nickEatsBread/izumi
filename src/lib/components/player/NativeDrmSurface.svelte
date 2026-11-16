<script lang="ts">
  // Protected stream on Linux: izumi's own player plays it (src-tauri/src/widevine). This component
  // only does what is specific to protected sources — wait for the source's catalog (which mints the
  // play token), pick the presentation (dub / burned-in subtitles), hand the manifest and licence
  // URL to `player_embed`, switch presentations, show the source's preview images and release the
  // play token. Everything else is the ordinary mpv player.
  import { onDestroy, untrack } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { get } from 'svelte/store'
  import { preferredAudioLang, preferredSubLang } from '$lib/settings/ui'
  import { DRM_CATALOG_WAIT_MS, preferredDrmPresentation, waitForCatalog, withManifestQuery } from '$lib/player/preferred-drm'
  import { playerNotice } from '$lib/player/session'
  import { langsEqual, normalizeLang } from '$lib/stremio/sublang'
  import { listenSafe } from '$lib/util/listen'
  import {
    BifPreviews,
    NATIVE_SWITCH_ID,
    NOT_INSTALLED,
    setNativeDrm,
    type NativeDrmSession,
    type NativeQuality,
  } from '$lib/player/native-drm'
  import type { DrmAudioChoice, DrmSubtitle, DrmTrack, StreamDrm } from '$lib/player/drm'
  import { moduleOnItsWay, refreshModules, waitForModule } from '$lib/modules/modules'
  import WidevineConsent from './WidevineConsent.svelte'
  import ModuleWait from './ModuleWait.svelte'

  let {
    url,
    drm,
    startSeconds = 0,
    subtitles = [],
    audioLang = '',
    audioChoices = [],
    previewUrl = '',
    onclose,
  }: {
    url: string
    drm: StreamDrm
    startSeconds?: number
    subtitles?: DrmSubtitle[]
    audioLang?: string
    audioChoices?: DrmAudioChoice[]
    previewUrl?: string
    onclose?: () => void
  } = $props()

  const HARD_ID = NATIVE_SWITCH_ID + 1_000

  let liveSubs: DrmSubtitle[] = []
  let liveAudio: DrmAudioChoice[] = []
  let liveAudioLang = ''
  let previews: BifPreviews | null = null
  let activeManifest = ''
  let pos = 0
  let qualityMode: 'auto' | number = 'auto'
  let activeHeight = 0
  let heights: number[] = []
  let videoPath: 'module' | 'hardware' | '' = ''
  // After the module refused a sample once, later reloads (dub, quality) stay on its decoder.
  let moduleOnly = false
  let loadGen = 0
  let embedding = false
  let pendingSid: string | null = null
  let activeRelease = ''
  const released = new Set<string>()
  let consent = $state(false)
  let waitingForConsent: ((ok: boolean) => void) | null = null
  // A pack already asked for the module and it is still downloading: wait instead of asking.
  let moduleWait = $state(false)
  let moduleWaitAbort: AbortController | null = null

  function release(target: string) {
    if (!target || released.has(target)) return
    released.add(target)
    void fetch(target, { method: 'DELETE', keepalive: true }).catch(() => {})
  }

  function manifestParam(name: string): string {
    try { return new URL(activeManifest || url).searchParams.get(name) ?? '' }
    catch { return '' }
  }

  function hardTracks(): DrmSubtitle[] {
    return liveSubs.filter((t) => t.switchUrl && t.kind !== 'captions')
  }

  async function refreshCatalog(): Promise<void> {
    const meta = drm.refreshUrl || url.replace(/\/manifest\.[^/?]+(?:\?.*)?$/, '/source')
    if (!meta || meta === url) return
    try {
      const res = await fetch(meta)
      if (!res.ok) return
      const src = await res.json() as {
        audioLang?: string
        subtitles?: Array<DrmSubtitle & { language?: string }>
        audioTracks?: Array<DrmAudioChoice & { language?: string }>
        previewUrl?: string
      }
      if (typeof src.audioLang === 'string') liveAudioLang = src.audioLang
      if (typeof src.previewUrl === 'string' && src.previewUrl) setPreviews(src.previewUrl)
      if (Array.isArray(src.subtitles)) {
        liveSubs = src.subtitles.map((t) => ({ url: t.url, lang: t.lang ?? t.language, title: t.title, isDefault: t.isDefault, kind: t.kind, switchUrl: t.switchUrl }))
      }
      if (Array.isArray(src.audioTracks)) {
        liveAudio = src.audioTracks.map((t) => ({ lang: t.lang ?? t.language, title: t.title, switchUrl: t.switchUrl }))
      }
    } catch { /* keep what the stream object carried */ }
  }

  function setPreviews(src: string) {
    if (!src) return
    previews?.dispose()
    previews = new BifPreviews(src)
    previews.warm()
  }

  /** Waits for the user to download and accept the module; false if they decline. */
  function askForModule(): Promise<boolean> {
    consent = true
    return new Promise((resolve) => { waitingForConsent = resolve })
  }

  function finishConsent(ok: boolean) {
    consent = false
    const resolve = waitingForConsent
    waitingForConsent = null
    resolve?.(ok)
  }

  /** Waits for the background download; false if the user closes the player first. */
  async function waitForBackgroundModule(): Promise<boolean> {
    moduleWaitAbort?.abort()
    const abort = new AbortController()
    moduleWaitAbort = abort
    moduleWait = true
    try {
      return await waitForModule('widevine', abort.signal)
    } finally {
      if (moduleWaitAbort === abort) {
        moduleWait = false
        moduleWaitAbort = null
      }
    }
  }

  async function embed(manifest: string, start: number, videoMode?: 'module'): Promise<boolean> {
    const gen = loadGen
    embedding = true
    let hard = ''
    try { hard = new URL(manifest).searchParams.get('hard') ?? '' } catch { /* plain URL */ }
    const preferredSub = get(preferredSubLang)
    const pick = preferredDrmPresentation({
      url: manifest,
      audioLang: liveAudioLang || audioLang,
      subtitles: liveSubs,
      audioTracks: liveAudio,
      preferredAudio: get(preferredAudioLang),
      preferredSub,
      switchAudio: false,
    })
    const chosen = hard ? undefined : pick.subtitles[0]?.url
    const soft = liveSubs.filter((t) => t.url && !t.switchUrl).map((t) => ({
      url: t.url,
      lang: normalizeLang(t.lang) ?? undefined,
      title: t.kind === 'captions' ? `${t.title || t.lang || 'Captions'} (CC)` : t.title || t.lang || undefined,
      isDefault: !!chosen && t.url === chosen,
    }))
    try {
      const prepared = await invoke<{ mode: string; height: number; heights: number[] } | null>('player_embed', {
        url: manifest,
        startSeconds: start > 0 ? start : undefined,
        autoplay: true,
        initialBufferSeconds: 0.5,
        alang: get(preferredAudioLang),
        // A burned-in presentation must not also show a soft track on top.
        slang: hard ? 'none' : preferredSub,
        subtitles: soft.length ? soft : undefined,
        drm: {
          keySystem: drm.keySystem,
          licenseUrl: drm.licenseUrl,
          licenseHeaders: drm.licenseHeaders,
          serverCertificateUrl: drm.serverCertificateUrl,
          maxHeight: qualityMode === 'auto' ? undefined : qualityMode,
          videoMode: videoMode ?? (moduleOnly ? 'module' : undefined),
        },
      })
      if (gen !== loadGen) return false
      activeManifest = manifest
      if (prepared) {
        videoPath = prepared.mode === 'hardware' ? 'hardware' : 'module'
        activeHeight = prepared.height
        heights = prepared.heights.filter((h) => h >= 240)
        emitQuality()
      }
      return true
    } catch (e) {
      if (gen !== loadGen) return false
      const message = String(e)
      if (message.includes(NOT_INSTALLED)) {
        const onItsWay = moduleOnItsWay((await refreshModules()).widevine)
        if (gen !== loadGen) return false
        if (onItsWay) {
          if (await waitForBackgroundModule()) return embed(manifest, start, videoMode)
          onclose?.()
          return false
        }
        if (await askForModule()) return embed(manifest, start, videoMode)
        playerNotice.set('Protected video needs the Widevine module')
        onclose?.()
        return false
      }
      console.warn('[drm] native playback failed', e)
      playerNotice.set(`Protected video could not play: ${message.replace(/^Error:\s*/, '')}`)
      return false
    } finally {
      if (gen === loadGen) embedding = false
    }
  }

  function switchTo(manifest: string, afterSid: string | null = null) {
    if (embedding || manifest === activeManifest) return
    pendingSid = afterSid
    void embed(manifest, pos)
  }

  function quality(): NativeQuality {
    return { mode: qualityMode, activeHeight, heights }
  }

  function emitQuality() {
    window.dispatchEvent(new CustomEvent('izumi-drm-quality', { detail: quality() }))
  }

  const session: NativeDrmSession = {
    thumbnail: async (time) => (previews ? previews.at(time) : null),
    ownsAudioMenu: () => liveAudio.length > 1,
    switchTracks() {
      const tracks: DrmTrack[] = []
      if (liveAudio.length > 1) {
        const current = manifestParam('audio') || liveAudioLang || audioLang
        liveAudio.forEach((t, i) => tracks.push({
          id: NATIVE_SWITCH_ID + i,
          type: 'audio',
          lang: t.lang,
          title: t.title,
          selected: langsEqual(t.lang, current) || (!current && i === 0),
          switchUrl: t.switchUrl,
        }))
        if (tracks.length && !tracks.some((t) => t.selected)) tracks[0]!.selected = true
      }
      const hard = manifestParam('hard')
      hardTracks().forEach((t, i) => tracks.push({
        id: HARD_ID + i,
        type: 'sub',
        lang: t.lang,
        // The menu prefixes the language name, so the title only says what kind of track it is.
        title: t.title ? `${t.title} (burned in)` : 'Burned in',
        selected: !!hard && langsEqual(t.lang, hard),
        switchUrl: t.switchUrl,
      }))
      return tracks
    },
    select(property, value) {
      const id = Number(value)
      const hard = manifestParam('hard')
      if (property === 'aid') {
        if (!Number.isFinite(id) || id < NATIVE_SWITCH_ID || id >= HARD_ID) return false
        const choice = liveAudio[id - NATIVE_SWITCH_ID]
        if (!choice?.switchUrl) return true
        switchTo(withManifestQuery(choice.switchUrl, { hard: hard || undefined }))
        return true
      }
      if (Number.isFinite(id) && id >= HARD_ID) {
        const choice = hardTracks()[id - HARD_ID]
        if (choice?.switchUrl) switchTo(withManifestQuery(choice.switchUrl, { audio: manifestParam('audio') || undefined }))
        return true
      }
      // A soft track (or Off) while a burned-in presentation plays: go back to the clean one.
      if (hard) {
        switchTo(withManifestQuery(activeManifest || url, { hard: undefined }), value === 'no' ? 'no' : value)
        return true
      }
      return false
    },
    quality,
    setQuality(mode) {
      const next = mode === 'auto' ? 'auto' : Number(String(mode).replace(/p$/i, ''))
      if (next !== 'auto' && (!Number.isFinite(next) || !heights.includes(next))) return
      if (next === qualityMode) return
      qualityMode = next
      emitQuality()
      const target = activeManifest || url
      activeManifest = ''
      void embed(target, pos)
    },
  }

  async function load() {
    const gen = ++loadGen
    moduleOnly = false
    liveSubs = subtitles
    liveAudio = audioChoices
    liveAudioLang = audioLang
    activeManifest = ''
    heights = []
    activeHeight = 0
    setPreviews(previewUrl)
    setNativeDrm(session)
    if (activeRelease && activeRelease !== (drm.releaseUrl ?? '')) release(activeRelease)
    activeRelease = drm.releaseUrl ?? ''
    // The catalog refresh mints the play token on sources that defer it; wait briefly so the first
    // load is already the preferred presentation.
    await waitForCatalog(refreshCatalog(), DRM_CATALOG_WAIT_MS)
    if (gen !== loadGen) return
    const initial = preferredDrmPresentation({
      url,
      audioLang: liveAudioLang || audioLang,
      subtitles: liveSubs,
      audioTracks: liveAudio,
      preferredAudio: get(preferredAudioLang),
      preferredSub: get(preferredSubLang),
      switchAudio: false,
    }).url
    if (!(await embed(initial, startSeconds)) && gen === loadGen && initial !== url && new URL(initial).searchParams.get('hard')) {
      // A burned-in presentation that will not open falls back to the clean one.
      await embed(withManifestQuery(initial, { hard: undefined }), startSeconds)
    }
  }

  $effect(() => {
    void url
    void drm.licenseUrl
    untrack(() => { void load() })
  })

  $effect(() => listenSafe<[number, number]>('player-progress', ({ payload }) => {
    pos = payload[0]
  }))
  $effect(() => listenSafe<string>('player-file-loaded', ({ payload }) => {
    if (!payload.startsWith('izcr://') || pendingSid == null) return
    const sid = pendingSid
    pendingSid = null
    void invoke('player_command', { name: 'set', args: ['sid', sid] }).catch(() => {})
  }))
  // The hardware path met a sample the module will not release: continue with its own decoder.
  $effect(() => listenSafe('player-drm-video-refused', () => {
    // A late refusal from the hardware stream being replaced must not reload again.
    if (videoPath !== 'hardware') return
    videoPath = 'module'
    moduleOnly = true
    const target = activeManifest || url
    activeManifest = ''
    void embed(target, pos, 'module')
  }))
  $effect(() => listenSafe<string>('player-load-error', ({ payload }) => {
    if (payload.startsWith('izcr://')) playerNotice.set('Protected video stopped: the stream could not be read')
  }))

  onDestroy(() => {
    loadGen++
    setNativeDrm(null)
    finishConsent(false)
    moduleWaitAbort?.abort()
    previews?.dispose()
    previews = null
    release(activeRelease)
  })
</script>

{#if consent}
  <WidevineConsent onaccepted={() => finishConsent(true)} ondeclined={() => finishConsent(false)} />
{:else if moduleWait}
  <ModuleWait id="widevine" onclose={() => moduleWaitAbort?.abort()} />
{/if}
