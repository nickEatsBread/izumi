/** Clip sampling for unencrypted video: ffmpeg `fps=` takes even ticks from the
 *  moment you held record, which is how a GIF stays a clip instead of seekbar
 *  tiles. Encrypted playback ignores this and grabs every compositor frame it can.
 *  Width 720px, ~10s. */

export const GIF_FPS_OPTIONS = [10, 12, 15, 20, 24] as const
export const GIF_WIDTH_OPTIONS = [480, 720, 960] as const
export const GIF_SECONDS_OPTIONS = [5, 10, 15, 30] as const

export type GifFps = (typeof GIF_FPS_OPTIONS)[number]
export type GifWidth = (typeof GIF_WIDTH_OPTIONS)[number]
export type GifSeconds = (typeof GIF_SECONDS_OPTIONS)[number]

export type GifCapturePlan = {
  fps: GifFps
  width: GifWidth
  maxSeconds: GifSeconds
  intervalMs: number
  maxFrames: number
}

function pick<T extends number>(value: number, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly number[]).includes(value) ? (value as T) : fallback
}

export function gifCapturePlan(fps: number, width: number, maxSeconds: number): GifCapturePlan {
  const safeFps = pick(fps, GIF_FPS_OPTIONS, 15)
  const safeWidth = pick(width, GIF_WIDTH_OPTIONS, 720)
  const safeSeconds = pick(maxSeconds, GIF_SECONDS_OPTIONS, 10)
  return {
    fps: safeFps,
    width: safeWidth,
    maxSeconds: safeSeconds,
    intervalMs: Math.round(1000 / safeFps),
    maxFrames: safeSeconds * 30 + 8,
  }
}
