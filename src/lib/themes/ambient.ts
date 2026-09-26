/** Average artwork colour for theme glows, weighted toward saturated pixels so a dark still still
 *  yields its accent. Returns "r g b" for `rgb(var(--hero-ambient-rgb) / <alpha>)`. */
export function ambientFromPixels(data: ArrayLike<number>): string | undefined {
  let r = 0, g = 0, b = 0, total = 0
  for (let index = 0; index + 3 < data.length; index += 4) {
    const alpha = data[index + 3] / 255
    const max = Math.max(data[index], data[index + 1], data[index + 2])
    const min = Math.min(data[index], data[index + 1], data[index + 2])
    const weight = alpha * (0.15 + (max - min) / 255)
    r += data[index] * weight; g += data[index + 1] * weight; b += data[index + 2] * weight; total += weight
  }
  if (!total) return undefined
  return [r, g, b].map((value) => Math.round(value / total)).join(' ')
}

const cache = new Map<string, Promise<string | undefined>>()
/** Resolves undefined when the image cannot be read (CORS-tainted canvas, network error). */
export function sampleAmbient(src: string): Promise<string | undefined> {
  if (typeof document === 'undefined' || !src) return Promise.resolve(undefined)
  let pending = cache.get(src)
  if (!pending) {
    pending = new Promise<string | undefined>((resolve) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.decoding = 'async'
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = 16; canvas.height = 16
          const context = canvas.getContext('2d', { willReadFrequently: true })
          if (!context) return resolve(undefined)
          context.drawImage(image, 0, 0, 16, 16)
          resolve(ambientFromPixels(context.getImageData(0, 0, 16, 16).data))
        } catch { resolve(undefined) }
      }
      image.onerror = () => resolve(undefined)
      image.src = src
    })
    if (cache.size >= 64) cache.delete(cache.keys().next().value as string)
    cache.set(src, pending)
  }
  return pending
}
