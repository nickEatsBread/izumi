import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('series page theme options', () => {
  it('renders the fact styles on phones and desktops', () => {
    const detail = read('./AnimeDetail.svelte')
    expect(detail.match(/<FactList /g)?.length).toBe(2)
    expect(read('./FactList.svelte')).toContain('data-part="detail.facts" data-variant={variant}')
  })
  it('shows the airing countdown where the theme asks for it', () => {
    const detail = read('./AnimeDetail.svelte')
    expect(detail.match(/<AiringCountdown /g)?.length).toBe(2)
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
