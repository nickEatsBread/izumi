// Human-readable byte + speed formatters for the debrid caching screen.
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(n?: number): string {
  if (n == null || n < 0) return ''
  if (n < 1024) return `${n} B`
  let v = n
  let u = 0
  while (v >= 1024 && u < UNITS.length - 1) { v /= 1024; u++ }
  return `${v.toFixed(1)} ${UNITS[u]}`
}

export function formatSpeed(n?: number): string {
  if (n == null || n < 0) return ''
  return `${formatBytes(n)}/s`
}

const BIT_UNITS = ['b', 'kb', 'Mb', 'Gb', 'Tb']

/** Network rate in decimal bits per second, compact: `0 b/s`, `850.2 kb/s`, `3.6 Mb/s`. */
export function formatBitRate(mbps?: number): string {
  const bits = mbps != null && Number.isFinite(mbps) ? mbps * 1e6 : 0
  if (bits < 1) return '0 b/s'
  const exponent = Math.min(Math.floor(Math.log10(bits) / 3), BIT_UNITS.length - 1)
  return `${Number((bits / 1000 ** exponent).toFixed(1))} ${BIT_UNITS[exponent]}/s`
}
