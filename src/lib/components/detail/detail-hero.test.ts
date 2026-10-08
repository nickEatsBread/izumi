import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The mobile hero used to lay the poster and title ON TOP of the banner with a 10%-to-55% gradient,
// so legibility depended on how busy that particular banner was. The artwork is now a band that
// ends in a hard cut, with every piece of text below it on solid background.

const detail = readFileSync(fileURLToPath(new URL('./AnimeDetail.svelte', import.meta.url)), 'utf8')
const hero = readFileSync(fileURLToPath(new URL('../banner/Hero.svelte', import.meta.url)), 'utf8')

describe('mobile series hero', () => {
  it('takes the full canvas while mounted and gives it back on teardown', () => {
    expect(detail).toContain("import { acquireEdgeToEdge } from '$lib/actions/edge-to-edge'")
    expect(detail).toContain('return acquireEdgeToEdge()')
  })

  it('renders the artwork as a measured band, not a backdrop behind the text', () => {
    expect(detail).toContain('bind:clientHeight={artHeight}')
    // The old text-over-art rescue must be gone.
    expect(detail).not.toContain('drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)]')
  })

  it('drives the floating bar from the tested helper', () => {
    expect(detail).toContain("import { heroBarState } from './hero-bar'")
    expect(detail).toContain('heroBarState(window.scrollY, artHeight, barHeight, wasSolid, detailTheme.bar?.solidAt)')
    // A $derived that reads what an $effect writes back is an update loop, not a settled value.
    expect(detail).not.toContain('$derived(heroBarState')
  })

  it('keeps the floating bar clear of the status bar itself', () => {
    // A fixed bar does not inherit main's inset once it locks to the viewport.
    expect(detail).toContain('padding-top:max(0.5rem,env(safe-area-inset-top))')
  })

  it('always offers a back control that cannot trap a deep link', () => {
    expect(detail).toContain('function heroBack()')
    expect(detail).toContain('history.length > 1')
    expect(detail).toContain("goto('/app/home')")
  })

  it('keeps the hysteresis latch off the reactive graph', () => {
    // A latch an effect both reads and writes must not be $state, or Svelte resolves the cycle as
    // an update loop. Guard the shape, not just the call.
    expect(detail).toContain('let wasSolid = false')
    expect(detail).toContain('if (next.solid === wasSolid) return')
  })

  it('never crops the cover art, blurs a photograph or feeds a trailer thumbnail to the header', () => {
    expect(detail).toContain('object-contain')
    // banner() falls back to a YouTube still whose blurred pillarbox is baked into the JPEG; the
    // header art comes from backdrop.ts on every layout, loading or loaded.
    expect(detail).not.toMatch(/\bbanner\(/)
    expect(detail).not.toContain('import { banner,')
    // A title without art used to get its cover blurred into the header (blur-xl on phones,
    // blur-2xl on the desktop overlay), which read as broken art. The last resort is a wash of the
    // cover's colour; the cover stays, hidden, for a theme that wants it shown.
    expect(detail).not.toMatch(/blur-(xl|2xl)/)
    expect(detail).not.toContain('scale-110')
    expect(detail).toContain("const headerWash = $derived(headerArt.kind === 'wash' ? washBackground(headerArt.rgb) : undefined)")
    expect(detail.match(/style:background-image=\{headerWash\}/g)?.length).toBe(3)
    expect(detail).toContain('<img data-part="detail.backdrop" data-art="cover" src={cover(m)} alt="" aria-hidden="true"')
    expect(detail).toContain('h-full w-full object-cover opacity-0')
  })

  it('chooses the header art once, for every layout, while loading and once loaded', () => {
    expect(detail).toContain("import { baseImageSrc, detailArt, recordBanner, washBackground } from '$lib/detail/backdrop'")
    expect(detail).toContain('const headerArt = $derived(detailArt({')
    expect(detail).toContain('banner: recordBanner(shown, { loading: pending, anilistBanner, backup: backupRecord }),')
    expect(detail).toContain('keyartPending: !detailExtrasSettled,')
    expect(detail).toContain('themeArt: detailTheme.art,')
    // Phone overlay, phone band and desktop overlay paint it themselves; the desktop banner is Hero's.
    expect(detail.match(/data-art=\{headerArt\.kind\}/g)?.length).toBe(5)
    expect(detail).toContain('<Hero medias={[m]} showOverlay={false} artwork={headerArt} onartworkfailed={backdropFailed} />')
  })

  it('retries header art before giving it up for the next candidate', () => {
    // One network hiccup used to cost a title its art for the whole visit (and left the phone band
    // empty: its image had no error handler at all). Posters already retried; header art does too.
    expect(detail).toContain("import { headerImage } from '$lib/detail/header-image'")
    expect(detail.match(/use:headerImage=\{\{ src: headerSrc, onfailed: backdropFailed \}\}/g)?.length).toBe(3)
    expect(detail).not.toMatch(/<img data-part="detail\.backdrop"[^>]*src=\{headerSrc\}/)
    const action = readFileSync(fileURLToPath(new URL('../../detail/header-image.ts', import.meta.url)), 'utf8')
    expect(action).toContain('const retrying = reliableImage(node, params.src)')
    expect(action).toContain("node.addEventListener('imagefailed', failed)")
  })

  it('fades the artwork in rather than popping it', () => {
    expect(detail).toContain("let loadedArt = $state('')")
    expect(detail).toContain('transition-opacity duration-500')
  })

  it('keeps a loaded banner shown when the detail query delivers the same series again', () => {
    // The detail query delivers the series again whenever the cache refreshes records it shares (the
    // first revalidation of a cached page, the season picker's chain walk), and `media` is a new
    // object each time. A fade flag an effect reset on that object hid a banner whose image had
    // already loaded: an unchanged image never fires `load` again. The fade follows the image itself.
    expect(detail).not.toContain('artLoaded')
    expect(detail.match(/onload=\{markArtLoaded\}/g)?.length).toBe(3)
    expect(detail.match(/artReady\(headerSrc\) \? 'opacity-100' : 'opacity-0'/g)?.length).toBe(3)
    // A retried image carries a retry marker in its URL; the art it stands for is the URL without it.
    expect(detail).toContain("loadedArt = baseImageSrc(event.currentTarget.getAttribute('src'))")
  })

  it("loads in the theme's own page, not a hand-made skeleton", () => {
    // The loading layout used to be a default-izumi skeleton without a single hook, so every themed
    // page jumped into a different layout when its record landed. The real branches render from the
    // tapped card's record (or a placeholder) instead, with `data-pending` on each page root.
    expect(detail).toContain('const pending = $derived(!$offlineMode && !media && $store.fetching)')
    expect(detail).toContain('{:else if shown}\n  {@const m = shown}')
    expect(detail).not.toContain('$store.fetching && !media}')
    expect(detail.match(/data-slot="detail" [^>]*data-pending=\{pending \|\| undefined\}/g)?.length).toBe(4)
    expect(detail.match(/data-slot="detail"/g)?.length).toBe(4)
    // Placeholders live inside the page's parts: no skeleton markup precedes the page.
    const template = detail.slice(detail.indexOf('</script>'))
    expect(template.indexOf('skeloader')).toBeGreaterThan(template.indexOf('{:else if shown}'))
    expect(detail).toContain('{#snippet placeholderLines(count: number)}')
    // The band and the desktop hero keep their sizes; the desktop overlap follows the theme.
    expect(detail).toContain('h-[26vh] max-h-72 min-h-44')
    expect(hero).toContain('h-[40vh]')
    expect(hero).toContain("controllerUi ? 'sm:h-[42vh]' : 'sm:h-[48vh]'")
    expect(detail).toContain('const bannerOverlap = $derived(detailTheme.bannerHeight ? Math.round(detailTheme.bannerHeight * 0.58) : (controllerUi ? 16 : 18))')
    expect(detail).toContain('`-${bannerOverlap}vh`')
  })

  it('keeps the artwork the loading page painted', () => {
    // One <img> (and one desktop Hero, keyed by id) serves the loading and the loaded page, so the
    // banner neither dips to transparent and fades in again nor replays its slide.
    expect(detail).not.toContain('loadedHintBanner')
    expect(detail).not.toContain('initialArtworkVisible')
    expect(hero).not.toContain('initialArtworkVisible')
    expect(detail).not.toContain('object-cover opacity-35')
  })

  it('carries known titles into loading and holds a line only for an unknown one', () => {
    expect(detail).not.toContain('Loading title…')
    expect(detail).not.toContain('h-4 w-40 rounded skeloader')
    expect(detail).toContain('const named = (m: Media) => !!(m.title.romaji || m.title.english || m.title.userPreferred)')
    // Only while loading: a loaded record without a name (an offline title rebuilt from its
    // downloads) is not still loading, so it never keeps a placeholder for good.
    expect(detail).toContain('const unnamed = (m: Media) => pending && !named(m)')
    // An inline block holding a space takes the heading's own line height, so the title row keeps its size.
    // It keeps a width of its own in a heading sized to its content (a centred overlay column).
    expect(detail).toContain('{:else if unnamed(m)}\n    <h1 data-part="detail.title" class={className}><span class="inline-block w-3/5 min-w-32 max-w-full rounded-md align-top skeloader" aria-hidden="true">&nbsp;</span><span class="sr-only">Loading</span></h1>')
    // No made-up facts for a title known only by id.
    expect(detail.match(/\{#if unnamed\(m\)\}<span class="my-0\.5 h-3 w-\d+ rounded skeloader"/g)?.length).toBe(2)
    expect(detail).not.toMatch(/\{(#if|:else if) !named\(m\)\}/)
    // The poster's placeholder too: a loaded title without a cover does not shimmer for good.
    expect(detail).toContain('const posterWaiting = (m: Media) => (cover(m) ? loadedPoster !== cover(m) : pending)')
    // A placeholder knows no title: the bar never prints "TBA".
    expect(detail.match(/\{#if barState\.showTitle && named\(m\)\}/g)?.length).toBe(2)
  })

  it('shows the card only to a profile allowed to see it', () => {
    expect(detail).toContain('const hintFits = (hint: Media | undefined): hint is Media => !!hint && profileAllowsMedia(hint, $activeProfile)')
    expect(detail).toContain('&& (hint.isAdult != null || profileAllowsAdult($activeProfile))')
    expect(detail).toContain('{:else if media && !profileAllowsMedia(media, $activeProfile)}')
  })

  it('runs no action on the card record the loading page shows', () => {
    const template = detail.slice(detail.indexOf('</script>'))
    const handlers = [...template.matchAll(/onclick=\{([^\n]*)/g)].map((match) => match[1])
    // Navigation and menu toggles act on the page, not the title.
    const pageOnly = ['heroBack}', 'pressPlay}', 'retryDetail}', '() => (showMore = false)}', '() => { h.tap(); showMore = !showMore }}', "() => tapSynopsis('info')}", '() => pressSynopsisMore(place)}']
    for (const handler of handlers) expect(handler.startsWith('ready(') || pageOnly.some((ok) => handler.startsWith(ok)), handler).toBe(true)
    expect(handlers.filter((handler) => handler.startsWith('ready(')).length).toBeGreaterThanOrEqual(13)
    expect(detail).toContain('const ready = <T extends unknown[]>(run: (m: Media, ...args: T) => void) => (...args: T) => { if (media) run(media, ...args) }')
    // Play pressed while loading waits for the record; hovering or focusing it warms once it lands.
    expect(detail).toContain('if (media) { playCta(media); return }')
    expect(detail).toContain('untrack(() => playCta(target, false))')
    expect(detail.match(/onclick=\{pressPlay\}/g)?.length).toBe(3)
    // Editors and the data components only ever get the full record.
    expect(detail).toContain('{#if showEditor && media}')
    expect(detail).toContain('{#if showLocalLists && media}')
    expect(detail.match(/\{#if showRatingRow && media\}/g)?.length).toBe(5)
    expect(detail.match(/<EpisodeList /g)?.length).toBe(1)
    expect(detail).toContain('{#if pending}\n    <div data-slot="detail.episodes" class="relative" aria-hidden="true">')
    expect(detail).toContain("{:else if pending}\n    {@render sectionPlaceholder(phone)}\n  {:else if id === 'relations'}")
    // The countdown only formats `nextAiringEpisode`, which the card's record carries as well.
    expect(detail.match(/\{#if countdown !== 'none'\}<AiringCountdown media=\{m\}/g)?.length).toBe(3)
    // The poster keeps its placeholder shape until its image has loaded; a blank image stands in.
    expect(detail.match(/use:reliableImage=\{posterSrc\(m\)\} alt="" onload=\{markPosterLoaded\}/g)?.length).toBe(3)
    expect(detail.match(/posterWaiting\(m\) \? 'aspect-\[46\/65\] skeloader' : ''/g)?.length).toBe(3)
  })

  it('starts the artwork lookups with the page and merges what the full record adds', () => {
    // Keyed on the title plus what the lookups read, so the card's record starts them and the full
    // record re-runs them only when it brings more (a provider logo, a MyAnimeList id).
    expect(detail).toContain("const extrasInputs = $derived(shown ? titleExtrasKey(shown) : '')")
    expect(detail).toContain('const target = untrack(() => shown)')
    expect(detail).toContain('if (target.id !== extrasTitle) {')
    expect(detail).toContain('const found = peekTitleArt(anilistIdOf(target))')
    expect(detail).toContain('detailExtras = { ...detailExtras, ...value }')
    // The wait for key art and the logo runs from the page's arrival, at most 1.2 s. It starts
    // unsettled, so the first render never picks the wash for a title whose key art is on its way.
    expect(detail).toContain('artDeadline = setTimeout(() => (detailExtrasSettled = true), 1200)')
    expect(detail).toContain('let detailExtrasSettled = $state(false)')
  })

  it('keeps a way back on a page that failed to load or found nothing', () => {
    expect(detail).toContain('{#snippet failureBar()}')
    expect(detail.match(/\{#if \$isMobile\}\{@render failureBar\(\)\}\{\/if\}/g)?.length).toBe(2)
    expect(detail).toContain('onclick={retryDetail}')
    expect(detail).toContain("query.reexecute?.({ requestPolicy: 'network-only' })")
  })

  it('does not let the portrait cover create a dead zone before episodes', () => {
    // The desktop cover used to grow to 13rem at md, leaving the tabs beneath its height even when
    // the adjacent title/description/actions ended much earlier. Loading and loaded layouts must
    // share the balanced 11rem identity-cover geometry.
    expect(detail).not.toContain('md:w-52')
    // One desktop cover, which the loading page renders too.
    expect(detail.match(/h-auto w-44 shrink-0/g)?.length).toBe(1)
    expect(detail).toContain("detailTheme.coverAlign === 'end' ? 'self-end' : 'self-start'")
    expect(detail).toContain('mb-4 flex flex-col gap-5 md:flex-row')
  })

  it('keeps desktop tracker actions compact and even', () => {
    expect(detail).toContain('<TrackerProviderBadge provider={tracker.id} compact />')
    expect(detail).toContain('class="grid h-10 w-10 place-items-center rounded-md bg-secondary transition-colors hover:bg-accent"')
    expect(detail).not.toContain('{tracker.label}<ExternalLink')
  })

  it('keeps the poster above the artwork band', () => {
    // The band is positioned, so it paints over static in-flow content - and the poster row is
    // pulled up into it. Without its own stacking context the band covered the poster's top the
    // moment its image loaded, which read as the cover being cropped.
    expect(detail).toContain("relative z-10 {detailTheme.bannerHidden ? 'mt-2' : '-mt-10'} flex gap-4")
  })

  it('keeps a quiet borderless schedule summary beneath mobile facts', () => {
    expect(detail).toContain('mt-3 flex flex-wrap items-center gap-2 empty:mt-0')
    expect(detail).toContain('<AiringStatus media={m} />')
    const airing = readFileSync(fileURLToPath(new URL('./AiringStatus.svelte', import.meta.url)), 'utf8')
    expect(airing).toContain('gap-x-2 whitespace-nowrap text-xs text-muted-foreground')
    expect(airing).toContain("toolbar ? 'h-9' : ''")
    expect(airing).not.toContain('compact = false')
    expect(airing).not.toContain('quiet = false')
  })

  it('surfaces a complete, discoverable mobile anime overview without crowding the hero', () => {
    expect(readFileSync(fileURLToPath(new URL('../../detail/sections.ts', import.meta.url)), 'utf8'))
      .toContain("const PHONE_ORDER: readonly DetailSection[] = ['episodes', 'overview', 'relations', 'characters', 'recommended']")
    expect(detail).toContain('aria-label="Genres"')
    expect(detail).toContain('From {prettyEnum(m.source)}')
    expect(detail).toContain('{m.duration} min')
    expect(detail).toContain("{:else if id === 'overview'}")
    for (const heading of ['Synopsis', 'Information', 'Themes', 'Alternative titles']) {
      expect(detail).toContain(`>${heading}<`)
    }
    // The Information grid's facts and wording come from facts.ts: every studio, the runtime, the
    // source, the country and the popularity among them.
    expect(detail).toContain("mediaFacts(m, { place: 'info', keys: detailTheme.infoKeys")
    const facts = readFileSync(fileURLToPath(new URL('../../detail/facts.ts', import.meta.url)), 'utf8')
    expect(facts).toContain("export const INFO_KEYS: readonly FactKey[] = ['studio', 'format', 'status', 'episodes', 'duration', 'season', 'aired', 'source', 'country', 'score', 'members']")
    expect(facts).toContain("const INFO_LABELS: Partial<Record<FactKey, FactLabel>> = { format: 'format', duration: 'runtime', aired: 'premiered', members: 'popularity' }")
  })
})

describe('series airing schedule', () => {
  it('renders SUB and DUB as distinct colored words in one quiet schedule line', () => {
    const airing = readFileSync(fileURLToPath(new URL('./AiringStatus.svelte', import.meta.url)), 'utf8')
    expect(airing).toContain("kind === 'Dub'")
    expect(airing).toContain('text-violet-300')
    expect(airing).toContain('text-sky-300')
    expect(airing).toContain('{#if index}<span class="opacity-40"')
    expect(airing).toContain('tabular-nums')
    expect(airing).not.toContain('ring-violet')
    expect(airing).not.toContain('border-l border-border')
  })
})
