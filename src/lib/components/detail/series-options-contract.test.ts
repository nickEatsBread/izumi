import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('series page theme options', () => {
  it('renders the fact styles on phones and desktops', () => {
    const detail = read('./AnimeDetail.svelte')
    expect(detail.match(/<FactList /g)?.length).toBe(2)
    expect(read('./FactList.svelte')).toContain('data-part="detail.facts" data-variant={variant}')
  })
  it('renders a facts template on phones with the model desktop uses', () => {
    const detail = read('./AnimeDetail.svelte')
    expect(detail).toContain('const factsModel = (m: Media) => mediaDisplayModel(m, { reviews: m.popularity ? String(m.popularity) : undefined })')
    expect(detail.match(/<ThemeNode node=\{detailTheme\.facts\} model=\{factsModel\(m\)\} \/>/g)?.length).toBe(2)
    const start = detail.indexOf('{#snippet phoneInfo(m: Media)}')
    const phone = detail.slice(start, detail.indexOf('{/snippet}', start))
    // The template takes the facts line and byline's place, as the table, cards and chips do...
    expect(phone).toContain("{#if factsStyle === 'template' && detailTheme.facts}")
    expect(phone).toContain('<div data-part="detail.facts" class="mt-3">')
    expect(phone.indexOf('<ThemeNode node={detailTheme.facts}')).toBeLessThan(phone.indexOf('data-part="detail.byline"'))
    // ...and without one the phone keeps its own facts line and byline.
    expect(phone).toContain("{:else if factsStyle === 'template'}")
    expect(phone).toContain('<div data-part="detail.meta" class="mt-3 flex flex-wrap')
  })
  it('shows the airing countdown where the theme asks for it', () => {
    const detail = read('./AnimeDetail.svelte')
    // The phone facts, the desktop header panel and the desktop poster column.
    expect(detail.match(/<AiringCountdown /g)?.length).toBe(3)
    const countdown = read('./AiringCountdown.svelte')
    expect(countdown).toContain('data-part="detail.countdown" data-variant={variant}')
    expect(countdown).toContain('longCountdown(')
    expect(read('./AiringStatus.svelte')).toContain('data-part="detail.airing"')
  })
  it('offers a full-width list button, a hidden one and phone bottom tabs', () => {
    const detail = read('./AnimeDetail.svelte')
    expect(detail).toContain("detailTheme.listButton === 'full'")
    expect(detail).toContain("detailTheme.listButton !== 'hidden'")
    expect(detail).toContain("variant={detailTheme.tabs === 'bottom' ? 'underline' : detailTheme.tabs}")
    const tabs = read('./Tabs.svelte')
    // The bottom tabs are a bar in the navigation's place, so the page keeps the room for them.
    expect(tabs).toContain('return suppressBottomNav({ bar: true })')
    const layout = read('../../../routes/app/+layout.svelte')
    expect(layout).toContain('!$bottomNavSuppressed')
    // A page that only covers the navigation (`detail.nav: "hidden"`) gives its room up.
    expect(layout).toContain("$bottomBarRoom ? 'mb-[calc(var(--theme-bottom-nav,4rem)+env(safe-area-inset-bottom))]' : 'mb-[env(safe-area-inset-bottom)]'")
  })
})
