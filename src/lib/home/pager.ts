export type PageItem = number | 'gap'

/** Page buttons: the first page, the current page and its neighbours, and the last page when the
 * catalog reports one. Unknown totals show one page past the current one while more exist. */
export function pageWindow(page: number, hasNext: boolean, lastPage?: number): PageItem[] {
  const knownLast = lastPage && lastPage >= page ? lastPage : undefined
  const last = knownLast ?? (hasNext ? page + 1 : page)
  const wanted = [...new Set([1, page - 1, page, page + 1, ...(knownLast ? [knownLast] : [])])]
    .filter((n) => n >= 1 && n <= last)
    .sort((a, b) => a - b)
  const out: PageItem[] = []
  for (const n of wanted) {
    const previous = out[out.length - 1]
    if (typeof previous === 'number' && n - previous > 1) out.push('gap')
    out.push(n)
  }
  return out
}
