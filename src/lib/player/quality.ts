// Type-only import (erased at runtime) so this module — and its unit test — stay pure and don't
// pull in the settings stores. The runtime store imports are added in Task 5 (applyRenderOpts).
import type { QualityPreset } from '$lib/settings/ui'

/** Every mpv render key any preset can touch. A preset is COMPLETE over this set (unset → default),
 *  so downgrading a preset actively clears a heavier option instead of leaving it stuck on. */
export const MANAGED_KEYS = [
  'scale', 'scale-antiring', 'dscale', 'dscale-antiring', 'cscale', 'cscale-antiring',
  'deband', 'deband-iterations', 'deband-threshold', 'deband-range', 'deband-grain',
  'dither', 'sigmoid-upscaling', 'correct-downscaling', 'linear-downscaling', 'glsl-shaders',
] as const

/** mpv default value for every managed key (what "off" means for each). */
const MANAGED_DEFAULTS: Record<string, string> = {
  scale: 'bilinear', 'scale-antiring': '0', dscale: 'bilinear', 'dscale-antiring': '0',
  cscale: 'bilinear', 'cscale-antiring': '0', deband: 'no', 'deband-iterations': '1',
  'deband-threshold': '32', 'deband-range': '16', 'deband-grain': '48', dither: 'fruit',
  'sigmoid-upscaling': 'no', 'correct-downscaling': 'no', 'linear-downscaling': 'no', 'glsl-shaders': '',
}

/** The enhancing options each built-in preset sets ON TOP of MANAGED_DEFAULTS. */
const PRESETS: Record<Exclude<QualityPreset, 'custom' | 'anime'>, Record<string, string>> = {
  performance: { scale: 'bilinear', dscale: 'bilinear', cscale: 'bilinear', deband: 'no' },
  standard: { scale: 'spline36', dscale: 'mitchell', cscale: 'spline36', deband: 'no' },
  high: {
    scale: 'ewa_lanczossharp', 'scale-antiring': '0.5', dscale: 'catmull_rom', 'dscale-antiring': '0.5',
    cscale: 'spline36', 'cscale-antiring': '0.5', deband: 'yes', 'deband-iterations': '4',
    'deband-threshold': '35', 'deband-range': '16', 'deband-grain': '4', dither: 'error-diffusion',
    'sigmoid-upscaling': 'yes', 'correct-downscaling': 'yes', 'linear-downscaling': 'yes',
  },
}

/** The ArtCNN variant the Anime preset uses (luma). */
export const ANIME_SHADER_VARIANT = 'C4F16'

/** Parse the Custom raw-options textarea into [key, value] pairs. Tolerates `key=value`,
 *  `--key=value`, `#` comments, blank lines; trims; skips malformed (no `=`) lines. */
export function parseRawOptions(text: string): [string, string][] {
  const out: [string, string][] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const body = t.startsWith('--') ? t.slice(2) : t
    const eq = body.indexOf('=')
    if (eq <= 0) continue
    const key = body.slice(0, eq).trim()
    const val = body.slice(eq + 1).trim()
    if (key) out.push([key, val])
  }
  return out
}

/** Resolve a preset (+ raw text, + optional downloaded shader path) to the full managed option set.
 *  `shaderPath` is only used by the Anime preset. */
export function resolvePreset(preset: QualityPreset, raw: string, shaderPath?: string): [string, string][] {
  const merged: Record<string, string> = { ...MANAGED_DEFAULTS }
  if (preset === 'custom') {
    for (const [k, v] of parseRawOptions(raw)) merged[k] = v
    // raw may set non-managed keys too; include them.
    return Object.entries(merged)
  }
  const base = preset === 'anime' ? PRESETS.high : PRESETS[preset]
  Object.assign(merged, base)
  if (preset === 'anime' && shaderPath) merged['glsl-shaders'] = shaderPath
  // only managed keys for built-in presets
  return MANAGED_KEYS.map((k) => [k, merged[k]] as [string, string])
}
