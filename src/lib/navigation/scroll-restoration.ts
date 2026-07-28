const PREFIX = 'izumi-scroll:'

function key(url: URL) {
  return `${PREFIX}${url.pathname}${url.search}`
}

export function rememberScroll(url: URL) {
  try { sessionStorage.setItem(key(url), String(window.scrollY)) } catch { /* unavailable */ }
}

export function restoreScroll(url: URL) {
  let value: string | null = null
  try { value = sessionStorage.getItem(key(url)) } catch { /* unavailable */ }
  if (value == null) {
    window.scrollTo({ top: 0 })
    return
  }
  const top = Number(value)
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: Number.isFinite(top) ? top : 0 })))
}
