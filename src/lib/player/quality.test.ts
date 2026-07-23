import { describe, expect, it } from 'vitest'
import { resolvePreset, parseRawOptions, MANAGED_KEYS } from './quality'

describe('resolvePreset', () => {
  it('standard is spline36 + deband off and complete over managed keys', () => {
    const opts = new Map(resolvePreset('standard', ''))
    expect(opts.get('scale')).toBe('spline36')
    expect(opts.get('deband')).toBe('no')
    for (const k of MANAGED_KEYS) expect(opts.has(k)).toBe(true)
    expect(opts.get('glsl-shaders')).toBe('')
  })

  it('high quality enables ewa + deband + sigmoid', () => {
    const opts = new Map(resolvePreset('high', ''))
    expect(opts.get('scale')).toBe('ewa_lanczossharp')
    expect(opts.get('deband')).toBe('yes')
    expect(opts.get('sigmoid-upscaling')).toBe('yes')
  })

  it('custom = managed defaults + raw lines on top', () => {
    const opts = new Map(resolvePreset('custom', 'scale=ewa_lanczos\ndeband=yes'))
    expect(opts.get('scale')).toBe('ewa_lanczos')
    expect(opts.get('deband')).toBe('yes')
    expect(opts.get('cscale')).toBe('bilinear')
  })
})

describe('parseRawOptions', () => {
  it('parses key=value and --key=value, skips comments/blanks/malformed', () => {
    const out = parseRawOptions('scale=lanczos\n--deband=yes\n# a comment\n\ngarbage-no-eq\ncscale = spline36 ')
    expect(out).toEqual([
      ['scale', 'lanczos'],
      ['deband', 'yes'],
      ['cscale', 'spline36'],
    ])
  })
})
