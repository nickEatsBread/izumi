import { describe, expect, it } from 'vitest'
import { assessCodecProfile, parseCodecProfile } from './codec-profile'

describe('HDR codec profile parsing', () => {
  it('parses Dolby Vision profile and level', () => {
    expect(parseCodecProfile('dvhe.05.06')).toMatchObject({ codec: 'dolby-vision', profile: 5, level: '6' })
    expect(parseCodecProfile('dvh1.08.09')).toMatchObject({ codec: 'dolby-vision', profile: 8, level: '9' })
  })

  it('parses HEVC Main10 and its general level idc', () => {
    expect(parseCodecProfile('hvc1.2.4.L153.B0')).toMatchObject({
      codec: 'hevc', profile: 2, level: '5.1', tier: 'main', bitDepth: 10,
    })
  })

  it('parses AV1 and VP9 HDR profiles', () => {
    expect(parseCodecProfile('av01.0.08M.10')).toMatchObject({
      codec: 'av1', profile: 0, level: '4.0', bitDepth: 10,
    })
    expect(parseCodecProfile('vp09.02.10.10')).toMatchObject({
      codec: 'vp9', profile: 2, level: '1.0', bitDepth: 10,
    })
  })

  it('does not invent profile evidence from filenames or bare codec names', () => {
    expect(parseCodecProfile('Show.2160p.HDR10+.HEVC.mkv')).toBeNull()
    expect(parseCodecProfile('hevc')).toBeNull()
  })

  it('requires the matching decoder family before native HDR preflight', () => {
    expect(assessCodecProfile(parseCodecProfile('dvhe.08.09'), {
      dolbyVisionProfiles: ['5@9'], hevcMain10: true, av1Main10: false, vp9Profile2: false,
    })).toMatchObject({ supported: false })
    expect(assessCodecProfile(parseCodecProfile('av01.0.08M.10'), {
      dolbyVisionProfiles: [], hevcMain10: true, av1Main10: true, vp9Profile2: false,
    })).toMatchObject({ supported: true })
  })
})
