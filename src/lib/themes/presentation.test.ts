import { describe, it, expect } from 'vitest'
import { parseNode, parsePresentation, resolvePresentation, resolvePlayerDock, nodeStyle, resolveRow, resolveCard, resolveDetail, episodesOnSide, episodesBelow, themeCoverage, densityScale, visibleNode, displayText, type DisplayModel } from './presentation'

describe('theme presentation contract', () => {
  it('composes new layouts from primitives with bounded styles', () => {
    const node = parseNode({ type: 'grid', style: { columns: 2, gap: 24 }, children: [{ type: 'text', field: 'title', style: { color: 'theme' } }, { type: 'artwork', artwork: 'poster' }] })
    expect(nodeStyle(node)).toContain('grid-template-columns:repeat(2,minmax(0,1fr))')
    expect(nodeStyle(node.children![0])).toContain('color:hsl(var(--theme))')
  })
  it.each([
    { type: 'script', text: 'alert(1)' },
    { type: 'text', style: { background: 'url(https://example.test)' } },
    { type: 'text', style: { fontSize: 10000 } },
    { type: 'text', onclick: 'play()' },
    { type: 'action', action: 'invoke' },
    { type: 'artwork', artwork: 'https://example.test/image' },
  ])('rejects unsupported or executable presentation input %#', value => expect(() => parseNode(value)).toThrow())
  it('rejects nested card actions and excessive template depth or size', () => {
    expect(() => parsePresentation({ rows: { defaults: { card: { type: 'action', action: 'play' } } } })).toThrow('nested actions')
    expect(() => parseNode({ type: 'stack', children: Array.from({ length: 100 }, () => ({ type: 'text', text: 'large' })) })).toThrow('complex')
    let node: unknown = { type: 'text', text: 'deep' }
    for (let i = 0; i < 10; i++) node = { type: 'stack', children: [node] }
    expect(() => parseNode(node)).toThrow('complex')
  })
  it('only shows a top-ten mark when host rank data qualifies', () => {
    const node = parseNode({ type: 'text', text: 'TOP 10', when: { field: 'rankPosition', atMost: 10 } })
    expect(visibleNode(node, { rankPosition: 1 })).toBe(true)
    expect(visibleNode(node, { rankPosition: 10 })).toBe(true)
    for (const model of [{}, { rankPosition: 11 }, { rankPosition: 0 }, { rankPosition: '1' }] as DisplayModel[]) expect(visibleNode(node, model)).toBe(false)
  })
  it('compares score conditions numerically and renders the score as a percentage', () => {
    const node = parseNode({ type: 'text', field: 'score', when: { field: 'score', atMost: 70 } })
    expect(visibleNode(node, { score: 65 })).toBe(true)
    expect(visibleNode(node, { score: 70 })).toBe(true)
    for (const model of [{}, { score: 78 }, { score: 0 }, { score: '65%' }] as DisplayModel[]) expect(visibleNode(node, model)).toBe(false)
    expect(displayText('score', { score: 78 })).toBe('78%')
    expect(displayText('rankPosition', { rankPosition: 3 })).toBe('3')
    expect(displayText('title', { title: 'Sakura' })).toBe('Sakura')
    expect(displayText('score', {})).toBe('')
  })
  it('rejects atMost on fields that are not numeric', () => {
    expect(() => parseNode({ type: 'text', text: 'New', when: { field: 'year', atMost: 2020 } })).toThrow('numeric')
    expect(() => parseNode({ type: 'text', text: 'New', when: { field: 'year' } })).not.toThrow()
  })
  it('applies anchor positioning regardless of style key order', () => {
    const first = parseNode({ type: 'stack', style: { position: 'relative', anchor: 'fill' } })
    const second = parseNode({ type: 'stack', style: { anchor: 'fill', position: 'relative' } })
    expect(nodeStyle(first)).toBe(nodeStyle(second))
    expect(nodeStyle(first)).toContain('position:absolute')
    expect(nodeStyle(first)).toContain('inset:0')
    expect(nodeStyle(parseNode({ type: 'stack', style: { anchor: 'bottom-end' } }))).toContain('inset-inline-end:0')
  })
  it('resolves global, semantic row, and exact row preferences in order', () => {
    const layout = parsePresentation({ rows: { defaults: { width: 128, layout: 'grid' }, byId: { continue: { width: 264, layout: 'carousel' }, 'merged:continue': { gap: 24 } } } })
    expect(resolveRow(layout, 'merged:continue')).toEqual({ width: 264, layout: 'carousel', gap: 24 })
    expect(resolveRow(layout, 'merged:popular')).toEqual({ width: 128, layout: 'grid' })
    expect(resolveRow(undefined)).toEqual({})
  })
  it('accepts additive page, shell, player and card slots without breaking API 1 packages', () => {
    const layout = parsePresentation({
      density: 'compact', hideCardLabels: true, trueBlack: true,
      hero: { hidden: true },
      detail: { layout: 'split', bannerHidden: true, posterWidth: 220, bannerScale: 'banner', episodes: { placement: 'right', arrangement: 'carousel', order: 'flip', search: false, card: { type: 'text', field: 'episodeTitle' } } },
      shell: { nav: 'top', compact: true, overlay: 'fade', press: 'sink' },
      player: { seekbarHeight: 8, seekbarColor: 'theme' },
      cards: { poster: { type: 'artwork', artwork: 'poster' }, continue: { type: 'text', field: 'progress' }, search: { type: 'text', field: 'title' } },
    })
    expect(layout.density).toBe('compact')
    expect(layout.detail?.layout).toBe('split')
    expect(layout.detail?.bannerScale).toBe('banner')
    expect(layout.detail?.episodes).toMatchObject({ placement: 'right', arrangement: 'carousel', order: 'flip', search: false })
    expect(layout.shell).toMatchObject({ nav: 'top', compact: true, overlay: 'fade', press: 'sink' })
    expect(layout.player?.seekbarColor).toBe('theme')
    expect(parsePresentation({ hero: { height: 40, scale: 'banner' } }).hero).toMatchObject({ height: 40, scale: 'banner' })
  })
  it('rejects unknown presentation keys, executable seekbar colors and nested episode actions', () => {
    expect(() => parsePresentation({ wallpaper: 'https://example.test' })).toThrow('unsupported')
    expect(() => parsePresentation({ player: { seekbarColor: 'url(https://example.test)' } })).toThrow()
    expect(() => parsePresentation({ detail: { episodes: { card: { type: 'action', action: 'play' } } } })).toThrow('nested actions')
    expect(() => parsePresentation({ cards: { continue: { type: 'action', action: 'play' } } })).toThrow('nested actions')
  })
  it('formats duration and progress through the shared display helper', () => {
    expect(displayText('duration', { duration: 24 })).toBe('24m')
    expect(displayText('progress', { progress: 42 })).toBe('42%')
    expect(displayText('episodeNumber', { episodeNumber: 8 })).toBe('E8')
    expect(displayText('duration', {})).toBe('')
    const node = parseNode({ type: 'text', field: 'duration', when: { field: 'duration', atMost: 30 } })
    expect(visibleNode(node, { duration: 24 })).toBe(true)
    expect(visibleNode(node, { duration: 31 })).toBe(false)
    expect(() => parseNode({ type: 'text', when: { field: 'episodeTitle', atMost: 1 } })).toThrow('numeric')
  })
  it('binds still artwork and the extra host actions', () => {
    expect(parseNode({ type: 'artwork', artwork: 'still' }).artwork).toBe('still')
    expect(parseNode({ type: 'action', action: 'trailer' }).action).toBe('trailer')
    expect(parseNode({ type: 'action', action: 'list' }).action).toBe('list')
    expect(parseNode({ type: 'action', action: 'share' }).action).toBe('share')
  })
  it('gates template parts and API 3 fields behind the declared API', () => {
    const card = { type: 'text', field: 'airingIn', part: 'hero.countdown' }
    expect(parsePresentation({ rows: { defaults: { card } } }).rows?.defaults?.card).toEqual(card)
    expect(() => parsePresentation({ rows: { defaults: { card } } }, 2)).toThrow('unsupported')
    expect(() => parsePresentation({ rows: { defaults: { card: { type: 'text', field: 'slide' } } } }, 2)).toThrow('unsupported')
    expect(() => parsePresentation({ rows: { defaults: { card: { type: 'text', part: 'hero.meta' } } } }, 2)).toThrow('unsupported')
    expect(() => parsePresentation({ rows: { defaults: { card: { type: 'text', part: 'Hero Meta' } } } })).toThrow('part name')
  })
  it('treats the new counters as numeric fields in conditions', () => {
    const template = parsePresentation({ hero: { template: { type: 'text', field: 'slides', when: { field: 'slides', atMost: 20 } } } }).hero?.template
    expect(template?.when).toEqual({ field: 'slides', atMost: 20 })
    expect(() => parsePresentation({ hero: { template: { type: 'text', when: { field: 'airingIn', atMost: 2 } } } })).toThrow('atMost')
  })
  it('rejects a theme wordmark: the izumi logo is not themeable', () => {
    expect(() => parsePresentation({ brand: 'text' })).toThrow('unsupported')
  })
  it('parses the API 3 top bar and gates it behind the declared API', () => {
    const shell = { nav: 'top', top: { labels: 'text', search: 'field-center', menu: 'drawer', brand: 'center' } }
    expect(parsePresentation({ shell }).shell?.top).toEqual({ labels: 'text', search: 'field-center', menu: 'drawer', brand: 'center' })
    expect(() => parsePresentation({ shell }, 2)).toThrow('unsupported')
    expect(() => parsePresentation({ shell: { top: { labels: 'huge' } } })).toThrow('unsupported')
    expect(() => parsePresentation({ shell: { top: { color: 'red' } } })).toThrow('unsupported')
  })
  it('parses a menu pinned down the left of the top bar', () => {
    expect(parsePresentation({ shell: { nav: 'top', top: { menu: 'side', sideWidth: 260 } } }).shell?.top).toEqual({ menu: 'side', sideWidth: 260 })
    expect(() => parsePresentation({ shell: { top: { sideWidth: 600 } } })).toThrow('range')
    expect(() => parsePresentation({ shell: { top: { menu: 'rail' } } })).toThrow('unsupported')
  })
  it('parses the handheld shell keys and the row focus caption', () => {
    const parsed = parsePresentation({
      shell: { nav: 'top', top: { bumpers: true }, hints: true },
      rows: { defaults: { caption: 'focus' }, byId: { continue: { caption: 'none' } } },
    })
    expect(parsed.shell).toEqual({ nav: 'top', top: { bumpers: true }, hints: true })
    expect(parsed.rows?.defaults?.caption).toBe('focus')
    expect(parsed.rows?.byId?.continue?.caption).toBe('none')
    expect(() => parsePresentation({ shell: { hints: 'yes' } })).toThrow('toggle')
    expect(() => parsePresentation({ shell: { top: { bumpers: 1 } } })).toThrow('toggle')
    expect(() => parsePresentation({ rows: { defaults: { caption: 'hover' } } })).toThrow('unsupported')
    expect(() => parsePresentation({ shell: { hints: true } }, 2)).toThrow('unsupported')
    expect(() => parsePresentation({ rows: { defaults: { caption: 'focus' } } }, 2)).toThrow('unsupported')
  })
  it('parses the API 3 series-page options and the bottom tab bar', () => {
    const detail = { factsStyle: 'table', countdown: 'long', listButton: 'full', tabs: 'bottom' }
    expect(parsePresentation({ detail }).detail).toEqual(detail)
    expect(() => parsePresentation({ detail: { factsStyle: 'table' } }, 2)).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { tabs: 'bottom' } }, 2)).toThrow('unsupported')
    expect(parsePresentation({ detail: { tabs: 'pills' } }, 2).detail?.tabs).toBe('pills')
    expect(() => parsePresentation({ detail: { countdown: 'soon' } })).toThrow('unsupported')
  })
  it('parses the API 3 series header template beside any facts style', () => {
    const header = { type: 'stack', part: 'series.studio', children: [{ type: 'text', field: 'studio' }, { type: 'text', field: 'score', style: { color: 'theme' } }] }
    const layout = parsePresentation({ detail: { header, factsStyle: 'cards' } })
    expect(resolveDetail(layout).header).toEqual(header)
    expect(resolveDetail(layout).factsStyle).toBe('cards')
    expect(() => parsePresentation({ detail: { header } }, 2)).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { header: { type: 'action', action: 'play' } } })).toThrow('nested actions')
    const phone = parsePresentation({ detail: { posterWidth: 180 }, mobile: { detail: { header } } })
    expect(resolveDetail(resolvePresentation(phone, true)).header).toEqual(header)
    expect(resolveDetail(resolvePresentation(phone, true)).posterWidth).toBe(180)
    expect(resolveDetail(resolvePresentation(phone, false)).header).toBeUndefined()
  })
  it('lets API 3 conditions test for artwork and for absence (a logo, else the title)', () => {
    const node = parseNode({ type: 'stack', children: [
      { type: 'artwork', artwork: 'logo', when: { field: 'logo' } },
      { type: 'text', field: 'title', when: { field: 'logo', absent: true } },
    ] })
    const [logo, title] = node.children!
    const withLogo: DisplayModel = { title: 'Sakura', logo: 'https://example.test/logo.png' }
    const withoutLogo: DisplayModel = { title: 'Sakura' }
    expect([visibleNode(logo, withLogo), visibleNode(title, withLogo)]).toEqual([true, false])
    expect([visibleNode(logo, withoutLogo), visibleNode(title, withoutLogo)]).toEqual([false, true])
    expect(visibleNode(parseNode({ type: 'text', field: 'title', when: { field: 'studio', absent: true } }), { studio: '' })).toBe(true)
    expect(() => parseNode({ type: 'text', when: { field: 'logo' } }, undefined, 0, true, 2)).toThrow('unsupported')
    expect(() => parseNode({ type: 'text', when: { field: 'title', absent: true } }, undefined, 0, true, 2)).toThrow('unsupported')
    expect(() => parseNode({ type: 'text', when: { field: 'logo', atMost: 3 } })).toThrow('atMost')
    expect(() => parseNode({ type: 'text', when: { field: 'score', atMost: 3, absent: true } })).toThrow('absent')
    expect(() => parseNode({ type: 'text', when: { field: 'title', absent: 'yes' } })).toThrow('toggle')
  })
  it('binds the first genre as an API 3 field', () => {
    expect(parseNode({ type: 'text', field: 'genre' }).field).toBe('genre')
    expect(() => parseNode({ type: 'text', field: 'genre' }, undefined, 0, true, 2)).toThrow('unsupported')
  })
  it('parses an API 3 theme layout', () => {
    const layout = {
      home: [{ block: 'genre-chips', genres: 'top' }, { role: 'hero' }, { role: 'continue' }, { block: 'ranked-list', area: 'aside', tabs: [{ label: 'TOP', role: 'trending' }] }],
      asideWidth: 320,
      nav: { home: 1, bottom: ['schedule', 'library'], top: ['search'] },
    }
    const parsed = parsePresentation({ layout }).layout
    expect(parsed?.home?.[0]).toEqual({ block: 'genre-chips', area: 'main', phone: false, genres: 'top', all: true })
    expect(parsed?.home?.[1]).toEqual({ role: 'hero' })
    expect(parsed?.nav).toEqual({ home: 1, bottom: ['schedule', 'library'], top: ['search'] })
    expect(parsePresentation({ layout: parsed })).toEqual({ layout: parsed })
    expect(() => parsePresentation({ layout }, 2)).toThrow('unsupported')
  })
  it('rejects invalid theme layouts', () => {
    expect(() => parsePresentation({ layout: { home: [{ role: 'hero' }, { role: 'hero' }] } })).toThrow('hero once')
    expect(() => parsePresentation({ layout: { home: [{ block: 'carousel' }] } })).toThrow('home block')
    expect(() => parsePresentation({ layout: { home: [{ role: 'x', title: 'y' }] } })).toThrow('unsupported')
    expect(() => parsePresentation({ layout: { nav: { bottom: ['search'], top: ['search'] } } })).toThrow('not both')
    expect(() => parsePresentation({ layout: { nav: { bottom: ['nowhere'] } } })).toThrow('unsupported')
    expect(() => parsePresentation({ layout: { asideWidth: 999 } })).toThrow('range')
    expect(() => parsePresentation({ layout: { home: Array.from({ length: 31 }, () => ({ role: 'x' })) } })).toThrow('1–30')
  })
  it('places the side column with a gutter and a starting row', () => {
    expect(parsePresentation({ layout: { asideGap: 32, asideStart: 2 } }).layout).toEqual({ asideGap: 32, asideStart: 2 })
    expect(() => parsePresentation({ layout: { asideGap: 120 } })).toThrow('range')
    expect(() => parsePresentation({ layout: { asideStart: 30 } })).toThrow('range')
    // A phone layout may move them too.
    expect(parsePresentation({ mobile: { layout: { asideStart: 0 } } }).mobile?.layout).toEqual({ asideStart: 0 })
  })
  it('parses the API 3 docked watch page keys', () => {
    const dock = { episodes: 'below', flow: 'page', maxWidth: 1100, below: ['toolbar', 'info', 'comments'], toolbar: ['episode', 'release'], hide: ['back', 'title'] }
    expect(parsePresentation({ player: { layout: 'docked', dock } }).player?.dock).toEqual(dock)
    expect(resolvePlayerDock(parsePresentation({ player: { layout: 'docked', dock } }))).toMatchObject({ flow: 'page', maxWidth: 1100, below: ['toolbar', 'info', 'comments'], toolbar: ['episode', 'release'], hide: ['back', 'title'] })
    // Beside a side rail the video's column scrolls with the discussion under it by default (API 2
    // packages included); `fixed` keeps the discussion in its own scroller, and with nothing under
    // the video there is nothing to scroll to. Below the video the page stays opt-in.
    expect(resolvePlayerDock(parsePresentation({ player: { layout: 'docked' } }, 2)).flow).toBe('page')
    expect(resolvePlayerDock(parsePresentation({ player: { layout: 'docked', dock: { episodes: 'right', width: 72 } } }, 2)).flow).toBe('page')
    expect(resolvePlayerDock(parsePresentation({ player: { layout: 'docked', dock: { flow: 'fixed' } } })).flow).toBe('fixed')
    expect(resolvePlayerDock(parsePresentation({ player: { layout: 'docked', dock: { comments: 'hidden' } } })).flow).toBe('fixed')
    expect(resolvePlayerDock(parsePresentation({ player: { layout: 'docked', dock: { comments: 'hidden', flow: 'page' } } })).flow).toBe('fixed')
    expect(resolvePlayerDock(parsePresentation({ player: { layout: 'docked', dock: { episodes: 'below' } } })).flow).toBe('fixed')
    // Without a list the grid comes first, then the discussion unless it is hidden.
    expect(resolvePlayerDock(parsePresentation({ player: { layout: 'docked', dock: { episodes: 'below', comments: 'hidden' } } })).below).toEqual(['episodes'])
    expect(() => parsePresentation({ player: { dock: { below: ['info', 'info'] } } })).toThrow('twice')
    expect(() => parsePresentation({ player: { dock: { hide: ['stats'] } } })).toThrow('unsupported')
    expect(() => parsePresentation({ player: { dock: { maxWidth: 200 } } })).toThrow('range')
    expect(() => parsePresentation({ player: { dock: { flow: 'page' } } }, 2)).toThrow('unsupported')
  })
  it('lets phones replace the home list but not the navigation', () => {
    const phoneHome = [{ role: 'continue' }]
    const parsed = parsePresentation({ layout: { home: [{ role: 'hero' }], nav: { home: 0 } }, mobile: { layout: { home: phoneHome } } })
    expect(parsed.mobile?.layout?.home).toEqual(phoneHome)
    expect(() => parsePresentation({ mobile: { layout: { nav: { home: 1 } } } })).toThrow('unsupported')
    expect(resolvePresentation(parsed, true)?.layout).toEqual({ home: phoneHome, nav: { home: 0 } })
    expect(resolvePresentation(parsed, false)?.layout?.home).toEqual([{ role: 'hero' }])
  })
})

describe('theme surface resolution', () => {
  it('defaults a split series page to a right-hand episode rail', () => {
    const split = parsePresentation({ detail: { layout: 'split' } })
    expect(resolveDetail(split)).toMatchObject({ layout: 'split', bannerHidden: false, episodes: { placement: 'right' } })
    expect(episodesOnSide(split, true)).toBe(true)
    expect(episodesOnSide(split, false)).toBe(false)
    expect(episodesBelow(split, false)).toBe(true)
    expect(episodesBelow(parsePresentation({ detail: { episodes: { placement: 'below' } } }), true)).toBe(true)
    expect(resolveDetail(undefined).layout).toBe('stack')
    expect(episodesOnSide(undefined, true)).toBe(false)
  })
  it('parses icon facts, list episode rails and progress meters', () => {
    const layout = parsePresentation({
      detail: {
        facts: { type: 'row', children: [{ type: 'icon', icon: 'score' }, { type: 'text', field: 'score' }] },
        episodes: { placement: 'right', arrangement: 'list', hover: 'scale', card: { type: 'row', style: { wrap: 'nowrap' }, children: [{ type: 'artwork', artwork: 'still', style: { aspect: '1 / 1', width: 36, shrink: 0 } }, { type: 'meter', field: 'progress' }] } },
      },
    })
    expect(resolveDetail(layout).facts?.children?.[0]).toMatchObject({ type: 'icon', icon: 'score' })
    expect(resolveDetail(layout).episodes).toMatchObject({ placement: 'right', arrangement: 'list', hover: 'scale' })
    expect(resolveDetail(layout).episodes?.card?.children?.[1]?.type).toBe('meter')
    expect(nodeStyle(resolveDetail(layout).episodes!.card!)).toContain('flex-wrap:nowrap')
    expect(nodeStyle(parseNode({ type: 'text', field: 'description', style: { lines: 4 } }))).toContain('-webkit-line-clamp:4')
    expect(nodeStyle(parseNode({ type: 'text', field: 'title', style: { lines: 1 } }))).toContain('text-overflow:ellipsis')
    expect(parsePresentation({ shell: { overlay: 'fade', compact: false } }).shell).toMatchObject({ overlay: 'fade', compact: false })
    expect(parsePresentation({ detail: { episodes: { order: 'flip', search: false } } }).detail?.episodes).toMatchObject({ order: 'flip', search: false })
    expect(nodeStyle(parseNode({ type: 'row', style: { wrap: 'nowrap' } }))).toContain('overflow-x:auto')
    expect(nodeStyle(parseNode({ type: 'text', field: 'title', style: { lines: 2 } }))).not.toContain('flex-shrink:0')
    expect(nodeStyle(parseNode({ type: 'artwork', artwork: 'poster', style: { maxWidth: 180, aspect: '2 / 3' } }))).toContain('width:180px')
    expect(resolveDetail(parsePresentation({ detail: { actionsFirst: true, coverAlign: 'end', cta: 'large', bannerScale: 'banner' } }))).toMatchObject({ actionsFirst: true, coverAlign: 'end', cta: 'large', bannerScale: 'banner' })
    expect(parsePresentation({ hero: { scale: 'banner', height: 40 } }).hero).toMatchObject({ scale: 'banner', height: 40 })
  })
  it('treats an overlay series page as a full-bleed banner with episodes below', () => {
    const overlay = parsePresentation({ detail: { layout: 'overlay', bannerHidden: true, episodes: { placement: 'right' } } })
    expect(resolveDetail(overlay)).toMatchObject({ layout: 'overlay', bannerHidden: false, episodes: { placement: 'right' } })
    expect(episodesOnSide(overlay, true)).toBe(false)
    expect(episodesBelow(overlay, true)).toBe(true)
    expect(episodesBelow(parsePresentation({ detail: { layout: 'overlay' } }), true)).toBe(true)
    expect(resolveDetail(parsePresentation({ detail: { layout: 'overlay' } })).episodes?.placement).toBe('below')
  })
  it('resolves card families with row templates taking precedence', () => {
    const layout = parsePresentation({
      rows: { byId: { continue: { card: { type: 'text', field: 'title' } } } },
      cards: { poster: { type: 'artwork', artwork: 'poster' }, continue: { type: 'text', field: 'progress' }, search: { type: 'text', field: 'year' } },
    })
    expect(resolveCard(layout, 'poster')?.artwork).toBe('poster')
    expect(resolveCard(layout, 'search')?.field).toBe('year')
    expect(resolveCard(layout, 'continue')?.field).toBe('progress')
    expect(resolveCard(layout, 'continue', 'anime:continue')?.field).toBe('title')
    expect(resolveCard(layout, 'search')?.artwork).toBeUndefined()
    expect(resolveCard(parsePresentation({ cards: { poster: { type: 'text', field: 'title' } } }), 'search')?.field).toBe('title')
  })
  it('labels coverage from the slots a package actually uses', () => {
    expect(themeCoverage(undefined)).toEqual([])
    expect(themeCoverage(parsePresentation({ hero: { hidden: true } }))).toEqual(['Home'])
    expect(themeCoverage(parsePresentation({ density: 'large', shell: { compact: true } }))).toEqual(['Shell'])
    expect(themeCoverage(parsePresentation({ detail: { layout: 'split' } }))).toEqual(['Details'])
    expect(themeCoverage(parsePresentation({ player: { seekbarHeight: 6 } }))).toEqual(['Player'])
    expect(themeCoverage(parsePresentation({
      hero: { hidden: true }, density: 'compact', detail: { layout: 'split' }, player: { seekbarHeight: 4 },
    }))).toEqual(['Full'])
  })
  it('scales default density without inventing a new API version', () => {
    expect(densityScale(undefined)).toBe(1)
    expect(densityScale(parsePresentation({ density: 'compact' }))).toBe(0.86)
    expect(densityScale(parsePresentation({ density: 'large' }))).toBe(1.16)
  })
})

describe('streaming-site presentation keys (API 3)', () => {
  it('binds key art, the age rating, audio and the time left on API 3 only', () => {
    const template = { type: 'stack', children: [
      { type: 'artwork', artwork: 'keyart', when: { field: 'keyart' } },
      { type: 'text', field: 'ageRating', when: { field: 'ageRating' } },
      { type: 'text', field: 'audio' },
      { type: 'text', field: 'timeLeft', when: { field: 'timeLeft', absent: true } },
    ] }
    const hero = parsePresentation({ hero: { template } }, 3).hero?.template
    expect(hero?.children?.[0]).toMatchObject({ artwork: 'keyart', when: { field: 'keyart' } })
    expect(hero?.children?.map((child) => child.field)).toEqual([undefined, 'ageRating', 'audio', 'timeLeft'])
    expect(() => parsePresentation({ hero: { template: { type: 'artwork', artwork: 'keyart' } } }, 2)).toThrow('unsupported')
    for (const field of ['ageRating', 'audio', 'timeLeft']) {
      expect(() => parsePresentation({ hero: { template: { type: 'text', field } } }, 2)).toThrow('unsupported')
    }
    expect(displayText('timeLeft', { timeLeft: '21m left' })).toBe('21m left')
  })

  it('parses the wide hero, its bleed and unfilled past markers', () => {
    const layout = parsePresentation({ hero: { scale: 'wide', bleed: 300, indicator: { style: 'bars', past: 'empty' } } }, 3)
    expect(layout.hero).toMatchObject({ scale: 'wide', bleed: 300, indicator: { style: 'bars', past: 'empty' } })
    expect(parsePresentation({ hero: { bleed: 0 } }, 3).hero?.bleed).toBe(0)
    expect(() => parsePresentation({ hero: { bleed: 481 } }, 3)).toThrow('range')
    expect(() => parsePresentation({ hero: { scale: 'wide' } }, 2)).toThrow('unsupported')
    expect(() => parsePresentation({ hero: { bleed: 100 } }, 2)).toThrow('unsupported')
    expect(() => parsePresentation({ hero: { indicator: { past: 'empty' } } }, 2)).toThrow('unsupported')
    expect(() => parsePresentation({ hero: { indicator: { past: 'half' } } }, 3)).toThrow('unsupported')
  })

  it('parses the Categories menu, the card preview switch and series title art', () => {
    const layout = parsePresentation({
      shell: { nav: 'top', top: { labels: 'text', categories: true } },
      cardPreview: 'none',
      detail: { layout: 'overlay', art: 'keyart', title: 'logo' },
    }, 3)
    expect(layout.shell?.top?.categories).toBe(true)
    expect(layout.cardPreview).toBe('none')
    expect(resolveDetail(layout)).toMatchObject({ art: 'keyart', title: 'logo' })
    expect(() => parsePresentation({ cardPreview: 'none' }, 2)).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { art: 'keyart' } }, 2)).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { title: 'logo' } }, 2)).toThrow('unsupported')
    expect(() => parsePresentation({ shell: { top: { categories: 'yes' } } }, 3)).toThrow('toggle')
    expect(() => parsePresentation({ mobile: { cardPreview: 'none' } }, 3)).toThrow('unsupported')
    expect(themeCoverage(parsePresentation({ cardPreview: 'none' }, 3))).toContain('Home')
  })

  it('adds bookmark, plus, info and share icons on API 3, also on actions', () => {
    const node = parseNode({ type: 'action', action: 'details', icon: 'info' }, undefined, 0, true, 3)
    expect(node).toMatchObject({ action: 'details', icon: 'info' })
    for (const icon of ['bookmark', 'plus', 'share']) expect(parseNode({ type: 'icon', icon }, undefined, 0, true, 3).icon).toBe(icon)
    expect(() => parseNode({ type: 'icon', icon: 'bookmark' }, undefined, 0, true, 2)).toThrow('unsupported')
    expect(parseNode({ type: 'icon', icon: 'score' }, undefined, 0, true, 2).icon).toBe('score')
  })

  it('ignores an icon on an action from an API 1 or 2 package, which never drew it', () => {
    for (const api of [1, 2] as const) {
      const node = parseNode({ type: 'action', action: 'details', icon: 'score' }, undefined, 0, true, api)
      expect(node).toEqual({ type: 'action', action: 'details' })
    }
    // The value is still checked the way those packages always were.
    expect(() => parseNode({ type: 'action', action: 'details', icon: 'info' }, undefined, 0, true, 2)).toThrow('unsupported')
  })
})

describe('series page composition keys (API 3)', () => {
  it('parses the episode toolbar, paging, seasons and order keys', () => {
    const episodes = { order: 'none', toolbar: 'header', controls: ['search', 'layout'], search: 'field', paging: 'ranges', pageSize: 50, toolbarMin: 13, seasons: 'chips' }
    expect(parsePresentation({ detail: { episodes } }).detail?.episodes).toEqual(episodes)
    expect(parsePresentation({ detail: { episodes: { pageSize: 'auto', paging: 'dropdown', controls: [] } } }).detail?.episodes).toEqual({ pageSize: 'auto', paging: 'dropdown', controls: [] })
    expect(resolveDetail(parsePresentation({ detail: { episodes } })).episodes).toMatchObject({ placement: 'tab', ...episodes })
    expect(resolveDetail(undefined).episodes?.toolbar).toBeUndefined()
  })
  it('refuses the new episode keys and values on API 2 packages', () => {
    for (const episodes of [{ order: 'none' }, { search: 'field' }, { toolbar: 'bar' }, { controls: ['sort'] }, { paging: 'ranges' }, { pageSize: 48 }, { toolbarMin: 12 }, { seasons: 'chips' }]) {
      expect(() => parsePresentation({ detail: { episodes } }, 2), JSON.stringify(episodes)).toThrow()
    }
    expect(parsePresentation({ detail: { episodes: { order: 'flip', search: false } } }, 2).detail?.episodes).toEqual({ order: 'flip', search: false })
  })
  it('bounds page sizes, the toolbar threshold and the control list', () => {
    for (const pageSize of [11, 201, 12.5, '48', 'all']) expect(() => parsePresentation({ detail: { episodes: { pageSize } } }), String(pageSize)).toThrow()
    expect(parsePresentation({ detail: { episodes: { pageSize: 12 } } }).detail?.episodes?.pageSize).toBe(12)
    expect(parsePresentation({ detail: { episodes: { pageSize: 200 } } }).detail?.episodes?.pageSize).toBe(200)
    for (const toolbarMin of [-1, 101, 2.5]) expect(() => parsePresentation({ detail: { episodes: { toolbarMin } } }), String(toolbarMin)).toThrow()
    expect(parsePresentation({ detail: { episodes: { toolbarMin: 0 } } }).detail?.episodes?.toolbarMin).toBe(0)
    expect(() => parsePresentation({ detail: { episodes: { controls: ['sort', 'sort'] } } })).toThrow('twice')
    expect(() => parsePresentation({ detail: { episodes: { controls: ['filter'] } } })).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { episodes: { controls: 'sort' } } })).toThrow()
    expect(() => parsePresentation({ detail: { episodes: { seasons: 'tabs' } } })).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { episodes: { search: 'toggle' } } })).toThrow()
  })
  it('parses the section model, bottom navigation and continue card', () => {
    const sections = { mode: 'tabs', tabs: ['overview', 'episodes'], labels: { overview: 'info', episodes: 'watch' }, default: 'overview', info: 'overview' }
    const layout = parsePresentation({ detail: { sections, nav: 'hidden', continue: 'card' } })
    expect(layout.detail).toEqual({ sections, nav: 'hidden', continue: 'card' })
    expect(resolveDetail(layout)).toMatchObject({ sections, nav: 'hidden', continue: 'card' })
    expect(parsePresentation({ detail: { sections: { mode: 'stack' } } }).detail?.sections).toEqual({ mode: 'stack' })
    for (const detail of [{ sections: { mode: 'tabs' } }, { nav: 'hidden' }, { continue: 'card' }]) expect(() => parsePresentation({ detail }, 2)).toThrow('unsupported')
  })
  it('validates section ids, the fixed tab names and the default tab', () => {
    expect(() => parsePresentation({ detail: { sections: { tabs: ['episodes', 'episodes'] } } })).toThrow('twice')
    expect(() => parsePresentation({ detail: { sections: { tabs: ['comments'] } } })).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { sections: { tabs: [] } } })).toThrow('1–5')
    expect(() => parsePresentation({ detail: { sections: { labels: { overview: 'Home page' } } } })).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { sections: { labels: { episodes: 'cast' } } } })).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { sections: { labels: { comments: 'watch' } } } })).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { sections: { tabs: ['episodes', 'relations'], default: 'characters' } } })).toThrow('default')
    expect(parsePresentation({ detail: { sections: { tabs: ['episodes'], default: 'overview' } } }).detail?.sections?.default).toBe('overview')
    expect(() => parsePresentation({ detail: { nav: 'floating' } })).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { continue: 'banner' } })).toThrow('unsupported')
  })
  it('binds the episode template fields on API 3 only', () => {
    for (const field of ['episodeNo', 'episodeCode', 'watched', 'filler', 'rating']) {
      expect(parsePresentation({ detail: { episodes: { card: { type: 'text', field, when: { field } } } } }).detail?.episodes?.card?.field).toBe(field)
      expect(() => parsePresentation({ detail: { episodes: { card: { type: 'text', field } } } }, 2), field).toThrow('unsupported')
    }
    expect(displayText('episodeNo', { episodeNo: '12' })).toBe('12')
    expect(displayText('episodeNumber', { episodeNumber: 12 })).toBe('E12')
    expect(displayText('rating', { rating: '8.5' })).toBe('8.5')
  })
  it("binds episodeName, the episode's own title, on API 3 only", () => {
    const card = { type: 'text', field: 'episodeName', when: { field: 'episodeName' } }
    expect(parsePresentation({ detail: { episodes: { card } } }).detail?.episodes?.card).toEqual(card)
    expect(() => parsePresentation({ detail: { episodes: { card: { type: 'text', field: 'episodeName' } } } }, 2)).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { episodes: { card: { type: 'text', text: 'x', when: { field: 'episodeName' } } } } }, 2)).toThrow('unsupported')
    expect(displayText('episodeName', { episodeName: 'From Zero' })).toBe('From Zero')
    expect(displayText('episodeName', {})).toBe('')
  })
  it('merges a phone section model over the shared one', () => {
    const layout = parsePresentation({ detail: { sections: { labels: { overview: 'about' }, mode: 'stack' } }, mobile: { detail: { sections: { tabs: ['overview', 'episodes'] } } } })
    expect(resolveDetail(resolvePresentation(layout, true)).sections).toEqual({ labels: { overview: 'about' }, mode: 'stack', tabs: ['overview', 'episodes'] })
    expect(resolveDetail(resolvePresentation(layout, false)).sections).toEqual({ labels: { overview: 'about' }, mode: 'stack' })
  })
})
