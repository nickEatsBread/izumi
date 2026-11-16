// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { brandShadow } from './brand'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

describe('brand shadow root', () => {
  const draw = (css = 'span { font-weight: 900; }') => {
    const host = document.createElement('span')
    document.body.append(host)
    const action = brandShadow(host, { display: 'inline-flex', html: '<span>izumi</span>', css })
    return { host, action, root: host.shadowRoot!, style: () => host.shadowRoot!.querySelector('style')!.textContent ?? '' }
  }

  it('draws the brand in a shadow root, with no light-DOM content for a stylesheet to match', () => {
    const { host, root } = draw()
    expect(host.childNodes).toHaveLength(0)
    expect(root.querySelector('span')?.textContent).toBe('izumi')
  })
  it('stops inherited styles at the brand part before its own rules apply', () => {
    const { style } = draw()
    expect(style()).toContain(':not(style) { all: initial; }')
    expect(style().indexOf('all: initial')).toBeLessThan(style().indexOf('font-weight: 900'))
  })
  it("pins the host's own box with inline !important declarations", () => {
    const { host } = draw()
    const pinned = { display: 'inline-flex', visibility: 'visible', opacity: '1', filter: 'none', transform: 'none', 'clip-path': 'none', 'content-visibility': 'visible', 'mix-blend-mode': 'normal', background: 'none', outline: 'none' }
    for (const [name, value] of Object.entries(pinned)) {
      expect(host.style.getPropertyValue(name), name).toContain(value)
      expect(host.style.getPropertyPriority(name), name).toBe('important')
    }
  })
  it('redraws when the component changes what it shows', () => {
    const { action, style } = draw()
    action.update({ display: 'inline-flex', html: '<span>izumi</span>', css: 'span { font-weight: 800; }' })
    expect(style()).toContain('font-weight: 800')
    expect(style()).not.toContain('font-weight: 900')
  })
})

describe('izumi logo pieces', () => {
  for (const file of ['../components/BrandText.svelte', '../components/Wordmark.svelte', '../components/catalog/CatalogBrandLogo.svelte']) {
    it(`${file} renders only an empty host drawn through brandShadow`, () => {
      const source = read(file)
      // The markup is everything after the component's script block.
      const scriptEnd = source.lastIndexOf('</script>')
      expect(scriptEnd).toBeGreaterThan(-1)
      const markup = source.slice(scriptEnd + '</script>'.length).trim()
      expect(markup).toMatch(/^<span data-theme-protected [^>]*use:brandShadow=\{[^}]+\}><\/span>$/)
      // A style= attribute would be rewritten by Svelte, dropping the inline guards.
      expect(markup).not.toMatch(/\sstyle[=:]/)
      expect(source).not.toContain('<style>')
    })
  }
  it('shows the white wordmark through the component on Home and in the catalog switcher', () => {
    for (const file of ['../../routes/app/home/+page.svelte', '../components/catalog/CatalogSwitcher.svelte']) {
      const source = read(file)
      expect(source, file).toContain('<Wordmark white />')
      expect(source, file).not.toContain('izumi-wordmark-white.svg')
    }
    expect(read('../components/Wordmark.svelte')).toContain('<img src="/brand/izumi-wordmark-white.svg" alt="izumi" draggable="false">')
  })
  it('keeps caller transforms and fades on wrappers, since the host pins its own', () => {
    const sidebar = read('../components/shell/Sidebar.svelte')
    expect(sidebar).toContain('<span class="grid scale-75"><CatalogBrandLogo platform={screen} /></span>')
    expect(sidebar).toContain(`<span class="flex transition-opacity duration-150 {open ? 'opacity-100' : 'opacity-0'}"><BrandText /></span>`)
    expect(sidebar).not.toMatch(/<(BrandText|CatalogBrandLogo|Wordmark)\b[^>]*className="[^"]*\b(opacity|scale|font)-/)
  })
})
