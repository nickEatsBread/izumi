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
