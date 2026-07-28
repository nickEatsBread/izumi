const MAX_RETRIES = 2

/** Retry transient poster/CDN failures with a short backoff, then reveal the caller's fallback. */
export function reliableImage(node: HTMLImageElement, source: string | undefined) {
  let retries = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let current = source ?? ''

  const load = () => {
    if (!current) return
    const separator = current.includes('?') ? '&' : '?'
    node.src = retries ? `${current}${separator}izumi_retry=${retries}` : current
  }
  const failed = () => {
    if (retries >= MAX_RETRIES) {
      node.dataset.failed = 'true'
      node.dispatchEvent(new CustomEvent('imagefailed'))
      return
    }
    retries++
    timer = setTimeout(load, 300 * 2 ** (retries - 1))
  }
  node.addEventListener('error', failed)
  load()
  return {
    update(next: string | undefined) {
      current = next ?? ''
      retries = 0
      delete node.dataset.failed
      load()
    },
    destroy() {
      clearTimeout(timer)
      node.removeEventListener('error', failed)
    },
  }
}
