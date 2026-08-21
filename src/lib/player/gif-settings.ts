/** Encrypted GIFs capture every compositor frame they can. Playback is capped
 *  here so a dense burst does not fast-forward. Unencrypted file GIFs pick
 *  sample rate from clip length on the native side. */

export const GIF_SAMPLE_FPS = 24
export const GIF_WIDTH_OPTIONS = [480, 720, 960] as const
export const GIF_SECONDS_OPTIONS = [5, 10, 15, 30] as const

export type GifWidth = (typeof GIF_WIDTH_OPTIONS)[number]
export type GifSeconds = (typeof GIF_SECONDS_OPTIONS)[number]

export type GifCapturePlan = {
  fps: typeof GIF_SAMPLE_FPS
  width: GifWidth
  maxSeconds: GifSeconds
  intervalMs: number
  maxFrames: number
}

function pick<T extends number>(value: number, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly number[]).includes(value) ? (value as T) : fallback
}

export function gifCapturePlan(width: number, maxSeconds: number): GifCapturePlan {
  const safeWidth = pick(width, GIF_WIDTH_OPTIONS, 720)
  const safeSeconds = pick(maxSeconds, GIF_SECONDS_OPTIONS, 10)
  return {
    fps: GIF_SAMPLE_FPS,
    width: safeWidth,
    maxSeconds: safeSeconds,
    intervalMs: Math.round(1000 / GIF_SAMPLE_FPS),
    maxFrames: safeSeconds * 30 + 8,
  }
}
