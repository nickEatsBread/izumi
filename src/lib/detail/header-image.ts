import { reliableImage } from '$lib/util/reliable-image'

/** `reliableImage` for series-page header artwork: a failed load is retried twice with a backoff
 *  (a network hiccup does not cost the title its art for the whole visit), and only then is the
 *  source reported, so the page can move to its next candidate. */
export function headerImage(node: HTMLImageElement, params: { src: string; onfailed: (src: string) => void }) {
  let current = params
  const retrying = reliableImage(node, params.src)
  const failed = () => current.onfailed(current.src)
  node.addEventListener('imagefailed', failed)
  return {
    update(next: { src: string; onfailed: (src: string) => void }) {
      const changed = next.src !== current.src
      current = next
      if (changed) retrying.update(next.src)
    },
    destroy() {
      retrying.destroy()
      node.removeEventListener('imagefailed', failed)
    },
  }
}
