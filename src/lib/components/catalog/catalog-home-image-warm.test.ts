import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const home = read('./CatalogHome.svelte')
const row = read('./CatalogSectionRow.svelte')
const card = read('../cards/SmallCard.svelte')
const warm = read('../../util/image-warm.ts')

// The Deck's first walk down Home froze a frame each time a row was reached for the first time: its
// posters decoded as they first painted. Home decodes the rows just below the screen ahead.
describe('catalog Home decodes the rows below the screen ahead', () => {
  it('warms from its root, and names the rows it has not built yet', () => {
    expect(home).toContain('<div data-slot="home" data-variant="catalog" class="pb-16" use:warmRowsBelow={pendingCovers}>')
    expect(home).toContain('<div data-part="row.pending" data-pending-row={id}')
  })

  it('asks for exactly the URLs a row\'s first cards will render', () => {
    expect(card).toContain('const coverWidth = $derived(coverWidthFor(themeRow, densityScale($themePresentation), fill, $isTv, $isMobile))')
    expect(home).toContain('const width = coverWidthFor(resolveRow($themePresentation, `${$catalogProvider}:${themeHome?.roles[id] ?? id}`), densityScale($themePresentation),')
    // A ranked row's cards fill their slot, which asks cardCover for the large asset.
    expect(row).toContain('<SmallCard {media} fill simpleHover {showCatalogSource} />')
    expect(home).toContain("row.section.presentation === 'ranked', $isTv, $isMobile)")
    expect(row).toContain('const FIRST_CARDS = 8')
    expect(home).toContain('return row.section.media.slice(0, 8).map((media) => cardCover(media, width))')
  })

  it('never decodes while the page scrolls, the banner changes slide, a video plays or the window is hidden', () => {
    expect(warm).toContain('busy: () => homeBusy(),')
    expect(warm).toContain('return get(playing) || document.hidden || performance.now() - scrolledAt < quietMs || bannerMoving()')
    expect(warm).toContain("window.addEventListener('scroll', scrolled, { capture: true, passive: true })")
    expect(warm).not.toContain('getAnimations')
    expect(warm).toContain('homeWarmer.stop()')
  })

  it('leaves the cards\' own images lazy and asynchronous', () => {
    expect(card).toContain('loading="lazy" decoding="async"')
  })
})
