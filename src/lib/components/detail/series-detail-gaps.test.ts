import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Theme API 4 additions for phone replicas of the series page: the portrait header art and its cover
// fallback, Play states, hooks on the containers themes reached structurally, the bar's Home link,
// logo and solid point, the facts template's extras, the actions-row count, the synopsis tap and the
// single season's name.
const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
const detail = read('./AnimeDetail.svelte')
const snippet = (name: string) => {
  const start = detail.indexOf(`{#snippet ${name}(`)
  return detail.slice(start, detail.indexOf('{/snippet}', start))
}

describe('the header art', () => {
  it('passes the portrait poster, the cover and the fallback to the one choice', () => {
    expect(detail).toContain('poster: detailExtras.posterHd,')
    expect(detail).toContain('cover: (shown && cover(shown)) || undefined,')
    expect(detail).toContain('fallback: detailTheme.artFallback,')
    // Every kind with a source paints, on every layout (the desktop banner too).
    expect(detail).toContain("const headerSrc = $derived('src' in headerArt ? headerArt.src : '')")
    expect(read('../banner/Hero.svelte')).toContain("if (artwork) return 'src' in artwork ? artwork.src : ''")
  })
})

describe('Play states', () => {
  it('marks every Play button with its state and episode', () => {
    expect(detail).toContain("const ctaState = $derived(ctaStarted ? 'resume' : 'start')")
    expect(detail.match(/data-action="play" data-state=\{ctaState\} data-episode=\{ctaEp\(m\)\} data-season=\{ctaSeason\(m\)\?\.season\} data-season-episode=\{ctaSeason\(m\)\?\.episode\}/g)?.length).toBe(3)
    expect(detail.match(/data-action="play"/g)?.length).toBe(3)
  })
})

describe('container hooks', () => {
  it('names the phone column, title row, Overview, artwork fade, release-timing box and More menu', () => {
    expect(detail.match(/<div data-part="detail\.content" class="px-4">/g)?.length).toBe(2)
    expect(detail).toContain(`<div data-part="detail.head" class="relative z-10 {detailTheme.bannerHidden ? 'mt-2' : '-mt-10'} flex gap-4">`)
    expect(detail.match(/<div data-part="detail\.overview" class="mt-4 space-y-5">/g)?.length).toBe(2)
    expect(detail.match(/<div data-part="detail\.banner\.fade" /g)?.length).toBe(2)
    // The phone facts' box and the desktop gutter boxes around AiringStatus.
    expect(detail.match(/<div data-part="detail\.airing\.wrap" /g)?.length).toBe(3)
    expect(detail).toContain('<div data-part="detail.menu" class="absolute bottom-full right-0 z-50')
  })
})

describe('the phone series bar', () => {
  it('adds a Home link after Back on every phone bar when the theme asks', () => {
    expect(detail.match(/\{#if detailTheme\.bar\?\.home\}\{@render barHome\(\)\}\{\/if\}/g)?.length).toBe(3)
    expect(snippet('barHome')).toContain('<a data-part="detail.home" data-focusable href="/app/home" aria-label="Home"')
  })
  it('shows the title logo in place of the scrolled title text, and loads it for the bar alone', () => {
    expect(detail).toContain("const barLogo = $derived(detailTheme.bar?.title === 'logo' && detailExtras.logo && detailExtras.logo !== failedDetailLogo ? detailExtras.logo : '')")
    expect(detail.match(/\{#if barLogo\}<img data-part="detail\.bar\.logo" src=\{barLogo\} alt=\{title\(m\)\}/g)?.length).toBe(2)
  })
  it('turns solid where the theme says', () => {
    expect(detail).toContain('heroBarState(window.scrollY, artHeight, barHeight, wasSolid, detailTheme.bar?.solidAt)')
  })
})

describe('template models', () => {
  it('binds the title extras in the header, facts and lead templates', () => {
    expect(detail).toContain('reviews: m.popularity ? String(m.popularity) : undefined, episodesWatched, ...detailExtras,')
    expect(detail).toContain('<ThemeNode node={detailTheme.header} model={factsModel(m)} actions={templateActions(m)} />')
    expect(detail).toContain('<ThemeNode node={detailTheme.actionsLead} model={leadModel(m)} />')
  })
  it("leaves the actions-row lead's episode count to the catalog, as the cards do", () => {
    // Absent while the catalog does not know it ("Total of 1180 / ??"), never the aired count again.
    expect(detail).toContain('const leadModel = factsModel')
    expect(detail).not.toMatch(/const leadModel[^\n]*(epsTotal|airedCount)/)
  })
})

describe('the synopsis tap', () => {
  it('opens Overview from the clamped text under `more: "tab"`, and toggles otherwise', () => {
    expect(detail).toContain("onclick={() => tapSynopsis('info')}")
    expect(detail).toContain('if (opensOverview(place) && synopsisClamped[place] && !synopsisOpen[place]) pressSynopsisMore(place)')
    expect(detail).toContain('else toggleSynopsis(place)')
  })
})

describe('the single season', () => {
  it("names it on the Episodes section's heading", () => {
    expect(detail.match(/<h2 data-part="detail\.section-title" data-season-label=\{id === 'episodes' \? seasonLabel : undefined\}/g)?.length).toBe(2)
    expect(detail).toContain('const seasonLabel = $derived(media ? singleSeasonLabel(media, seasonChain) : undefined)')
    // The walk is the season picker's own (cached per title), and only under a picker.
    expect(detail).toContain("(detailTheme.episodes?.seasons ?? 'none') !== 'none' && mayListSeasons(media.format)")
  })
})
