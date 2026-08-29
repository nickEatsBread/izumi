import { describe, expect, it } from 'vitest'
import {
  UNKNOWN_DOLBY_CAPABILITIES,
  classifyAudioOutput,
  classifyVideoOutput,
  dolbyVisionOpts,
  resolveAudioPassthrough,
  type AudioOutputSettings,
  type DolbyCapabilities,
} from './dolby'

const base: AudioOutputSettings = {
  mode: 'pcm', device: 'auto', exclusive: false,
  ac3: true, eac3: true, truehd: true, hasAudioFilter: false, playbackSpeed: 1,
}

const reported: DolbyCapabilities = {
  ...UNKNOWN_DOLBY_CAPABILITIES,
  platform: 'android',
  audioConfidence: 'reported',
  audio: { ac3: true, eac3: true, eac3Joc: true, truehd: false, mat: true },
}

describe('Dolby audio output policy', () => {
  it('is PCM and encoded-audio safe by default', () => {
    const decision = resolveAudioPassthrough(base, reported)
    expect(decision.codecs).toEqual([])
    expect(Object.fromEntries(decision.opts)['audio-spdif']).toBe('')
  })

  it('limits optical to AC-3 even when every codec is selected', () => {
    expect(resolveAudioPassthrough({ ...base, mode: 'optical' }, reported).codecs).toEqual(['ac3'])
  })

  it('allows explicit HDMI E-AC3 and TrueHD passthrough', () => {
    const decision = resolveAudioPassthrough({ ...base, mode: 'hdmi', exclusive: true }, reported)
    expect(decision.codecs).toEqual(['ac3', 'eac3', 'truehd'])
    expect(Object.fromEntries(decision.opts)).toMatchObject({
      'audio-spdif': 'ac3,eac3,truehd',
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

  it('uses reported route capabilities in Auto and accepts MAT for TrueHD', () => {
    expect(resolveAudioPassthrough({ ...base, mode: 'auto' }, reported).codecs)
      .toEqual(['ac3', 'eac3', 'truehd'])
    expect(resolveAudioPassthrough({ ...base, mode: 'auto' }, UNKNOWN_DOLBY_CAPABILITIES).codecs)
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
  })

  it('does not infer Media3 passthrough from its source MIME', () => {
    const current = {
      ...UNKNOWN_DOLBY_CAPABILITIES.current,
      ao: 'audiotrack', audioFormat: 'audio/eac3-joc', audioCodec: 'audio/eac3-joc',
    }
    expect(classifyAudioOutput(current)).toBe('unknown')
  })

  it('reports PQ/BT.2020 as HDR10 output, not Dolby Vision output', () => {
    const current = { ...UNKNOWN_DOLBY_CAPABILITIES.current, videoTransfer: 'pq', videoPrimaries: 'bt.2020' }
    expect(classifyVideoOutput(current)).toBe('hdr10')
  })
})
