<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { get } from 'svelte/store'
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import Expand from '@lucide/svelte/icons/maximize-2'
  import X from '@lucide/svelte/icons/x'
  import ThemeDevices from './ThemeDevices.svelte'
  import { navLayer } from '$lib/nav/overlay'
  import { reducedMotion } from '$lib/motion/gm-motion'
  import { isMobile } from '$lib/platform'
  import { SCREEN_LABELS, homeShot, platformFor, shotsFor, type PreparedTheme, type ThemePlatform, type ThemeRelease, type ThemeScreen } from '$lib/themes/packages'

  let { release, prepared, storeName, busy, canInstall, installLabel, installed, locked, conflict, startScreen, startPlatform, onback, oninstall, onpreview }: {
    release: ThemeRelease | null
    prepared: PreparedTheme | null
    storeName: string
    busy: boolean
    canInstall: boolean
    installLabel: string
    installed: boolean
    /** A Theme Studio draft is open: nothing may be previewed or applied. */
    locked: boolean
    /** The same theme ID is installed from another source. */
    conflict: boolean
    startScreen: ThemeScreen | null
    startPlatform: ThemePlatform | null
    onback: () => void
    oninstall: () => void
    onpreview: (screen: ThemeScreen) => void
  } = $props()

  const name = $derived(prepared?.package.name ?? release?.name ?? '')
  const description = $derived(prepared?.package.description ?? release?.description ?? '')
  const version = $derived(prepared?.package.version ?? release?.version ?? '')
  // Only offer a platform switch when the listing really has screenshots for more than one.
  const platforms = $derived((['desktop', 'phone'] as const).filter((option) => release?.screenshots?.some((shot) => shot.platform === option)))
  // Seeded once from the URL (a preview returning to this page; the page re-keys this component per theme).
  let platform = $state<ThemePlatform>(untrack(() => startPlatform ?? (release ? platformFor(release, get(isMobile) ? 'phone' : 'desktop') : 'desktop')))
  const shots = $derived(release ? shotsFor(release, platform) : [])
  const madeFor = $derived((release?.platforms?.length ? release.platforms : ['desktop', 'phone']).map((item) => item === 'phone' ? 'Phone' : 'Desktop').join(' + '))
  const size = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`

  // The gallery shows screenshots as framed pictures, a few at a time; `at` is the first one in view.
  let gallery = $state<HTMLElement>()
  let at = $state(0)
  function scrollToShot(i: number, smooth = true) {
    if (!gallery) return
    at = Math.max(0, Math.min(shots.length - 1, i))
    const shot = gallery.children[at] as HTMLElement | undefined
    if (shot) gallery.scrollTo({ left: shot.offsetLeft, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' })
  }
  function sync() {
    if (!gallery) return
    let best = 0, distance = Infinity
    for (const [i, shot] of [...gallery.children].entries()) {
      const d = Math.abs((shot as HTMLElement).offsetLeft - gallery.scrollLeft)
      if (d < distance) { distance = d; best = i }
    }
    at = best
  }
  function pick(option: ThemePlatform) { platform = option; at = 0; gallery?.scrollTo({ left: 0 }) }
  // A preview returning here lands on the screenshot it left from.
  onMount(() => {
    const i = startScreen ? shots.findIndex((shot) => shot.screen === startScreen) : -1
    if (i > 0) scrollToShot(i, false)
  })
  function preview() { onpreview(shots[at]?.screen ?? 'home') }

  // Full-size viewer: a screenshot opened from the gallery.
  let viewing = $state<number | null>(null)
  const open = $derived(viewing !== null && shots[viewing] ? shots[viewing] : null)
  function step(by: number) { if (viewing !== null) viewing = Math.max(0, Math.min(shots.length - 1, viewing + by)) }
  function keys(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft') { step(-1); event.preventDefault() }
    if (event.key === 'ArrowRight') { step(1); event.preventDefault() }
  }
</script>

<section class="theme-detail" aria-busy={busy} data-nav-back-scope>
  <button type="button" class="back" data-focusable data-nav-back disabled={busy} onclick={onback}><ArrowLeft size={16} /> Themes</button>
  <!-- The same composed art as the store's spotlight: the theme in device frames on its own colour. -->
  <header class="hero" class:tinted={!!release?.accent} style:--spot={release?.accent}>
    <div class="copy">
      <div class="title-row"><h3>{name}</h3>{#if installed}<span class="badge">Installed</span>{/if}</div>
      <p class="tagline">{description}</p>
      {#if prepared}
        <div class="actions">
          <button type="button" class="control primary" data-focusable disabled={locked || !canInstall} onclick={oninstall}>{installLabel}</button>
          <button type="button" class="control" data-focusable disabled={locked || !canInstall} onclick={preview}>Preview</button>
        </div>
      {:else if busy}<p role="status" class="checking">Checking theme package…</p>{/if}
      <dl class="facts">
        <div><dt>Version</dt><dd>{version}</dd></div>
        {#if release}<div><dt>Size</dt><dd>{size(release.bytes)}</dd></div>{/if}
        <div><dt>Made for</dt><dd>{madeFor}</dd></div>
        {#if storeName}<div><dt>Store</dt><dd>{storeName}</dd></div>{/if}
      </dl>
    </div>
    {#if release && (homeShot(release, 'desktop') || homeShot(release, 'phone'))}
      <div class="stage"><ThemeDevices desktop={homeShot(release, 'desktop')} phone={homeShot(release, 'phone')} label={`View ${name} full size`} onclick={() => { viewing = 0 }} /></div>
    {/if}
  </header>
  {#if conflict}<p class="hint conflict">A theme with this ID is already installed from a different source. Remove it there before installing this one.</p>{/if}

  {#if shots.length}
    <section class="screens" aria-labelledby="theme-screens-title">
      <div class="section-head">
        <h4 id="theme-screens-title">Screenshots</h4>
        <div class="tools">
          {#if platforms.length > 1}
            <div class="switch" role="group" aria-label="Screenshots for">{#each platforms as option (option)}<button type="button" data-focusable aria-pressed={platform === option} onclick={() => pick(option)}>{option === 'phone' ? 'Phone' : 'Desktop'}</button>{/each}</div>
          {/if}
          {#if shots.length > 1}
            <button type="button" class="round" data-focusable aria-label="Previous screenshots" disabled={at === 0} onclick={() => scrollToShot(at - 1)}><ChevronLeft size={18} /></button>
            <button type="button" class="round" data-focusable aria-label="Next screenshots" disabled={at >= shots.length - 1} onclick={() => scrollToShot(at + 1)}><ChevronRight size={18} /></button>
          {/if}
        </div>
      </div>
      <!-- Framed pictures a few at a time, never one screen-filling image; click one to see it full size. -->
      <div class="gallery" class:phone={platform === 'phone'} bind:this={gallery} onscroll={sync} data-nav-row data-nav-row-items data-nav-scroll-x>
        {#each shots as shot, i (shot.url)}
          <button type="button" class="shot" data-focusable aria-label={`View ${SCREEN_LABELS[shot.screen]} full size`} onclick={() => viewing = i}>
            <span class="caption">{SCREEN_LABELS[shot.screen]}</span>
            <span class="frame"><img src={shot.url} alt="" loading="lazy" referrerpolicy="no-referrer" /><span class="expand" aria-hidden="true"><Expand size={16} /></span></span>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  <section class="about" aria-labelledby="theme-about-title">
    <h4 id="theme-about-title">About</h4>
    <p>{description}</p>
    {#if prepared && !conflict}<p class="hint">You can edit this theme in Theme Studio after installing it.</p>{/if}
  </section>
</section>

{#if open && viewing !== null}
  <div class="viewer-layer" role="dialog" aria-modal="true" aria-label={`${name}: ${SCREEN_LABELS[open.screen]}`} tabindex="-1" onkeydown={keys} data-nav-trap data-nav-escape use:navLayer={{ kind: 'theme-screenshot', onClose: () => { viewing = null } }}>
    <button type="button" class="viewer-scrim" tabindex="-1" aria-label="Close screenshot" onclick={() => viewing = null}></button>
    <figure class:phone={platform === 'phone'}>
      <img src={open.url} alt={`${name}: ${SCREEN_LABELS[open.screen]}`} referrerpolicy="no-referrer" />
      <figcaption><strong>{SCREEN_LABELS[open.screen]}</strong><span>{viewing + 1} of {shots.length}</span></figcaption>
    </figure>
    <div class="viewer-controls">
      <button type="button" data-focusable aria-label="Previous screenshot" disabled={viewing === 0} onclick={() => step(-1)}><ChevronLeft size={20} /></button>
      <button type="button" data-focusable aria-label="Next screenshot" disabled={viewing === shots.length - 1} onclick={() => step(1)}><ChevronRight size={20} /></button>
      <button type="button" data-focusable aria-label="Close" onclick={() => viewing = null}><X size={20} /></button>
    </div>
  </div>
{/if}

<style>
  .back { display: flex; align-items: center; gap: 8px; min-height: 40px; margin: 0 0 14px; font-size: 13px; font-weight: 800; color: hsl(var(--muted-foreground)); }
  .back:hover { color: hsl(var(--foreground)); }
  .hero { position: relative; display: grid; grid-template-columns: minmax(0, 44fr) minmax(0, 56fr); min-height: 300px; margin-bottom: 34px; overflow: hidden; border-radius: 22px; background: hsl(var(--foreground) / .05); }
  /* The theme's accent (a validated HSL token) glowing from behind the devices. */
  .hero.tinted { background: radial-gradient(120% 140% at 85% 30%, hsl(var(--spot) / .5), hsl(var(--spot) / .12) 45%, hsl(var(--foreground) / .04) 75%); }
  .copy { display: flex; flex-direction: column; justify-content: center; gap: 14px; min-width: 0; padding: 36px 24px 32px 36px; }
  .title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; }
  h3 { font-size: clamp(30px, 3.8vw, 46px); font-weight: 900; letter-spacing: -.035em; line-height: 1.02; }
  .badge { padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; background: hsl(var(--foreground) / .14); }
  .tagline { font-size: 14px; line-height: 1.6; color: hsl(var(--foreground) / .78); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .control { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 22px; border-radius: 999px; font-size: 13px; font-weight: 800; background: hsl(var(--foreground) / .12); }
  .control.primary { background: hsl(var(--foreground)); color: hsl(var(--background)); }
  .control:hover:not(:disabled) { filter: brightness(1.12); }
  .control:disabled { opacity: .45; cursor: not-allowed; }
  .checking, .hint { color: hsl(var(--muted-foreground)); font-size: 12px; line-height: 1.6; }
  .hint { margin-top: 12px; }
  .hint.conflict { margin: -20px 0 24px; }
  /* Facts sit quietly under the actions: small labels over their values, no table rules. */
  .facts { display: flex; flex-wrap: wrap; gap: 10px 26px; margin-top: 6px; }
  dt { font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: hsl(var(--foreground) / .55); }
  dd { margin-top: 2px; font-size: 13px; font-weight: 800; }
  .stage { position: relative; min-width: 0; }
  .section-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
  h4 { font-size: 20px; font-weight: 900; letter-spacing: -.02em; }
  .tools { display: flex; align-items: center; gap: 6px; }
  .switch { display: flex; gap: 2px; padding: 3px; margin-right: 6px; border-radius: 999px; background: hsl(var(--foreground) / .07); }
  .switch button { height: 30px; padding: 0 14px; border-radius: 999px; font-size: 12px; font-weight: 800; color: hsl(var(--muted-foreground)); }
  .switch button[aria-pressed='true'] { background: hsl(var(--foreground)); color: hsl(var(--background)); }
  .round { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 999px; background: hsl(var(--foreground) / .07); }
  .round:hover:not(:disabled) { background: hsl(var(--foreground) / .14); }
  .round:disabled { opacity: .35; }
  .gallery { position: relative; display: flex; gap: 16px; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
  .gallery::-webkit-scrollbar { display: none; }
  /* Desktop screenshots two at a time; phone screenshots at a fixed, readable width. */
  .gallery { padding: 8px 2px 18px; margin: -8px -2px 0; }
  .shot { flex: 0 0 calc((100% - 16px) / 2); scroll-snap-align: start; display: flex; flex-direction: column; gap: 8px; text-align: start; cursor: zoom-in; }
  .gallery.phone .shot { flex: 0 0 220px; }
  .caption { font-size: 13px; font-weight: 800; color: hsl(var(--muted-foreground)); transition: color 200ms; }
  /* Hover lifts the picture, deepens its shadow and zooms it slightly inside its frame. */
  .frame { position: relative; display: block; overflow: hidden; border-radius: 12px; background: hsl(var(--muted)); box-shadow: 0 0 0 1px hsl(var(--foreground) / .08), 0 6px 18px hsl(0 0% 0% / .25); transition: translate 350ms cubic-bezier(.2, .8, .2, 1), box-shadow 350ms ease; }
  .frame img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; object-position: top; transition: scale 500ms cubic-bezier(.2, .8, .2, 1); }
  .gallery.phone .frame img { aspect-ratio: 390 / 844; }
  .expand { position: absolute; top: 10px; right: 10px; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 999px; background: hsl(0 0% 0% / .6); color: #fff; opacity: 0; transition: opacity 250ms ease; }
  .shot:hover .frame { translate: 0 -4px; box-shadow: 0 0 0 1px hsl(var(--foreground) / .1), 0 18px 40px hsl(0 0% 0% / .5); }
  .shot:hover .frame img { scale: 1.035; }
  .shot:hover .expand { opacity: 1; }
  .shot:hover .caption { color: hsl(var(--foreground)); }
  @media (prefers-reduced-motion: reduce) { .frame, .frame img, .expand, .caption { transition: none; } }
  .about { margin-top: 34px; max-width: 760px; }
  .about p:not(.hint) { margin-top: 10px; font-size: 14px; line-height: 1.7; color: hsl(var(--foreground) / .82); }
  /* The full-size viewer: the screenshot as large as the window allows, on a dark scrim. */
  .viewer-layer { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 28px; }
  .viewer-scrim { position: absolute; inset: 0; border: 0; background: hsl(0 0% 0% / .86); }
  figure { position: relative; display: flex; flex-direction: column; gap: 10px; max-width: min(1400px, 100%); }
  figure img { display: block; max-width: 100%; max-height: calc(100vh - 150px); object-fit: contain; border-radius: 12px; box-shadow: 0 20px 60px hsl(0 0% 0% / .5); }
  figure.phone img { max-height: calc(100vh - 150px); }
  figcaption { display: flex; justify-content: space-between; gap: 12px; color: #fff; font-size: 13px; }
  figcaption span { color: hsl(0 0% 100% / .6); }
  .viewer-controls { position: relative; display: flex; gap: 8px; }
  .viewer-controls button { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 999px; background: hsl(0 0% 100% / .14); color: #fff; }
  .viewer-controls button:hover:not(:disabled) { background: hsl(0 0% 100% / .24); }
  .viewer-controls button:disabled { opacity: .35; }
  /* Narrow pages: the devices on top, the details underneath. */
  @container (max-width: 640px) {
    .hero { grid-template-columns: 1fr; min-height: 0; }
    .stage { order: -1; height: 220px; }
    .copy { padding: 22px 20px 24px; }
  }
  @container (max-width: 560px) {
    .shot { flex-basis: 86%; }
    .gallery.phone .shot { flex-basis: 46%; }
  }
</style>
