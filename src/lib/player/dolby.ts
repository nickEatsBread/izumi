import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core'
import { get, writable } from 'svelte/store'
import {
  audioExclusive,
  audioOutputDevice,
  audioOutputMode,
  audioPassthroughAc3,
  audioPassthroughEac3,
  audioPassthroughTruehd,
  audioPassthroughDts,
  audioPassthroughDtsHd,
  audioProcessing,
  dolbyVisionOutputMode,
  rawMpvOptions,
  videoQualityPreset,
  type AudioOutputMode,
  type DolbyVisionOutputMode,
} from '$lib/settings/ui'
import { userFilterChains } from './quality'

export type CapabilityConfidence = 'reported' | 'inferred' | 'unknown'

export interface DolbyCapabilities {
  platform: string
  engine: string
  mpvVersion: string
  audioConfidence: CapabilityConfidence
  audio: {
    ac3: boolean
    eac3: boolean
    eac3Joc: boolean
    truehd: boolean
    mat: boolean
    dts: boolean
    dtsHd: boolean
    dtsHdMa: boolean
    dtsX: boolean
  }
  audioDevices: { id: string; name: string; encodings?: string[]; selectable?: boolean }[]
  receiverDetected: boolean
  recommendedAudioDevice: string
  displays: {
    id: string
    name: string
    connection: string
    hdrSupported: boolean | null
    hdrEnabled: boolean | null
    bitsPerColor: number | null
    maxLuminance?: number | null
    source: 'os' | 'driver' | 'inferred'
  }[]
  video: {
    hdr10Display: boolean
    hdr10PlusDisplay: boolean
    hlgDisplay: boolean
    dolbyVisionDisplay: boolean
    dolbyVisionDecoder: boolean
    dolbyVisionNativePath: boolean
    hdr10PlusNativePath: boolean
    hlgNativePath: boolean
    nativeHdrType: string
    dolbyVisionAwareRenderer: boolean
  }
  codecs: {
    dolbyVisionProfiles: string[]
    hevcMain10: boolean
    av1Main10: boolean
    vp9Profile2: boolean
    currentCodecString: string
    currentSupported: boolean | null
    currentReason: string
  }
  current: {
    ao: string
    vo: string
    audioDevice: string
    audioCodec: string
    audioFormat: string
    videoFormat: string
    videoProfile: string
    videoPrimaries: string
    videoTransfer: string
  }
  limitations: string[]
}

export const UNKNOWN_DOLBY_CAPABILITIES: DolbyCapabilities = {
  platform: 'unknown',
  engine: 'unknown',
  mpvVersion: '',
  audioConfidence: 'unknown',
  audio: {
    ac3: false, eac3: false, eac3Joc: false, truehd: false, mat: false,
    dts: false, dtsHd: false, dtsHdMa: false, dtsX: false,
  },
  audioDevices: [],
  receiverDetected: false,
  recommendedAudioDevice: '',
  displays: [],
  video: {
    hdr10Display: false,
    hdr10PlusDisplay: false,
    hlgDisplay: false,
    dolbyVisionDisplay: false,
    dolbyVisionDecoder: false,
    dolbyVisionNativePath: false,
    hdr10PlusNativePath: false,
    hlgNativePath: false,
    nativeHdrType: '',
    dolbyVisionAwareRenderer: false,
  },
  codecs: {
    dolbyVisionProfiles: [], hevcMain10: false, av1Main10: false, vp9Profile2: false,
    currentCodecString: '', currentSupported: null, currentReason: '',
  },
  current: {
    ao: '', vo: '', audioDevice: '', audioCodec: '', audioFormat: '',
    videoFormat: '', videoProfile: '', videoPrimaries: '', videoTransfer: '',
  },
  limitations: ['Playback capabilities have not been probed yet.'],
}

export const dolbyCapabilities = writable<DolbyCapabilities>(UNKNOWN_DOLBY_CAPABILITIES)
export const dolbyCapabilityError = writable('')

export interface AudioOutputSettings {
  mode: AudioOutputMode
  device: string
  exclusive: boolean
  ac3: boolean
  eac3: boolean
  truehd: boolean
  dts: boolean
  dtsHd: boolean
  hasAudioFilter: boolean
  playbackSpeed: number
}

export interface AudioPassthroughDecision {
  codecs: string[]
  blockedBy: string[]
  opts: [string, string][]
}

/** Resolve the user-facing transport into mpv options. Optical is intentionally restricted to
 * AC-3 and DTS core; lossless E-AC3/TrueHD/DTS-HD need HDMI/eARC. Auto is conservative when a platform cannot report the
 * routed sink — users can explicitly select HDMI after verifying their receiver. */
export function resolveAudioPassthrough(
  settings: AudioOutputSettings,
  capabilities: DolbyCapabilities = UNKNOWN_DOLBY_CAPABILITIES,
): AudioPassthroughDecision {
  const blockedBy: string[] = []
  if (settings.mode === 'pcm') blockedBy.push('PCM output selected')
  if (settings.hasAudioFilter) blockedBy.push('audio processing/filter is active')
  if (Math.abs(settings.playbackSpeed - 1) > 0.001) blockedBy.push('playback speed is not 1×')

  let codecs: string[] = []
  if (!blockedBy.length) {
    if (settings.mode === 'optical') {
      if (settings.ac3) codecs.push('ac3')
      if (settings.dts) codecs.push('dts')
    } else if (settings.mode === 'hdmi') {
      if (settings.ac3) codecs.push('ac3')
      if (settings.eac3) codecs.push('eac3')
      if (settings.truehd) codecs.push('truehd')
      // mpv's dts-hd selector covers DTS-HD MA and preserves DTS:X carried by its extension.
      if (settings.dtsHd) codecs.push('dts-hd')
      else if (settings.dts) codecs.push('dts')
    } else if (settings.mode === 'auto') {
      if (capabilities.audioConfidence === 'unknown') {
        blockedBy.push('the routed device did not report encoded-audio support')
      } else {
        if (settings.ac3 && capabilities.audio.ac3) codecs.push('ac3')
        if (settings.eac3 && (capabilities.audio.eac3 || capabilities.audio.eac3Joc)) codecs.push('eac3')
        if (settings.truehd && (capabilities.audio.truehd || capabilities.audio.mat)) codecs.push('truehd')
        if (settings.dtsHd && (capabilities.audio.dtsHd || capabilities.audio.dtsHdMa)) {
          codecs.push('dts-hd')
        } else if (settings.dts && capabilities.audio.dts) {
          codecs.push('dts')
        }
      }
    }
  }
  if (!codecs.length && !blockedBy.length) blockedBy.push('no compatible passthrough codecs selected')

  const enabled = codecs.length > 0
  return {
    codecs,
    blockedBy,
    opts: [
      ['audio-device', settings.device.trim() || 'auto'],
      ['audio-exclusive', enabled && settings.exclusive ? 'yes' : 'no'],
      ['audio-spdif', enabled ? codecs.join(',') : ''],
    ],
  }
}

let runtimePlaybackSpeed = 1

/** Encoded IEC-61937 frames cannot be time-stretched. Disable passthrough before leaving 1× and
 * restore the selected policy only after returning to 1×. Player command wrappers await this so
 * an Atmos bitstream is never briefly fed through mpv's speed filter. */
export async function setDolbyPlaybackSpeed(speed: number): Promise<void> {
  const normalized = Number.isFinite(speed) && speed > 0 ? speed : 1
  if (Math.abs(normalized - runtimePlaybackSpeed) <= 0.001) return
  runtimePlaybackSpeed = normalized
  await applyDolbySettings()
}

/** Complete option set so switching modes also clears the target primaries/transfer from the
 * preceding mode. mpv/libplacebo consumes Dolby Vision RPU metadata; these modes describe the
 * display signal Izumi asks it to produce, not Dolby certification. */
export function dolbyVisionOpts(mode: DolbyVisionOutputMode): [string, string][] {
  if (mode === 'hdr10') {
    return [
      ['target-colorspace-hint', 'yes'],
      ['target-colorspace-hint-mode', 'source-dynamic'],
      ['target-prim', 'bt.2020'],
      ['target-trc', 'pq'],
      ['target-peak', '1000'],
    ]
  }
  if (mode === 'sdr') {
    return [
      ['target-colorspace-hint', 'yes'],
      ['target-colorspace-hint-mode', 'source-dynamic'],
      ['target-prim', 'bt.709'],
      ['target-trc', 'bt.1886'],
      ['target-peak', '203'],
    ]
  }
  return [
    ['target-colorspace-hint', 'auto'],
    ['target-colorspace-hint-mode', 'source-dynamic'],
    ['target-prim', 'auto'],
    ['target-trc', 'auto'],
    ['target-peak', 'auto'],
  ]
}

function currentAudioSettings(): AudioOutputSettings {
  const userFilters = userFilterChains(get(videoQualityPreset), get(rawMpvOptions))
  return {
    mode: get(audioOutputMode),
    device: get(audioOutputDevice),
    exclusive: get(audioExclusive),
    ac3: get(audioPassthroughAc3),
    eac3: get(audioPassthroughEac3),
    truehd: get(audioPassthroughTruehd),
    dts: get(audioPassthroughDts),
    dtsHd: get(audioPassthroughDtsHd),
    hasAudioFilter: get(audioProcessing) !== 'off' || !!userFilters.af,
    playbackSpeed: runtimePlaybackSpeed,
  }
}

async function pushDolbyOpts(opts: [string, string][]): Promise<void> {
  try {
    await invoke('player_set_dolby_opts', { opts })
  } catch {
    await invoke('plugin:mpv|mpv_set_dolby_opts', {
      payload: { opts: opts.map(([key, value]) => ({ key, value })) },
    }).catch(() => {})
  }
}

export async function applyDolbySettings(): Promise<AudioPassthroughDecision> {
  const decision = resolveAudioPassthrough(currentAudioSettings(), get(dolbyCapabilities))
  await pushDolbyOpts([...decision.opts, ...dolbyVisionOpts(get(dolbyVisionOutputMode))])
  return decision
}

function normalizeCapabilities(value: Partial<DolbyCapabilities> | null | undefined): DolbyCapabilities {
  return {
    ...UNKNOWN_DOLBY_CAPABILITIES,
    ...value,
    audio: { ...UNKNOWN_DOLBY_CAPABILITIES.audio, ...value?.audio },
    video: { ...UNKNOWN_DOLBY_CAPABILITIES.video, ...value?.video },
    codecs: {
      ...UNKNOWN_DOLBY_CAPABILITIES.codecs,
      ...value?.codecs,
      dolbyVisionProfiles: Array.isArray(value?.codecs?.dolbyVisionProfiles)
        ? value.codecs.dolbyVisionProfiles : [],
    },
    current: { ...UNKNOWN_DOLBY_CAPABILITIES.current, ...value?.current },
    audioDevices: Array.isArray(value?.audioDevices) ? value.audioDevices : [],
    displays: Array.isArray(value?.displays) ? value.displays : [],
    limitations: Array.isArray(value?.limitations) ? value.limitations : [],
  }
}

export async function refreshDolbyCapabilities(): Promise<DolbyCapabilities> {
  try {
    let value: DolbyCapabilities
    try {
      value = await invoke<DolbyCapabilities>('player_dolby_capabilities')
    } catch {
      value = await invoke<DolbyCapabilities>('plugin:mpv|mpv_dolby_capabilities')
    }
    const normalized = normalizeCapabilities(value)
    dolbyCapabilities.set(normalized)
    dolbyCapabilityError.set('')
    return normalized
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dolbyCapabilityError.set(message)
    return get(dolbyCapabilities)
  }
}

let started = false
let androidRouteListener: PluginListener | undefined
/** Probe first so Auto never enables a codec from a filename guess, then keep the complete output
 * policy synchronized. The Android plugin emits another probe request when the routed device
 * changes; polling here also refreshes the live mpv output fields while playback is active. */
export function startDolbySync(): () => void {
  if (started) return () => {}
  started = true
  void refreshDolbyCapabilities().then(() => applyDolbySettings())
  let first = true
  const stores = [
    audioOutputMode, audioOutputDevice, audioExclusive,
    audioPassthroughAc3, audioPassthroughEac3, audioPassthroughTruehd,
    audioPassthroughDts, audioPassthroughDtsHd,
    audioProcessing, videoQualityPreset, rawMpvOptions, dolbyVisionOutputMode,
  ]
  const unsubscribers = stores.map((store) => store.subscribe(() => {
    if (!first) void applyDolbySettings()
  }))
  first = false
  const timer = typeof window === 'undefined' ? undefined : window.setInterval(async () => {
    const before = get(dolbyCapabilities)
    const after = await refreshDolbyCapabilities()
    if (before.audioConfidence !== after.audioConfidence
      || JSON.stringify(before.audio) !== JSON.stringify(after.audio)) {
      await applyDolbySettings()
    }
  }, 10_000)
  if (typeof window !== 'undefined' && !androidRouteListener) {
    void addPluginListener('mpv', 'dolby', async () => {
      const capabilities = await refreshDolbyCapabilities()
      dolbyCapabilities.set(capabilities)
      await applyDolbySettings()
    }).then((listener) => { androidRouteListener = listener }).catch(() => {})
  }
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe()
    if (timer != null) clearInterval(timer)
    const listener = androidRouteListener
    androidRouteListener = undefined
    void listener?.unregister().catch(() => {})
    started = false
  }
}

export type DolbyAudioOutput = 'pcm' | 'ac3' | 'eac3' | 'truehd' | 'dts' | 'dts-hd' | 'unknown'
export type DolbyVideoOutput = 'sdr' | 'hlg' | 'hdr10' | 'hdr10-plus' | 'dolby-vision' | 'unknown'

export function classifyAudioOutput(current: DolbyCapabilities['current']): DolbyAudioOutput {
  const value = `${current.audioFormat} ${current.audioCodec}`.toLowerCase()
  if (/spdif.*dts.?hd|dts.?hd.*spdif/.test(value)) return 'dts-hd'
  if (/spdif.*dts|dts.*spdif/.test(value)) return 'dts'
  if (/spdif.*truehd|truehd.*spdif/.test(value)) return 'truehd'
  if (/spdif.*eac3|eac3.*spdif|e-ac-3.*spdif/.test(value)) return 'eac3'
  if (/spdif.*ac3|ac3.*spdif/.test(value)) return 'ac3'
  // Media3 exposes the source MIME but not whether its internal AudioSink opened an encoded or
  // PCM AudioTrack. Leave this unknown; only the receiver or an explicit sink callback can prove
  // passthrough. libmpv's Android path still reports spdif-* above when it is encoded.
  if (/audiotrack/i.test(current.ao) && /^audio\//i.test(current.audioFormat)) return 'unknown'
  if (value.trim()) return 'pcm'
  return 'unknown'
}

export function classifyVideoOutput(
  current: DolbyCapabilities['current'],
  nativeHdrPath: boolean | string = false,
): DolbyVideoOutput {
  if (nativeHdrPath === 'hdr10-plus') return 'hdr10-plus'
  if (nativeHdrPath === 'hlg') return 'hlg'
  if ((nativeHdrPath === true || nativeHdrPath === 'dolby-vision')
    && /dolby|dovi|dvhe/i.test(`${current.videoFormat} ${current.videoProfile}`)) {
    return 'dolby-vision'
  }
  if (/arib-std-b67|\bhlg\b/i.test(current.videoTransfer)) return 'hlg'
  if (/pq|smpte2084/i.test(current.videoTransfer) && /2020/i.test(current.videoPrimaries)) return 'hdr10'
  if (current.videoTransfer || current.videoPrimaries) return 'sdr'
  return 'unknown'
}
