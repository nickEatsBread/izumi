/** The izumi mark, wordmark and name are never themed. They show in persistent UI, so they can't count as
 *  protected surfaces (that would keep the theme stylesheet in its slow `@scope` form). Each draws inside a
 *  shadow root, which no document stylesheet reaches, and its host's own box is pinned inline: an inline
 *  `!important` declaration outranks every stylesheet's. Ancestors stay within a theme's reach, as before. */

/** What a theme could set on the host to hide, box, recolour or distort what it draws. */
const HOST_GUARD: Record<string, string> = {
  visibility: 'visible', opacity: '1', filter: 'none', 'backdrop-filter': 'none', 'mix-blend-mode': 'normal',
  transform: 'none', translate: 'none', rotate: 'none', scale: 'none', zoom: '1', position: 'static', 'z-index': 'auto',
  'clip-path': 'none', mask: 'none', '-webkit-mask': 'none', '-webkit-mask-box-image': 'none', '-webkit-box-reflect': 'none',
  overflow: 'visible', contain: 'none', 'content-visibility': 'visible', content: 'normal', appearance: 'none',
  background: 'none', border: 'none', padding: '0', 'box-shadow': 'none', outline: 'none',
}

/** Inherited styles stop at the shadow's elements, and the host gets no generated content. Brand parts are
 *  atomic inlines, so neither the host's nor an ancestor's `::first-letter` reaches their text. */
const RESET = ':host::before, :host::after { content: none !important; } :not(style) { all: initial; }'

/** `display` is the host's; `css` and `html` are fixed markup owned by the component, never user text. */
export interface BrandShadow { display: string; css: string; html: string }

export function brandShadow(node: HTMLElement, brand: BrandShadow): { update(brand: BrandShadow): void } {
  const root = node.attachShadow({ mode: 'open' })
  const render = ({ display, css, html }: BrandShadow) => {
    for (const [name, value] of Object.entries({ ...HOST_GUARD, display })) node.style.setProperty(name, value, 'important')
    root.innerHTML = `<style>${RESET}${css}</style>${html}`
  }
  render(brand)
  return { update: render }
}
