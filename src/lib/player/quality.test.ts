import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

import {
  resolvePreset, parseRawOptions, MANAGED_KEYS, shaderList,
  ANIME_SHADER_VARIANTS, SHADER_VARIANT_RE, applyRenderOpts, qualityNotice, userFilterChains,
} from './quality'
import { videoQualityPreset } from '$lib/settings/ui'
import { get } from 'svelte/store'

describe('resolvePreset', () => {
  it('standard is spline36 + deband off and complete over managed keys', () => {
    const opts = new Map(resolvePreset('standard', ''))
    expect(opts.get('scale')).toBe('spline36')
    expect(opts.get('deband')).toBe('no')
    for (const k of MANAGED_KEYS) expect(opts.has(k)).toBe(true)
    expect(opts.get('glsl-shaders')).toBe('')
  })

  it('standard keeps stock mpv quality flags instead of turning them off', () => {
    // Modern mpv defaults (builtin.conf) enable these. Standard used to emit
    // `no` for each via MANAGED_DEFAULTS, which was a real quality regression
    // versus launching mpv with no config.
    const opts = new Map(resolvePreset('standard', ''))
    expect(opts.get('sigmoid-upscaling')).toBe('yes')
    expect(opts.get('correct-downscaling')).toBe('yes')
    expect(opts.get('linear-downscaling')).toBe('yes')
    expect(opts.get('dither')).toBe('fruit')
  })

  it('custom empty baseline is modern mpv defaults, not bilinear', () => {
    const opts = new Map(resolvePreset('custom', ''))
    expect(opts.get('scale')).toBe('lanczos')
    expect(opts.get('cscale')).toBe('lanczos')
    expect(opts.get('dscale')).toBe('hermite')
    expect(opts.get('sigmoid-upscaling')).toBe('yes')
  })

  it('performance is the mpv fast profile, not leftover quality flags', () => {
    const opts = new Map(resolvePreset('performance', ''))
    expect(opts.get('scale')).toBe('bilinear')
    expect(opts.get('dscale')).toBe('bilinear')
    expect(opts.get('cscale')).toBe('bilinear')
    expect(opts.get('sigmoid-upscaling')).toBe('no')
    expect(opts.get('correct-downscaling')).toBe('no')
    expect(opts.get('linear-downscaling')).toBe('no')
    expect(opts.get('deband')).toBe('no')
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
    expect(opts.get('cscale')).toBe('lanczos')
  })

  it('leaves the filter chains to the enhancement path', () => {
    // Both paths used to push the whole `af`/`vf` string, so the later push wiped the earlier one.
    // The enhancement path composes the two and owns the keys; this one must not emit them.
    const opts = new Map(resolvePreset('custom', 'af=lavfi=[acompressor]\nvf=hqdn3d\nscale=lanczos'))
    expect(opts.has('af')).toBe(false)
    expect(opts.has('vf')).toBe(false)
    expect(opts.get('scale')).toBe('lanczos')
  })
})

describe('userFilterChains', () => {
  it('reads the user chains out of the Custom raw options', () => {
    expect(userFilterChains('custom', 'af=lavfi=[acompressor]\nvf=hqdn3d\nscale=lanczos'))
      .toEqual({ af: 'lavfi=[acompressor]', vf: 'hqdn3d' })
  })
  it('is empty for a Custom config that sets no chain, and for built-in presets', () => {
    expect(userFilterChains('custom', 'scale=lanczos')).toEqual({ af: '', vf: '' })
    expect(userFilterChains('high', 'af=lavfi=[acompressor]')).toEqual({ af: '', vf: '' })
  })
})

describe('shaderList', () => {
  it('joins Unix shader paths with a colon', () => {
    expect(shaderList(['/tmp/luma.glsl', '/tmp/chroma.glsl'])).toBe('/tmp/luma.glsl:/tmp/chroma.glsl')
  })
  it('joins Windows shader paths with a semicolon', () => {
    expect(shaderList(['C:\\shaders\\luma.glsl', 'C:\\shaders\\chroma.glsl'])).toBe('C:\\shaders\\luma.glsl;C:\\shaders\\chroma.glsl')
  })
})

describe('anime shader variants', () => {
  // Regression: the backend validates the variant before using it as a filename, and a rule that
  // forbade `_` rejected the chroma pass. Because the two shaders are fetched as a group, one
  // rejected name takes the whole preset down — so every shipped name must match the backend gate.
  it('every shipped variant matches the charset the backend accepts', () => {
    for (const v of ANIME_SHADER_VARIANTS) expect(v).toMatch(SHADER_VARIANT_RE)
  })

  it('rejects names that could escape the shader cache dir', () => {
    for (const bad of ['', '..', '../etc', 'a/b', 'a\\b', 'C:/abs', 'dot.dot', 'x\0y', 'é'])
      expect(bad).not.toMatch(SHADER_VARIANT_RE)
  })
})

describe('applyRenderOpts (anime preset)', () => {
  beforeEach(() => {
    invoke.mockReset()
    qualityNotice.set('')
  })

  it('fetches every variant and hands mpv the joined shader chain', async () => {
    invoke.mockImplementation(async (cmd: string, args: { variant?: string }) =>
      cmd === 'ensure_upscale_shader' ? `/cache/shader_${args.variant}.glsl` : [])
    videoQualityPreset.set('anime')
    await applyRenderOpts()

    const asked = invoke.mock.calls.filter(([c]) => c === 'ensure_upscale_shader').map(([, a]) => a.variant)
    expect(asked).toEqual([...ANIME_SHADER_VARIANTS])
    const opts = new Map(invoke.mock.calls.find(([c]) => c === 'player_set_render_opts')![1].opts)
    expect(opts.get('glsl-shaders')).toBe('/cache/shader_C4F16.glsl:/cache/shader_C4F16_Chroma.glsl')
    expect(get(qualityNotice)).toBe('')
  })

  it('keeps the luma pass when an optional refinement pass is unavailable', async () => {
    // Regression: this used to be a Promise.all, so one unavailable pass dropped the whole preset
    // to High Quality — no shader at all, which is exactly what a rejected variant name caused.
    invoke.mockImplementation(async (cmd: string, args: { variant?: string }) => {
      if (cmd !== 'ensure_upscale_shader') return []
      if (args.variant !== ANIME_SHADER_VARIANTS[0]) throw new Error('no such shader asset')
      return `/cache/shader_${args.variant}.glsl`
    })
    videoQualityPreset.set('anime')
    await applyRenderOpts()

    const opts = new Map(invoke.mock.calls.find(([c]) => c === 'player_set_render_opts')![1].opts)
    expect(opts.get('glsl-shaders')).toBe('/cache/shader_C4F16.glsl')
    expect(get(qualityNotice)).toBe('')
  })

  it('falls back to High Quality when the required luma pass fails', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd !== 'ensure_upscale_shader') return []
      throw new Error('shader download failed')
    })
    videoQualityPreset.set('anime')
    await applyRenderOpts()

    const opts = new Map(invoke.mock.calls.find(([c]) => c === 'player_set_render_opts')![1].opts)
    expect(opts.get('glsl-shaders')).toBe('')
    expect(opts.get('scale')).toBe('ewa_lanczossharp') // High Quality chain, minus the shaders
    expect(get(qualityNotice)).not.toBe('')
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
