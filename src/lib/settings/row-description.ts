/** Svelte action for a SettingsRow root ([data-setting-row]): puts `id`, its controller-mode Learn
 *  more text, in the aria-describedby of every focusable the row owns, now and as its control snippet
 *  or children change, and takes it off when `id` goes. A focusable keeps any description of its own,
 *  and a row nested in this one's children describes its own focusables. Controller mode shows the
 *  text while focus is anywhere in the row, so each control that can hold that focus announces it. */
export function describeRowFocusables(node: HTMLElement, id: string | undefined) {
  let current = id
  const toggle = (token: string, on: boolean) => {
    for (const el of node.querySelectorAll('[data-focusable]')) {
      if (el.closest('[data-setting-row]') !== node) continue
      const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
      if (ids.includes(token) === on) continue
      const next = on ? [...ids, token] : ids.filter((t) => t !== token)
      if (next.length) el.setAttribute('aria-describedby', next.join(' '))
      else el.removeAttribute('aria-describedby')
    }
  }
  const observer = new MutationObserver(() => { if (current) toggle(current, true) })
  observer.observe(node, { childList: true, subtree: true })
  if (current) toggle(current, true)
  return {
    update(next: string | undefined) {
      if (current && current !== next) toggle(current, false)
      current = next
      if (current) toggle(current, true)
    },
    destroy: () => observer.disconnect(),
  }
}
