// Type-only import (erased at runtime) so this module — and its unit test — stay pure and don't
// pull in the settings stores. The runtime store imports are added in Task 5 (applyRenderOpts).
import type { QualityPreset } from '$lib/settings/ui'
import { invoke } from '@tauri-apps/api/core'
import { get, writable } from 'svelte/store'
import { videoQualityPreset, rawMpvOptions } from '$lib/settings/ui'

/** Every mpv render key any preset can touch. A preset is COMPLETE over this set (unset → default),
 *  so downgrading a preset actively clears a heavier option instead of leaving it stuck on. */
export const MANAGED_KEYS = [
  'scale', 'scale-antiring', 'dscale', 'dscale-antiring', 'cscale', 'cscale-antiring',
  'deband', 'deband-iterations', 'deband-threshold', 'deband-range', 'deband-grain',
  'dither', 'sigmoid-upscaling', 'correct-downscaling', 'linear-downscaling', 'glsl-shaders',
  'hdr-peak-percentile', 'hdr-contrast-recovery',
] as const

/** mpv default value for every managed key (what "off" means for each).
 *  These match modern mpv builtin defaults (lanczos / hermite / sigmoid on),
 *  not the older bilinear-everything baseline. Standard used to inherit
 *  `sigmoid/correct/linear=no` from that old table and looked worse than stock mpv.
 *  HDR percentile 100 / contrast-recovery 0 are stock (`video.c` zero-init; 0 and 100
 *  both mean "true peak" in libplacebo). */
const MANAGED_DEFAULTS: Record<string, string> = {
  scale: 'lanczos', 'scale-antiring': '0', dscale: 'hermite', 'dscale-antiring': '0',
  cscale: 'lanczos', 'cscale-antiring': '0', deband: 'no', 'deband-iterations': '1',
  'deband-threshold': '32', 'deband-range': '16', 'deband-grain': '48', dither: 'fruit',
  'sigmoid-upscaling': 'yes', 'correct-downscaling': 'yes', 'linear-downscaling': 'yes', 'glsl-shaders': '',
  'hdr-peak-percentile': '100', 'hdr-contrast-recovery': '0',
}

/** The enhancing options each built-in preset sets ON TOP of MANAGED_DEFAULTS. */
const PRESETS: Record<Exclude<QualityPreset, 'custom' | 'anime'>, Record<string, string>> = {
  // mpv [fast]: cheapest scalers, no sigmoid/correct/linear. Dither stays on so
  // 10-bit anime does not band on an 8-bit panel.
  performance: {
    scale: 'bilinear', dscale: 'bilinear', cscale: 'bilinear', deband: 'no',
    'sigmoid-upscaling': 'no', 'correct-downscaling': 'no', 'linear-downscaling': 'no',
  },
  // Slightly softer than stock lanczos (mpv.net-era spline36), with stock mpv's
  // cheap quality flags kept ON so Standard is never a picture downgrade.
  standard: { scale: 'spline36', dscale: 'mitchell', cscale: 'spline36', deband: 'no' },
  high: {
    scale: 'ewa_lanczossharp', 'scale-antiring': '0.6', dscale: 'catmull_rom', 'dscale-antiring': '0.5',
    cscale: 'spline36', 'cscale-antiring': '0.5', deband: 'yes', 'deband-iterations': '4',
    'deband-threshold': '35', 'deband-range': '16', 'deband-grain': '4', dither: 'error-diffusion',
    'sigmoid-upscaling': 'yes', 'correct-downscaling': 'yes', 'linear-downscaling': 'yes',
    // Stock [high-quality] extras (etc/builtin.conf). Deband / error-diffusion stay Izumi extras.
    'hdr-peak-percentile': '99.995', 'hdr-contrast-recovery': '0.30',
  },
}

/** The Anime shader chain, in mpv apply order: the luma reconstruction pass, then any refinement
 *  passes. Only the FIRST entry is required — the rest are best-effort (see `applyRenderOpts`),
 *  because upstream doesn't publish a `.glsl` for every model. Variant names are interpolated into
 *  a cache filename by the backend, which only accepts `SHADER_VARIANT_RE`; anything outside that
 *  charset is rejected there, so keep new entries inside it. */
export const ANIME_SHADER_VARIANTS = ['C4F16', 'C4F16_Chroma'] as const

/** Charset the backend's variant validation accepts (see src-tauri/src/player/shaders.rs). */
export const SHADER_VARIANT_RE = /^[A-Za-z0-9_]{1,64}$/

export function shaderList(paths: string[]): string {
  if (!paths.length) return ''
  return paths.join(paths.some((path) => /^[A-Za-z]:[\\/]/.test(path)) ? ';' : ':')
}

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

/** mpv's filter chains are the one place Custom raw options overlap with the playback-enhancement
 *  settings (night mode writes `af`, driver upscaling writes `vf`). Both sides used to push the
 *  WHOLE chain, so whichever landed last silently wiped the other. The enhancement path now owns
 *  these two keys and composes the user's chain with ours, so this path must leave them alone. */
const CHAIN_KEYS = new Set(['af', 'vf'])

/** The user's own `af`/`vf` chains from the Custom raw-options textarea, for the enhancement path
 *  to compose with. Built-in presets never touch filter chains, so they contribute nothing. */
export function userFilterChains(preset: QualityPreset, raw: string): { af: string; vf: string } {
  if (preset !== 'custom') return { af: '', vf: '' }
  const parsed = new Map(parseRawOptions(raw))
  return { af: parsed.get('af') ?? '', vf: parsed.get('vf') ?? '' }
}

/** Resolve a preset (+ raw text, + optional downloaded shader path) to the full managed option set.
 *  `shaderPath` is only used by the Anime preset. */
export function resolvePreset(preset: QualityPreset, raw: string, shaderPath?: string): [string, string][] {
  const merged: Record<string, string> = { ...MANAGED_DEFAULTS }
  if (preset === 'custom') {
    for (const [k, v] of parseRawOptions(raw)) merged[k] = v
    // raw may set non-managed keys too; include them — except the filter chains (see CHAIN_KEYS).
    return Object.entries(merged).filter(([k]) => !CHAIN_KEYS.has(k))
  }
  const base = preset === 'anime' ? PRESETS.high : PRESETS[preset]
  Object.assign(merged, base)
  if (preset === 'anime' && shaderPath) merged['glsl-shaders'] = shaderPath
  // only managed keys for built-in presets
  return MANAGED_KEYS.map((k) => [k, merged[k]] as [string, string])
}

/** Shader-download outcome message (Anime preset). */
export const qualityNotice = writable<string>('')
/** Managed-key names whose LIVE apply failed — only surfaced in Custom mode (typo, or init-only). */
export const qualityFailedKeys = writable<string[]>([])

/** Resolve the current preset (downloading the upscale shaders first for Anime) and push the option
 *  set to the backend. Shader-download failure falls back to the shader-less High Quality chain. */
export async function applyRenderOpts(): Promise<void> {
  const preset = get(videoQualityPreset)
  const raw = get(rawMpvOptions)
  let shaderPath: string | undefined
  if (preset === 'anime') {
    try {
      // Fetch the chain in parallel but keep mpv's apply order. Only the first (luma) pass is
      // required: a refinement pass upstream never published must not take the luma model down with
      // it, which is what a plain Promise.all did — one rejection dropped the ENTIRE preset.
      const settled = await Promise.allSettled(
        ANIME_SHADER_VARIANTS.map((variant) => invoke<string>('ensure_upscale_shader', { variant })),
      )
      if (settled[0].status === 'rejected') throw settled[0].reason
      shaderPath = shaderList(settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])))
      qualityNotice.set('')
    } catch {
      qualityNotice.set('Shader download failed — using High Quality.')
      // no shaderPath → resolvePreset('anime') leaves glsl-shaders at its default ''
    }
  } else {
    qualityNotice.set('')
  }
  const opts = resolvePreset(preset, raw, shaderPath)
  const failed = await pushRenderOpts(opts)
  // Built-in presets only use known-good keys, so failures there are init-only (ignore). In Custom,
  // surface the keys that had no live effect so the user can spot a typo.
  qualityFailedKeys.set(preset === 'custom' ? failed : [])
}

/** Desktop Rust command first; Android libmpv has no `player_set_render_opts` (cfg'd off),
 *  so fall through to the plugin which stores the set and live-applies it. */
async function pushRenderOpts(opts: [string, string][]): Promise<string[]> {
  try {
    return await invoke<string[]>('player_set_render_opts', { opts })
  } catch {
    try {
      const r = await invoke<{ failed?: string[] }>('plugin:mpv|mpv_set_render_opts', {
        payload: { opts: opts.map(([key, value]) => ({ key, value })) },
      })
      return Array.isArray(r?.failed) ? r.failed : []
    } catch {
      return []
    }
  }
}

let started = false
/** Push render opts once on startup, then on every preset/raw change. Idempotent. */
export function startQualitySync(): void {
  if (started) return
  started = true
  void applyRenderOpts()
  let first = true
  videoQualityPreset.subscribe(() => { if (!first) void applyRenderOpts() })
  rawMpvOptions.subscribe(() => { if (!first) void applyRenderOpts() })
  first = false
}
