/** The editor and mpv both describe subtitle height as a percentage of the player surface. */
export function clampSubtitlePosition(value: number): number {
  if (!Number.isFinite(value)) return 92
  return Math.round(Math.min(100, Math.max(5, value)))
}

/** Convert a pointer's viewport Y coordinate into mpv's `sub-pos` value. */
export function subtitlePositionFromPointer(clientY: number, top: number, height: number): number {
  if (!Number.isFinite(height) || height <= 0) return 92
  return clampSubtitlePosition(((clientY - top) / height) * 100)
}

/** mpv subtitle font sizes are based on a 720-high OSD. Match that scale in the HTML preview. */
export function subtitlePreviewFontSize(fontSize: number, previewHeight: number): number {
  const scaled = Number(fontSize) * Math.max(1, previewHeight) / 720
  return Math.round(Math.min(120, Math.max(14, scaled)) * 10) / 10
}
