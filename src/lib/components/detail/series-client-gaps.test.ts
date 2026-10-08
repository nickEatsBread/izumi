import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The series page's last client gaps for the phone replicas: Play resumes where Continue Watching
// does, its season, the rating row's hooks, the progress row, the folding actions row, the studio
// button, the related titles' kind and the recommendations among them, and the status words.
const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const detail = read('./AnimeDetail.svelte')
const list = read('./EpisodeList.svelte')
const scale = read('./ScoreScale.svelte')
const node = read('../themes/ThemeNode.svelte')
const snippet = (name: string) => {
  const start = detail.indexOf(`{#snippet ${name}(`)
  return detail.slice(start, detail.indexOf('{/snippet}', start))
}

describe('Play resumes where Continue Watching does', () => {
  it('counts an episode opened here and not finished, as Continue Watching does', () => {
    expect(detail).toContain('const resumeThrough = $derived(shown ? seriesResumeProgress(shown, $localHistory, $sessionProgress, $manualProgressOverrides) : 0)')
    expect(detail).toContain('return animeResumeEpisode(m, resumeThrough)')
    // Under way by the shared rule (resume.ts), which also counts an episode 1 left part-way.
    expect(detail).toContain('const ctaStarted = $derived(shown != null && seriesUnderWay(resumeThrough, $positions[progressKey(shown.id, ctaEp(shown))]))')
    expect(detail).not.toContain('ctaHasProgress')
    // The watched marks keep the episodes finished.
    expect(detail).toContain('animeWatchedProgress(shown, $localHistory, $sessionProgress, $manualProgressOverrides)')
  })
  it('opens the episode list, its Continue card and its fast lane on the same episode', () => {
    expect(list).toContain(': animeResumeEpisode(media, resumeThrough))')
    expect(list).toContain('openingPage(allEpisodes, PER, ctaEpisode, resumeThrough)')
    expect(list).toContain('Math.min(resumeThrough + 1, aired || 1)')
    // Watched marks and states stay on the finished count.
    expect(list).toContain('const watchedThrough = $derived(animeWatchedProgress(media, $localHistory, $sessionProgress, $manualProgressOverrides))')
  })
  it("names the Play episode's season from the episode metadata", () => {
    expect(detail.match(/data-season=\{ctaSeason\(m\)\?\.season\} data-season-episode=\{ctaSeason\(m\)\?\.episode\}/g)?.length).toBe(3)
    expect(detail).toContain('void getEpisodeMeta(canonical, undefined, apply).then(apply, () => {})')
    expect(detail).toContain("const seasonMetaKey = $derived(media && !$offlineMode ? animeEpisodeMetadataKey(media) : '')")
  })
})

describe('the rating row', () => {
  it('carries its hook on every layout, as a contents box on the phone overlay page', () => {
    expect(detail.match(/<div data-part="detail\.rating" class="mt-4">\{@render ratingRow\(\)\}<\/div>/g)?.length).toBe(4)
    expect(detail).toContain('<div class="mt-4"><div data-part="detail.rating" class="contents">{@render ratingRow()}</div></div>')
    expect(snippet('ratingRow')).toContain('hint={ratingHint} parts />')
  })
  it('names the label, the readout and the steps only on the series page', () => {
    expect(scale).toContain("data-part={parts ? 'detail.rating.label' : undefined}")
    expect(scale).toContain("data-part={parts ? 'detail.rating.value' : undefined}")
    expect(scale.match(/data-part=\{parts \? 'detail\.rating\.segment' : undefined\}/g)?.length).toBe(2)
    expect(scale).toContain("data-active={parts && (kind === 'bar' ? n <= shown : n === shown) ? '' : undefined}")
  })
})

describe('the series progress row', () => {
  it('sits under the header buttons on both phone pages', () => {
    expect(detail).toContain('{@render headerButtonRow(m, true)}\n          {@render progressRow(m, true)}')
    expect(detail).toContain('{@render headerButtonRow(m, false)}\n        {@render progressRow(m, false)}')
  })
  it('shows the Play episode, the total and the share watched once the series is under way', () => {
    const row = snippet('progressRow')
    expect(row).toContain("{#if detailTheme.progress === 'row' && media && ctaStarted}")
    expect(row).toContain('seriesFraction(episode, resumeThrough, positionPercent($positions[progressKey(m.id, episode)]), total)')
    expect(row).toContain('<div data-part="detail.progress" data-episode={episode} style:--progress={percent}')
    expect(row).toContain("Episode {episode}{total ? ` of ${total}` : ''}")
    expect(row).toContain('data-part="detail.progress.value"')
    expect(row).toContain('<div data-part="detail.progress.meter" role="progressbar"')
  })
})

describe('the folding actions row', () => {
  it('reveals Save, Share and Trailer on the first tap, and opens the menu on the next', () => {
    expect(detail).toContain("const actionsFold = $derived(detailTheme.actions === 'expand')")
    expect(detail).toContain('if (actionsFold && !actionsOpen) { actionsOpen = true; return }')
    expect(detail).toContain("<div data-part=\"detail.actions\" data-expanded={actionsFold && actionsOpen ? '' : undefined}")
    expect(detail).toContain('{#if !actionsFold || actionsOpen}')
    expect(detail).toContain('data-action="more" data-focusable onclick={pressMore}')
  })
  it('folds again when the menu closes', () => {
    expect(detail).toContain('function closeMenu() {\n    showMore = false\n    if (actionsFold) actionsOpen = false\n  }')
    expect(detail).toContain('onclick={closeMenu}')
    expect(detail).toContain("if (e.key === 'Escape' && (showMore || actionsOpen)) closeMenu()")
  })
})

describe('the studio button', () => {
  it("opens the main studio's page from the header and facts templates", () => {
    expect(detail).toContain('return studio ? { studio: () => { h.tap(); void goto(studioHref(studio)) } } : {}')
    expect(detail).toContain('<ThemeNode node={detailTheme.header} model={factsModel(m)} actions={templateActions(m)} />')
    expect(detail.match(/<ThemeNode node=\{detailTheme\.facts\} model=\{factsModel\(m\)\} actions=\{templateActions\(m\)\} \/>/g)?.length).toBe(2)
  })
  it('renders a button with data-action="studio" reading the studio, only when there is one', () => {
    expect(node).toContain("{#if item.action && actions[item.action] && (item.action !== 'studio' || model.studio)}")
    expect(node).toContain("data-action={item.action === 'studio' ? 'studio' : undefined}")
    expect(node).toContain("item.action === 'studio' ? displayText('studio', model) : labels[item.action]")
  })
})

describe('relations', () => {
  it('names the kind of every related title', () => {
    expect(detail.match(/data-media=\{relationMedia\(e\.node\)\}/g)?.length).toBe(2)
  })
  it('follows them with the recommendations when the theme appends them', () => {
    expect(detail).toContain('{@const appended = (phone ? mobileTabs : desktopTabs).recommendedInRelations ? recommendedTitles(m) : []}')
    expect(detail.match(/<div data-part="relation" data-relation="recommended" data-media=\{relationMedia\(recommendation\)\}/g)?.length).toBe(2)
    expect(detail.match(/\{#if m\.relations\?\.edges\?\.length \|\| appended\.length\}/g)?.length).toBe(1)
    expect(detail).toContain('{:else if m.relations?.edges?.length || appended.length}')
  })
})

describe('status words', () => {
  it('word the templates and izumi\'s own facts lines as the facts do', () => {
    expect(detail).toContain("...(detailTheme.factsFormat?.status === 'plain' ? { status: statusText(m, 'plain') || undefined } : {}),")
    expect(detail).toContain('const statusWord = (m: Media) => statusText(m, detailTheme.factsFormat?.status)')
    expect(detail.match(/statusWord\(m\)/g)?.length).toBe(6)
    expect(detail).not.toMatch(/\{status\(m\)\}/)
  })
})
