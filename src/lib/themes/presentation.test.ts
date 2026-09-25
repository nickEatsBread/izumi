import { describe, it, expect } from 'vitest'
import { parseNode, parsePresentation, nodeStyle, resolveRow, resolveCard, resolveDetail, episodesOnSide, episodesBelow, themeCoverage, densityScale, visibleNode, displayText, type DisplayModel } from './presentation'

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
  it('parses the API 3 wordmark mode and counts it as shell coverage', () => {
    expect(parsePresentation({ brand: 'text' }).brand).toBe('text')
    expect(() => parsePresentation({ brand: 'text' }, 2)).toThrow('unsupported')
    expect(() => parsePresentation({ brand: 'logo' })).toThrow('unsupported')
    expect(themeCoverage(parsePresentation({ brand: 'text' }))).toEqual(['Shell'])
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
