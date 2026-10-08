import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { invoke } from '@tauri-apps/api/core'
import {
  UNKNOWN_DOLBY_CAPABILITIES,
  classifyAudioOutput,
  classifyVideoOutput,
  dolbyVisionOpts,
  dolbyCapabilities,
  refreshDolbyCapabilities,
  resolveAudioPassthrough,
  type AudioOutputSettings,
  type DolbyCapabilities,
} from './dolby'

// Shared across vi.resetModules so a freshly imported dolby.ts talks to the same mocks.
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), addPluginListener: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, addPluginListener: mocks.addPluginListener }))

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  dolbyCapabilities.set(UNKNOWN_DOLBY_CAPABILITIES)
})

const base: AudioOutputSettings = {
  mode: 'pcm', device: 'auto', exclusive: false,
  ac3: true, eac3: true, truehd: true, hasAudioFilter: false, playbackSpeed: 1,
  dts: true, dtsHd: true,
}

const reported: DolbyCapabilities = {
  ...UNKNOWN_DOLBY_CAPABILITIES,
  platform: 'android',
  audioConfidence: 'reported',
  audio: {
    ac3: true, eac3: true, eac3Joc: true, truehd: false, mat: true,
    dts: true, dtsHd: true, dtsHdMa: true, dtsX: true,
  },
}

describe('Dolby audio output policy', () => {
  it('is PCM and encoded-audio safe by default', () => {
    const decision = resolveAudioPassthrough(base, reported)
    expect(decision.codecs).toEqual([])
    expect(Object.fromEntries(decision.opts)['audio-spdif']).toBe('')
  })

  it('limits optical to AC-3 and DTS core even when every codec is selected', () => {
    expect(resolveAudioPassthrough({ ...base, mode: 'optical' }, reported).codecs).toEqual(['ac3', 'dts'])
  })

  it('allows explicit HDMI E-AC3 and TrueHD passthrough', () => {
    const decision = resolveAudioPassthrough({ ...base, mode: 'hdmi', exclusive: true }, reported)
    expect(decision.codecs).toEqual(['ac3', 'eac3', 'truehd', 'dts-hd'])
    expect(Object.fromEntries(decision.opts)).toMatchObject({
      'audio-spdif': 'ac3,eac3,truehd,dts-hd',
      'audio-exclusive': 'yes',
    })
  })

  it('blocks bitstreaming while any audio filter is active', () => {
    const decision = resolveAudioPassthrough({ ...base, mode: 'hdmi', hasAudioFilter: true }, reported)
    expect(decision.codecs).toEqual([])
    expect(decision.blockedBy.join(' ')).toContain('filter')
  })

  it('blocks Atmos passthrough while playback speed is not 1×', () => {
    const decision = resolveAudioPassthrough({ ...base, mode: 'hdmi', playbackSpeed: 1.25 }, reported)
    expect(decision.codecs).toEqual([])
    expect(decision.blockedBy.join(' ')).toContain('speed')
  })

  it('requires TrueHD specifically rather than a MAT-only route in Auto', () => {
    expect(resolveAudioPassthrough({ ...base, mode: 'auto' }, reported).codecs)
      .toEqual(['ac3', 'eac3', 'dts-hd'])
    expect(resolveAudioPassthrough({ ...base, mode: 'auto' }, {
      ...reported, audio: { ...reported.audio, truehd: true, mat: false },
    }).codecs).toContain('truehd')
    expect(resolveAudioPassthrough({ ...base, mode: 'auto' }, UNKNOWN_DOLBY_CAPABILITIES).codecs)
      .toEqual([])
  })

  it('drops stale receiver formats when both platform probes fail', async () => {
    dolbyCapabilities.set(reported)
    vi.mocked(invoke).mockRejectedValue(new Error('route unavailable'))
    const current = await refreshDolbyCapabilities()
    expect(current.audioConfidence).toBe('unknown')
    expect(current.receiverDetected).toBe(false)
    expect(resolveAudioPassthrough({ ...base, mode: 'auto' }, current).codecs).toEqual([])
  })

  it('does not treat DTS-UHD/DTS:X as mpv DTS-HD capability', () => {
    const dtsUhdOnly: DolbyCapabilities = {
      ...reported,
      audio: { ...reported.audio, dts: false, dtsHd: false, dtsHdMa: false, dtsX: true },
    }
    expect(resolveAudioPassthrough({ ...base, mode: 'auto', ac3: false, eac3: false, truehd: false }, dtsUhdOnly).codecs)
      .toEqual([])
  })
})

describe('Dolby Vision output policy', () => {
  it('clears forced output metadata in Auto', () => {
    expect(Object.fromEntries(dolbyVisionOpts('auto'))).toMatchObject({
      'target-colorspace-hint': 'auto', 'target-prim': 'auto', 'target-trc': 'auto', 'target-peak': 'auto',
    })
  })

  it('maps explicit HDR10 and SDR conversion targets', () => {
    expect(Object.fromEntries(dolbyVisionOpts('hdr10'))).toMatchObject({
      'target-colorspace-hint': 'yes', 'target-prim': 'bt.2020', 'target-trc': 'pq',
    })
    expect(Object.fromEntries(dolbyVisionOpts('sdr'))).toMatchObject({
      'target-colorspace-hint': 'yes', 'target-prim': 'bt.709', 'target-trc': 'bt.1886',
    })
  })

  it('never reports native DV unless the native path and source profile both prove it', () => {
    const current = { ...UNKNOWN_DOLBY_CAPABILITIES.current, videoFormat: 'dovi', videoProfile: 'Profile 5' }
    expect(classifyVideoOutput(current, false)).not.toBe('dolby-vision')
    expect(classifyVideoOutput(current, true)).toBe('dolby-vision')
  })
})

describe('live output classification', () => {
  it('distinguishes encoded IEC output from decoded PCM', () => {
    const current = { ...UNKNOWN_DOLBY_CAPABILITIES.current, audioFormat: 'spdif-eac3', audioCodec: 'eac3' }
    expect(classifyAudioOutput(current)).toBe('eac3')
    expect(classifyAudioOutput({ ...current, audioFormat: 'float', audioCodec: 'eac3' })).toBe('pcm')
    expect(classifyAudioOutput({ ...current, audioFormat: 'spdif-dts-hd', audioCodec: 'dts-hd' })).toBe('dts-hd')
  })

  it('does not infer Media3 passthrough from its source MIME', () => {
    const current = {
      ...UNKNOWN_DOLBY_CAPABILITIES.current,
      ao: 'audiotrack', audioFormat: 'audio/eac3-joc', audioCodec: 'audio/eac3-joc',
    }
    expect(classifyAudioOutput(current)).toBe('unknown')
  })

  it('reports the VO target rather than treating HDR input as HDR output', () => {
    const current = {
      ...UNKNOWN_DOLBY_CAPABILITIES.current,
      videoTransfer: 'pq', videoPrimaries: 'bt.2020',
      videoTargetTransfer: 'pq', videoTargetPrimaries: 'bt.2020',
    }
    expect(classifyVideoOutput(current)).toBe('hdr10')
    expect(classifyVideoOutput(current, 'hdr10-plus')).toBe('hdr10-plus')
    expect(classifyVideoOutput({ ...current, videoTransfer: 'arib-std-b67' }, 'hlg')).toBe('hlg')
    expect(classifyVideoOutput({ ...current, videoTargetTransfer: 'bt.1886', videoTargetPrimaries: 'bt.709' })).toBe('sdr')
    expect(classifyVideoOutput({ ...current, videoTargetTransfer: '', videoTargetPrimaries: '' })).toBe('unknown')
    expect(classifyVideoOutput({ ...current, videoTargetTransfer: 'linear', videoTargetPrimaries: 'bt.2020' })).toBe('unknown')
  })

  it('does not label a requested native HDR route as active for another source', () => {
    const current = { ...UNKNOWN_DOLBY_CAPABILITIES.current, videoTransfer: 'bt.1886' }
    expect(classifyVideoOutput(current, 'hdr10-plus')).toBe('unknown')
    expect(classifyVideoOutput(current, 'hlg')).toBe('unknown')
  })

  it('keeps an absent or unrecognized audio output unknown even with a Dolby source', () => {
    const current = { ...UNKNOWN_DOLBY_CAPABILITIES.current, audioCodec: 'eac3' }
    expect(classifyAudioOutput(current)).toBe('unknown')
    expect(classifyAudioOutput({ ...current, audioFormat: 'spdif-unknown' })).toBe('unknown')
    expect(classifyAudioOutput({ ...current, audioFormat: 's32' })).toBe('pcm')
    expect(classifyAudioOutput({ ...current, audioCodec: 'truehd', audioFormat: 'spdif-eac3' })).toBe('eac3')
  })

  it('does not fall back to source properties when an older backend omits the target', async () => {
    vi.mocked(invoke).mockResolvedValue({ current: { videoTransfer: 'pq', videoPrimaries: 'bt.2020' } })
    const result = await refreshDolbyCapabilities()
    expect(classifyVideoOutput(result.current)).toBe('unknown')
  })
})

/** dolby.ts keeps the playback speed, the push chain and the working backend in module state, so
 * every test below gets a fresh copy. The persisted settings stores outlive a module reset (the
 * store package keeps one store per key), so they go back to their defaults by hand. */
async function freshDolby() {
  vi.resetModules()
  const dolby = await import('./dolby')
  const ui = await import('$lib/settings/ui')
  ui.audioOutputMode.set('pcm')
  ui.audioOutputDevice.set('auto')
  ui.audioExclusive.set(false)
  for (const codec of [
    ui.audioPassthroughAc3, ui.audioPassthroughEac3, ui.audioPassthroughTruehd,
    ui.audioPassthroughDts, ui.audioPassthroughDtsHd,
  ]) codec.set(true)
  ui.audioProcessing.set('off')
  ui.videoQualityPreset.set('standard')
  ui.rawMpvOptions.set('')
  ui.dolbyVisionOutputMode.set('auto')
  return { dolby, ui }
}

/** Lets every already-resolved IPC mock and the chains awaiting it run to completion. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

interface Push { command: string; opts: Record<string, string>; reload: boolean }

function pushes(): Push[] {
  return mocks.invoke.mock.calls.flatMap(([command, args]): Push[] => {
    if (command === 'player_set_dolby_opts') {
      const a = args as { opts: [string, string][]; reload: boolean }
      return [{ command, opts: Object.fromEntries(a.opts), reload: a.reload }]
    }
    if (command === 'plugin:mpv|mpv_set_dolby_opts') {
      const a = (args as { payload: { opts: { key: string; value: string }[]; reload: boolean } }).payload
      return [{ command, opts: Object.fromEntries(a.opts.map(({ key, value }) => [key, value])), reload: a.reload }]
    }
    return []
  })
}

const ALL_CODECS = 'ac3,eac3,truehd,dts-hd'

describe('Dolby output pushes around speed changes', () => {
  it('leaves the audio output alone when a speed change does not flip passthrough', async () => {
    const { dolby, ui } = await freshDolby()
    mocks.invoke.mockResolvedValue([])
    // PCM (the default), Auto without a reported route, and HDMI behind an audio filter.
    for (const setup of [
      () => ui.audioOutputMode.set('pcm'),
      () => ui.audioOutputMode.set('auto'),
      () => { ui.audioOutputMode.set('hdmi'); ui.audioProcessing.set('night') },
    ]) {
      setup()
      await dolby.setDolbyPlaybackSpeed(2)
      await dolby.setDolbyPlaybackSpeed(1.5)
      await dolby.setDolbyPlaybackSpeed(1)
    }
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('pushes once per real passthrough flip and never asks for an audio reopen', async () => {
    const { dolby, ui } = await freshDolby()
    ui.audioOutputMode.set('hdmi')
    mocks.invoke.mockResolvedValue([])
    await dolby.setDolbyPlaybackSpeed(2)
    await dolby.setDolbyPlaybackSpeed(1.5)
    await dolby.setDolbyPlaybackSpeed(1)
    expect(pushes().map((push) => [push.opts['audio-spdif'], push.reload])).toEqual([
      ['', false],
      [ALL_CODECS, false],
    ])
  })

  it('remembers the Android plugin instead of retrying the desktop command on every push', async () => {
    const { dolby, ui } = await freshDolby()
    ui.audioOutputMode.set('hdmi')
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'player_set_dolby_opts') throw new Error('command player_set_dolby_opts not found')
      return { failed: [] }
    })
    await dolby.setDolbyPlaybackSpeed(2)
    await dolby.setDolbyPlaybackSpeed(1)
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      'player_set_dolby_opts',
      'plugin:mpv|mpv_set_dolby_opts',
      'plugin:mpv|mpv_set_dolby_opts',
    ])
    expect(pushes().filter((push) => push.command.startsWith('plugin:')).map((push) => push.reload))
      .toEqual([false, false])
  })

  it('applies pushes in order and resolves each one with the state current at its turn', async () => {
    const { dolby, ui } = await freshDolby()
    ui.audioOutputMode.set('hdmi')
    let finishHoldPush!: () => void
    mocks.invoke.mockImplementationOnce(() => new Promise((resolve) => { finishHoldPush = () => resolve([]) }))
    mocks.invoke.mockResolvedValue([])
    const press = dolby.setDolbyPlaybackSpeed(2)
    await settle()
    const release = dolby.setDolbyPlaybackSpeed(1)
    ui.audioPassthroughTruehd.set(false)
    await settle()
    // The release push waits behind the hold push instead of racing it to the player.
    expect(pushes()).toHaveLength(1)
    finishHoldPush()
    await Promise.all([press, release])
    expect(pushes().map((push) => push.opts['audio-spdif'])).toEqual(['', 'ac3,eac3,dts-hd'])
  })

  it('still waits for a queued push when the new speed keeps the same decision', async () => {
    const { dolby, ui } = await freshDolby()
    ui.audioOutputMode.set('hdmi')
    let finishHoldPush!: () => void
    mocks.invoke.mockImplementationOnce(() => new Promise((resolve) => { finishHoldPush = () => resolve([]) }))
    void dolby.setDolbyPlaybackSpeed(2)
    let changed = false
    const next = dolby.setDolbyPlaybackSpeed(1.5).then(() => { changed = true })
    await settle()
    // 1.5x must not reach mpv while the push that turns the bitstream off is still in flight.
    expect(changed).toBe(false)
    finishHoldPush()
    await next
    expect(pushes()).toHaveLength(1)
  })

  it('reopens the audio output only for a re-detected route or an explicit recheck', async () => {
    const { dolby, ui } = await freshDolby()
    let poll: (() => Promise<void>) | undefined
    let route: ((event: { reason: string }) => Promise<void>) | undefined
    vi.stubGlobal('window', {
      setInterval: (callback: () => Promise<void>) => { poll = callback; return 1 },
      clearInterval: () => {},
    })
    mocks.addPluginListener.mockImplementation(async (_plugin: string, _event: string, listener: (event: { reason: string }) => Promise<void>) => {
      route = listener
      return { unregister: vi.fn(async () => {}) }
    })
    let probe: Partial<DolbyCapabilities> = { audioConfidence: 'unknown' }
    mocks.invoke.mockImplementation(async (command: string) => (command === 'player_dolby_capabilities' ? probe : []))
    const stop = dolby.startDolbySync()
    await settle()
    expect(pushes().map((push) => push.reload)).toEqual([false])

    // Settings that change the output (or nothing at all) rely on mpv's own reopen.
    ui.videoQualityPreset.set('high')
    ui.dolbyVisionOutputMode.set('hdr10')
    await settle()
    expect(pushes().map((push) => push.reload)).toEqual([false, false, false])

    await poll!()
    expect(pushes()).toHaveLength(3)
    probe = reported
    await poll!()
    expect(pushes().map((push) => push.reload)).toEqual([false, false, false, true])

    await route!({ reason: 'audio-route-changed' })
    expect(pushes().map((push) => push.reload)).toEqual([false, false, false, true, true])

    // The native HDR path's re-probe lands as mpv opens the file: no reopen there.
    await route!({ reason: 'native-dolby-vision-unavailable' })
    expect(pushes().map((push) => push.reload)).toEqual([false, false, false, true, true, false])

    await dolby.applyDolbySettings({ reload: true })
    expect(pushes().at(-1)?.reload).toBe(true)
    stop()
  })

  it('has the Settings Recheck button ask for the reopen', () => {
    const page = readFileSync(fileURLToPath(new URL('../../routes/app/settings/player/+page.svelte', import.meta.url)), 'utf8')
    expect(page).toContain('refreshDolbyCapabilities().then(() => applyDolbySettings({ reload: true }))')
  })
})
