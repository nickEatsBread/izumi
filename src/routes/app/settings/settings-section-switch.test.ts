import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { attr, markupElementsFromSource, staticAttr } from '../../../test/svelte-markup'

const layout = readFileSync(fileURLToPath(new URL('./+layout.svelte', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const elements = markupElementsFromSource(layout, '+layout.svelte')

describe('desktop Settings section switch', () => {
  it('fades the new section in, keyed by section, inside the desktop content column', () => {
    const column = elements.find((el) => staticAttr(el, 'data-nav-surface') === 'settings' && staticAttr(el, 'class') === 'min-w-0 flex-1')
    // The controller pane fades too (its own test); the desktop one sits in the content column.
    const faded = elements.filter((el) => attr(el, 'in:fly')?.raw === 'in:fly={sectionFade()}')
    expect(column).toBeDefined()
    expect(faded.some((el) => el.ancestors[0] === column)).toBe(true)
    expect(layout).toContain('{#key railSection}')
    expect(layout).toContain('const railSection = $derived(sectionForPath($page.url.pathname)?.id ?? $page.url.pathname)')
    expect(layout).toContain("import { sectionFade } from '$lib/settings/section-scroll'")
    // The phone push keeps its own transition.
    expect(layout).toContain('in:fly={{ y: 12, duration: 160, opacity: 0 }}')
  })

  it('starts a rail switch to another section at its top, leaving history steps, anchors and search hits alone', () => {
    expect(layout).toContain("import { afterNavigate, beforeNavigate } from '$app/navigation'")
    expect(layout).toContain("import { forgetScroll } from '$lib/navigation/scroll-restoration'")
    expect(layout).toContain("if ($isMobile || type !== 'link' || !to?.url || to.url.hash || to.url.searchParams.has(SETTING_PARAM)) return")
    expect(layout).toContain('if (next && next.id !== sectionForPath($page.url.pathname)?.id) forgetScroll(to.url)')
  })
})
