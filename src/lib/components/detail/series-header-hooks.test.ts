import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Theme API 4 on the series page: action states, the header buttons, the bar's parts, the facts'
// names and formats, the Information block, related titles by type, the synopsis control, the
// countdown's place and the actions-row lead. Every hook renders in the loading page too: it is the
// same markup, drawn from the tapped card's record.
const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
const detail = read('./AnimeDetail.svelte')
const snippet = (name: string) => {
  const start = detail.indexOf(`{#snippet ${name}(`)
  return detail.slice(start, detail.indexOf('{/snippet}', start))
}

describe('series action states', () => {
  it('marks every Play button, and only those', () => {
    // The phone header (stacked page and overlay body share it), the desktop overlay and the desktop bar.
    expect(detail.match(/data-part="button" data-variant="primary" data-action="play"/g)?.length).toBe(3)
    expect(detail.match(/data-variant="primary"/g)?.length).toBe(3)
    expect(snippet('headerButtonList')).toContain('onclick={pressPlay}')
  })
  it('says when the title is listed or saved', () => {
    expect(detail.match(/data-part="detail\.list-button"[^>]*? data-state=\{effStatus \? 'listed' : undefined\}/g)?.length).toBe(3)
    expect(detail.match(/data-action="save" data-state=\{savedLocally \? 'saved' : undefined\}/g)?.length).toBe(3)
  })
})

describe('the phone header buttons', () => {
  it("follows the theme's list, else izumi's own", () => {
    expect(detail).toContain("detailTheme.buttons ?? (detailTheme.listButton === 'full' && !overlayDetail ? ['play', 'list'] : ['play'])")
    expect(detail.match(/\{@render headerButtonRow\(m, (true|false)\)\}/g)).toEqual(['{@render headerButtonRow(m, true)}', '{@render headerButtonRow(m, false)}'])
  })
  it('wraps them in detail.buttons only when the theme sets the key, so older stylesheets keep their structure', () => {
    const row = snippet('headerButtonRow')
    expect(row).toContain('{#if !detailTheme.buttons}\n    {@render headerButtonList(m, overlay)}')
    expect(row).toContain('{:else if shownButtons.length}\n    <div data-part="detail.buttons"')
  })
  it('downloads the Play episode in one tap, and leaves Download out with nothing to download', () => {
    const list = snippet('headerButtonList')
    expect(list).toContain('data-part="button" data-variant="secondary" data-action="download" data-state={downloadState} data-episode={downloadEp}')
    expect(list).toContain('{@const downloadEp = ctaEp(m)}')
    expect(list).toContain('{@const download = $downloads[keyFor(m.id, downloadEp)]}')
    expect(list).toContain('onclick={ready((full) => downloadCta(full))}')
    // Its text and progress follow the download, the tap's feedback.
    expect(list).toContain('<span aria-live="polite">{episodeDownloadText(download, String(downloadEp))}</span>')
    expect(list).toContain('style:--download-progress="{episodeDownloadPercent(download)}%"')
    // The press the episode's own download button makes: queue with the defaults, else open Downloads.
    const press = detail.slice(detail.indexOf('function downloadCta('), detail.indexOf('function downloadSelect('))
    expect(press).toContain('if (pressEpisodeDownload(m, ep, $downloads[keyFor(m.id, ep)]) === \'queue\') h.select()')
    expect(press).not.toContain('startDownloadSelect')
    expect(detail).toContain("const downloadable = $derived(shown != null && !$offlineMode && (pending || playableThrough(listEpisodes(shown), airedCount(shown), false) > 0))")
  })
  it('keeps the download selection a menu tap away beside a header Download', () => {
    const select = detail.slice(detail.indexOf('function downloadSelect('), detail.indexOf('// A TV request already chose'))
    expect(select).toContain('if (startDownloadSelect(ctaEp(m), m.id)) return')
    // With the episodes in another tab, that tab opens and its list takes the request.
    expect(select).toContain("if (mobileTabs.tabs.includes('episodes')) pickedTab = 'episodes'")
    const menu = detail.slice(detail.indexOf('<div data-part="detail.menu"'), detail.indexOf('{#each externalTrackerLinks as tracker'))
    expect(menu).toContain("{#if shownButtons.includes('download')}")
    expect(menu).toContain('onclick={ready((full) => downloadSelect(full))}')
    expect(menu).toContain('Download episodes')
  })
})

describe('the series bar', () => {
  it('names its back button, scrolled title and scrim on every phone page', () => {
    // Overlay and stacked pages, and the failure bar's back button.
    expect(detail.match(/data-part="detail\.back"/g)?.length).toBe(3)
    expect(detail.match(/<span data-part="detail\.bar\.title"/g)?.length).toBe(2)
    expect(detail.match(/<div data-part="detail\.bar\.scrim"/g)?.length).toBe(2)
  })
})

describe('facts and the Information block', () => {
  it('passes the theme keys, names and formats to every fact list', () => {
    expect(detail.match(/<FactList [^\n]*keys=\{detailTheme\.factsKeys\} labels=\{detailTheme\.factsLabels\} format=\{detailTheme\.factsFormat\} \{pending\} \/>/g)?.length).toBe(2)
    const list = read('./FactList.svelte')
    expect(list).toContain('mediaFacts(media, { keys, labels, format, progress, pending })')
    expect(list).toContain('<span data-part="fact.suffix">{fact.suffix}</span>')
    expect(list).toContain('{#if fact.pending}')
  })
  it('draws the Information grid from the facts, where the sections put it', () => {
    expect(snippet('informationBlock')).toContain('<section data-part="detail.info"')
    expect(snippet('informationBlock')).toContain('{#each infoFacts(m) as fact (fact.key)}')
    expect(detail).toContain("{#if mobileTabs.information === 'overview'}{@render informationBlock(m, true)}{/if}")
    // Its own section is drawn from the card's record while loading, like Overview.
    expect(detail).toContain("{:else if id === 'information'}")
    expect(detail.indexOf("{:else if id === 'information'}")).toBeLessThan(detail.indexOf('{@render sectionPlaceholder(phone)}'))
    // A loading fact holds a placeholder, never "Unknown".
    expect(snippet('infoValue')).toContain('{#if fact.pending}<span class="inline-block h-3.5')
    expect(detail).not.toContain("|| 'Unknown'")
  })
  it("names the Overview's blocks, with placeholders while the card's record lacks them", () => {
    expect(detail.match(/data-part="detail\.block-title"/g)?.length).toBe(9)
    expect(detail.match(/<section data-part="detail\.tags"/g)?.length).toBe(2)
    expect(detail.match(/<section data-part="detail\.synonyms"/g)?.length).toBe(2)
    expect(detail).toContain('{:else if pending && m.tags === undefined}')
    expect(detail).toContain('{:else if pending && m.synonyms === undefined}')
  })
})

describe('related titles', () => {
  it('carry their relation type on phones and desktop', () => {
    expect(detail.match(/<div data-part="relation" data-relation=\{e\.relationType\.toLowerCase\(\)\}/g)?.length).toBe(2)
  })
})

describe('the phone synopsis control', () => {
  it('follows every phone synopsis the stylesheet can clamp', () => {
    expect(detail.match(/\{@render synopsisMoreButton\('(info|body|overview)'\)\}/g)?.length).toBe(3)
    expect(detail.match(/use:clampWatch=\{\{ place: '(info|body|overview)'/g)?.length).toBe(3)
    expect(detail.match(/data-expanded=\{synopsisOpen\.(info|body|overview) \|\| undefined\}/g)?.length).toBe(3)
    const control = snippet('synopsisMoreButton')
    expect(control).toContain("{#if synopsisMore !== 'none' && (synopsisClamped[place] || synopsisOpen[place])}")
    expect(control).toContain("{synopsisOpen[place] ? 'Show less' : synopsisLabel}")
    expect(detail).toContain("const SYNOPSIS_MORE = { more: 'More', 'read-more': 'Read more', 'show-more': 'Show more' } as const")
  })
  it('leads to Overview only from text outside it, and otherwise opens in place with its state announced', () => {
    expect(detail).toContain("const opensOverview = (place: SynopsisPlace) => synopsisMore === 'tab' && place !== 'overview'")
    expect(detail).toContain('if (!opensOverview(place)) { toggleSynopsis(place); return }')
    expect(snippet('synopsisMoreButton')).toContain('aria-expanded={opensOverview(place) ? undefined : synopsisOpen[place]}')
  })
  it('measures the clamp outside the reactive graph', () => {
    expect(detail).toContain('const clamped = node.scrollHeight > node.clientHeight + 1')
    expect(detail).toContain('update(next: typeof options) { current = next; untrack(measure) }')
  })
})

describe('the countdown and the actions-row lead', () => {
  it('leaves the facts when the theme puts the countdown in the episode list', () => {
    expect(detail).toContain("const countdown = $derived(detailTheme.countdownAt === 'episodes' ? 'none' : detailTheme.countdown ?? 'none')")
  })
  it('renders the lead first in the phone actions row with the watched count', () => {
    expect(detail).toContain('<div data-part="detail.lead" class="min-w-0 flex-1">')
    expect(detail).toContain('<ThemeNode node={detailTheme.actionsLead} model={leadModel(m)} />')
    expect(detail).toContain('const episodesWatched = $derived(effStatus || effProgress > 0 ? effProgress : undefined)')
  })
})

describe('the fallback catalog record', () => {
  it('is told apart through the client, not a field the query never selects', () => {
    expect(detail).toContain('const backupRecord = $derived(!source && !!media && isBackupRecord(id))')
    expect(detail).not.toContain('catalog?.provider')
  })
})
