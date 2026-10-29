/** The height a protected stream starts on for the "Preferred quality" setting: the tallest height the
 *  quality menu offers at or below it, the same "never above" order source ranking uses. `any` states
 *  no preference, so Auto; so does a preference below every offered height. */
export function preferredDrmQuality(preferred: string, heights: number[]): 'auto' | number {
  const target = Number(preferred)
  if (!Number.isFinite(target) || target <= 0) return 'auto'
  return heights.filter((height) => height <= target).sort((a, b) => b - a)[0] ?? 'auto'
}
