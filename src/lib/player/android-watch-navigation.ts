/** The persistent Android watch page lives outside AndroidPlayer so its Disqus iframe survives the
 * preparation -> native-video hand-off. Related-title navigation still needs AndroidPlayer's full
 * teardown; this tiny bridge lets the persistent page request that teardown without owning it. */
let relatedHandler: ((href: string) => void | Promise<void>) | null = null

export function setAndroidRelatedHandler(handler: ((href: string) => void | Promise<void>) | null) {
  relatedHandler = handler
}

export function requestAndroidRelated(href: string): boolean {
  if (!relatedHandler) return false
  void relatedHandler(href)
  return true
}
