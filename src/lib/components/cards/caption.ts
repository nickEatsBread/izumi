/** The focus caption under a row (`caption: "focus"`) for the element that took focus: its card's
 *  `data-caption-title` / `data-caption-meta`, else the card's visible title and meta text. */
export function captionOf(target: Element | null): { title: string; meta: string } {
  const source = target?.closest<HTMLElement>('[data-caption-title]')
  if (source) return { title: source.dataset.captionTitle ?? '', meta: source.dataset.captionMeta ?? '' }
  const card = target?.closest('[data-part="card"]')
  const text = (selector: string) => card?.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  return { title: text('[data-part="card.title"]'), meta: text('[data-part="card.meta"]') }
}
