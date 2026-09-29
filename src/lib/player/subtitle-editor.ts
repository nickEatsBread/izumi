/** Subtitle positions are the bottom edge of dialogue, as a percentage of the frame height. */
export function clampSubtitlePosition(value: number): number {
  if (!Number.isFinite(value)) return 92
  return Math.round(Math.min(100, Math.max(5, value)))
}

/** Convert a pointer's viewport Y coordinate into a position within the frame. */
export function subtitlePositionFromPointer(clientY: number, top: number, height: number): number {
  if (!Number.isFinite(height) || height <= 0) return 92
  return clampSubtitlePosition(((clientY - top) / height) * 100)
}
