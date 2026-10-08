import { describe, expect, it } from 'vitest'
import {
  REPO_ROOT, attr, descendantsOf, markupElements, readSvelteSource, repoRelative, svelteFilesUnder, type MarkupElement,
} from '../../test/svelte-markup'

// The series page draws what the tapped card already showed (title, cover, banner) while the full
// record loads, but only when the entry point recorded it (detail-hint.ts). A link that records
// nothing opens to anonymous grey blocks, so every link to a series page has to record its media,
// and every scripted navigation has to go through openDetail or record first.
//
// A link's click must also reach SvelteKit's router, which listens on <html>, above the element
// Svelte delegates clicks from. A click stopped on the way up skips the router and the browser
// loads the URL natively, which reboots the whole app (the old Continue Watching title link).

const files = svelteFilesUnder(`${REPO_ROOT}src`)
const elements = files.flatMap((file) => markupElements(file))
const anchors = elements.filter((el) => el.name === 'a')
const where = (el: MarkupElement) => `${repoRelative(el.file)}:${el.line}`

const SERIES_HREF = /mediaHref\(|catalogMediaHref\(|\/app\/(?:anime|media)\//
const RECORDS = /rememberDetail\(|openDetail\(/

/** Links to a series page that may carry no hint, each with the reason. Keep this short. */
const HINTLESS_LINKS: Record<string, string> = {}

/** Files that navigate to `mediaHref(…)` from script without recording a hint, with the reason. */
const SCRIPTED_WITHOUT_HINT: Record<string, string> = {
  // Hero's play and info buttons record the slide (rememberDetail(current)) before these callbacks
  // run; the pin in the test below keeps that true.
  'src/lib/components/catalog/CatalogHome.svelte': 'Hero callbacks',
  'src/lib/components/catalog/MergedCatalogHome.svelte': 'Hero callbacks',
  'src/routes/app/home/+page.svelte': 'Hero callbacks',
}

function recordsHint(el: MarkupElement): boolean {
  if (attr(el, 'use:detailLink')) return true
  return ['onclick', 'onpointerdown'].some((name) => RECORDS.test(attr(el, name)?.raw ?? ''))
}

/** An in-app link: SvelteKit routes it, so a stopped click turns it into a full reload. */
function inAppLink(el: MarkupElement): boolean {
  const href = attr(el, 'href')
  if (!href || attr(el, 'target') || attr(el, 'download')) return false
  return !/^href=["'{`]*(?:https?:|mailto:|tel:|#)/.test(href.raw)
}

const stopsClick = (el: MarkupElement) => /stopPropagation\(\)/.test(attr(el, 'onclick')?.raw ?? '')
/** A stopped click is fine when the handler cancels the native load and routes the click itself. */
const routesItself = (el: MarkupElement) => {
  const raw = attr(el, 'onclick')?.raw ?? ''
  return /preventDefault\(\)/.test(raw) && /goto\(|openDetail\(/.test(raw)
}

describe('series links carry a detail hint', () => {
  it('finds the links it guards', () => {
    const guarded = anchors.filter((el) => SERIES_HREF.test(attr(el, 'href')?.raw ?? ''))
    expect(guarded.length).toBeGreaterThan(20)
    for (const file of ['LatestEpisodes', 'SeasonPicker', 'WatchlistView', 'ContinueCard', 'SmallCard']) {
      expect(guarded.some((el) => el.file.includes(file)), file).toBe(true)
    }
  })

  it('records the media on every link to a series page', () => {
    const missing = anchors
      .filter((el) => SERIES_HREF.test(attr(el, 'href')?.raw ?? ''))
      .filter((el) => !recordsHint(el) && !HINTLESS_LINKS[where(el)])
      .map(where)
    expect(missing).toEqual([])
  })

  it('records the media before scripted navigation to a series page', () => {
    const missing = files
      .filter((file) => /goto\(mediaHref\(/.test(readSvelteSource(file)))
      .filter((file) => !RECORDS.test(readSvelteSource(file)) && !SCRIPTED_WITHOUT_HINT[repoRelative(file)])
      .map(repoRelative)
    expect(missing).toEqual([])
    const hero = readSvelteSource(`${REPO_ROOT}src/lib/components/banner/Hero.svelte`)
    expect(hero).toContain('rememberDetail(current); onplay?.(current)')
    expect(hero).toContain('rememberDetail(current); oninfo?.(current)')
  })
})

describe('in-app link clicks reach the router', () => {
  it('never stops a link click without cancelling it and routing it', () => {
    const stopped = anchors.filter((el) => stopsClick(el) && !routesItself(el)).map(where)
    expect(stopped).toEqual([])
  })

  it('never stops a click on the way up from an in-app link', () => {
    const stopped = elements
      .filter((el) => el.name !== 'a' && stopsClick(el))
      .flatMap((el) => descendantsOf(el, elements).filter((child) => child.name === 'a' && inAppLink(child) && !routesItself(child))
        .map((child) => `${where(child)} under ${where(el)}`))
    expect(stopped).toEqual([])
  })

  it('routes the Continue Watching title itself, so a title tap opens the page and a card tap still plays', () => {
    const title = anchors.find((el) => el.file.endsWith('ContinueCard.svelte') && attr(el, 'data-part')?.value === 'card.title')
    expect(title).toBeDefined()
    const onclick = attr(title!, 'onclick')?.raw ?? ''
    expect(onclick).toContain('e.preventDefault(); e.stopPropagation()')
    expect(onclick).toContain('openDetail(media, name)')
  })
})
