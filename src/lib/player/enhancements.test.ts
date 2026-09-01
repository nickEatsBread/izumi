import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

import {
  audioChain, audioFilter, enhancementOpts, startEnhancementSync, subtitleFilterOptions,
  videoChain, vsrFilter,
} from './enhancements'
import {
  audioProcessing, rawMpvOptions, subtitleRegexFilter, subtitleStripSdh, subtitleStripSdhHarder,
  videoQualityPreset, windowsVsr,
} from '$lib/settings/ui'
import { isWindows } from '$lib/platform'

function resetSettings() {
  isWindows.set(true)
  audioProcessing.set('off')
  windowsVsr.set('off')
  subtitleStripSdh.set(false)
  subtitleStripSdhHarder.set(false)
  subtitleRegexFilter.set('')
  videoQualityPreset.set('standard')
  rawMpvOptions.set('')
}

describe('playback enhancement options', () => {
  beforeEach(resetSettings)

  it('keeps processing disabled by default', () => {
    expect(audioFilter('off')).toBe('')
    expect(vsrFilter('off')).toBe('')
  })

  it('maps dialogue/night and both driver upscaling modes', () => {
    expect(audioFilter('dialogue')).toContain('dynaudnorm')
    expect(audioFilter('night')).toContain('loudnorm')
    expect(audioFilter('boost')).toContain('volume=2.0')
    expect(vsrFilter('nvidia')).toBe('d3d11vpp=scaling-mode=nvidia')
    expect(vsrFilter('intel')).toBe('d3d11vpp=scaling-mode=intel')
  })

  it('only enables the harder SDH mode when stripping is enabled', () => {
    expect(Object.fromEntries(subtitleFilterOptions(false, true, ' x '))).toEqual({
      'sub-filter-sdh': 'no',
      'sub-filter-sdh-harder': 'no',
      'sub-filter-regex': 'x',
    })
  })

  it('hands the regex to the backend verbatim, commas and all', () => {
    // `.{2,}` is an ordinary bounded quantifier. mpv's sub-filter-regex is a comma-separated
    // string LIST, so the backend has to write this through the list API — but that only works if
    // the pattern still contains its comma by the time it gets there.
    const opts = Object.fromEntries(subtitleFilterOptions(true, false, '^[A-Z]{2,}:'))
    expect(opts['sub-filter-regex']).toBe('^[A-Z]{2,}:')
  })
})

describe('filter-chain composition', () => {
  beforeEach(resetSettings)

  it('leaves a user chain alone when the enhancement is off', () => {
    expect(audioChain('lavfi=[acompressor]', 'off')).toBe('lavfi=[acompressor]')
    expect(videoChain('hqdn3d', 'off')).toBe('hqdn3d')
  })

  it('emits only our filter when the user has no chain', () => {
    expect(audioChain('', 'night')).toBe('lavfi=[loudnorm=I=-18:LRA=7:TP=-2,alimiter=limit=0.97]')
    expect(videoChain('', 'nvidia')).toBe('d3d11vpp=scaling-mode=nvidia')
  })

  it('composes instead of clobbering, with the hardware filter at the head of the video chain', () => {
    expect(audioChain('lavfi=[acompressor]', 'night'))
      .toBe('lavfi=[acompressor],lavfi=[loudnorm=I=-18:LRA=7:TP=-2,alimiter=limit=0.97]')
    expect(videoChain('hqdn3d', 'nvidia')).toBe('d3d11vpp=scaling-mode=nvidia,hqdn3d')
  })

  it('keeps the Custom mpv-options chains when an enhancement changes', () => {
    // Regression: enabling night mode used to send `af=<our filter>` and `vf=` — wiping a
    // perfectly valid Custom configuration, and turning the enhancement off wiped it again.
    videoQualityPreset.set('custom')
    rawMpvOptions.set('af=lavfi=[acompressor]\nvf=hqdn3d\nscale=ewa_lanczos')
    audioProcessing.set('night')
    windowsVsr.set('nvidia')

    const opts = Object.fromEntries(enhancementOpts())
    expect(opts.af).toBe('lavfi=[acompressor],lavfi=[loudnorm=I=-18:LRA=7:TP=-2,alimiter=limit=0.97]')
    expect(opts.vf).toBe('d3d11vpp=scaling-mode=nvidia,hqdn3d')

    audioProcessing.set('off')
    windowsVsr.set('off')
    const off = Object.fromEntries(enhancementOpts())
    expect(off.af).toBe('lavfi=[acompressor]')
    expect(off.vf).toBe('hqdn3d')
  })

  it('ignores raw options for built-in presets, which never set a chain', () => {
    videoQualityPreset.set('high')
    rawMpvOptions.set('af=lavfi=[acompressor]')
    expect(Object.fromEntries(enhancementOpts()).af).toBe('')
  })

  it('does not send a synced Windows driver filter to a non-Windows player', () => {
    isWindows.set(false)
    windowsVsr.set('nvidia')
    videoQualityPreset.set('custom')
    rawMpvOptions.set('vf=hqdn3d')

    expect(Object.fromEntries(enhancementOpts()).vf).toBe('hqdn3d')
  })
})

// One test, three phases: `startEnhancementSync` latches after its first call and the settings
// stores are process-wide singletons, so a second call — in this file or a re-imported copy of the
// module — would either no-op or double up the subscriptions. Phases share one startup instead.
describe('startEnhancementSync', () => {
  const pushes = () => invoke.mock.calls.filter(([cmd]) => cmd === 'player_set_enhancement_opts')

  it('pushes at startup and on every later change', () => {
    resetSettings()
    audioProcessing.set('night')
    subtitleStripSdh.set(true)
    invoke.mockReset()
    invoke.mockResolvedValue([])

    // --- startup ---------------------------------------------------------------------------
    // The bug: this only ever ran on CHANGES, and the value only reached a LIVE mpv core — which
    // does not exist yet on a fresh launch, because it is created on the first play and destroyed
    // on stop. A user who turned night mode on last week started the app with it silently off.
    expect(pushes()).toHaveLength(0)
    startEnhancementSync()
    expect(pushes()).toHaveLength(1)
    const startup = Object.fromEntries(pushes()[0][1].opts)
    expect(startup.af).toBe('lavfi=[loudnorm=I=-18:LRA=7:TP=-2,alimiter=limit=0.97]')
    expect(startup['sub-filter-sdh']).toBe('yes')

    // --- a later change, exactly one push --------------------------------------------------
    invoke.mockClear()
    windowsVsr.set('intel')
    expect(pushes()).toHaveLength(1)
    expect(Object.fromEntries(pushes()[0][1].opts).vf).toBe('d3d11vpp=scaling-mode=intel')

    // --- editing the Custom raw options recomposes the chains -------------------------------
    invoke.mockClear()
    videoQualityPreset.set('custom')
    rawMpvOptions.set('af=lavfi=[acompressor]')
    const latest = Object.fromEntries(pushes().at(-1)![1].opts)
    expect(latest.af).toBe('lavfi=[acompressor],lavfi=[loudnorm=I=-18:LRA=7:TP=-2,alimiter=limit=0.97]')
    expect(latest.vf).toBe('d3d11vpp=scaling-mode=intel')

    // Idempotent: a second call must not add a duplicate set of subscriptions.
    invoke.mockClear()
    startEnhancementSync()
    audioProcessing.set('dialogue')
    expect(pushes()).toHaveLength(1)
  })
})
