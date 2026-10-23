<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { get } from 'svelte/store'
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import X from '@lucide/svelte/icons/x'
  import { navLayer } from '$lib/nav/overlay'
  import { reducedMotion } from '$lib/motion/gm-motion'
  import { isMobile } from '$lib/platform'
  import { SCREEN_LABELS, platformFor, shotsFor, type PreparedTheme, type ThemePlatform, type ThemeRelease, type ThemeScreen } from '$lib/themes/packages'

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
    onpreview: (screen: ThemeScreen, from: HTMLImageElement | null) => void
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
  function preview() { onpreview(shots[at]?.screen ?? 'home', gallery?.children[at]?.querySelector('img') ?? null) }

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
  <header>
    <div class="heading"><h3>{name}</h3><p>{description}</p></div>
    {#if prepared}
      <div class="actions">
        <button type="button" class="control" data-focusable disabled={locked || !canInstall} onclick={preview}>Preview</button>
        <button type="button" class="control primary" data-focusable disabled={locked || !canInstall} onclick={oninstall}>{installLabel}</button>
      </div>
    {:else if busy}<p role="status" class="checking">Checking theme package…</p>{/if}
  </header>
  {#if conflict}<p class="hint">A theme with this ID is already installed from a different source. Remove it there before installing this one.</p>{/if}
  <dl class="facts">
    <div><dt>Made for</dt><dd>{madeFor}</dd></div>
    <div><dt>Version</dt><dd>{version}</dd></div>
    {#if release}<div><dt>Size</dt><dd>{size(release.bytes)}</dd></div>{/if}
    {#if storeName}<div><dt>Store</dt><dd>{storeName}</dd></div>{/if}
    <div><dt>Installed</dt><dd>{installed ? 'Yes' : 'No'}</dd></div>
  </dl>

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
      <div class="gallery" class:phone={platform === 'phone'} bind:this={gallery} onscroll={sync} data-theme-viewer data-nav-row data-nav-row-items data-nav-scroll-x>
        {#each shots as shot, i (shot.url)}
          <button type="button" class="shot" data-focusable data-theme-shot={shot.screen} aria-label={`View ${SCREEN_LABELS[shot.screen]} full size`} onclick={() => viewing = i}>
            <span>{SCREEN_LABELS[shot.screen]}</span>
            <img src={shot.url} alt="" loading="lazy" referrerpolicy="no-referrer" />
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
  header { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px 24px; }
  .heading { flex: 1 1 320px; min-width: 0; }
  h3 { font-size: clamp(28px, 3.4vw, 38px); font-weight: 900; letter-spacing: -.035em; line-height: 1.05; }
  .heading p { margin-top: 8px; font-size: 14px; color: hsl(var(--muted-foreground)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .actions { display: flex; gap: 8px; }
  .control { display: inline-flex; align-items: center; justify-content: center; min-height: 40px; padding: 0 20px; border-radius: 999px; font-size: 13px; font-weight: 800; background: hsl(var(--foreground) / .08); }
  .control.primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
  .control:disabled { opacity: .45; cursor: not-allowed; }
  .checking, .hint { color: hsl(var(--muted-foreground)); font-size: 12px; line-height: 1.6; }
  .hint { margin-top: 12px; }
  /* One quiet row of facts, the App Store way. */
  .facts { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); margin: 22px 0 30px; padding: 14px 0; border-block: 1px solid hsl(var(--border)); text-align: center; }
  .facts div + div { border-inline-start: 1px solid hsl(var(--border)); }
  dt { font-size: 11px; font-weight: 700; color: hsl(var(--muted-foreground)); }
  dd { margin-top: 3px; font-size: 14px; font-weight: 800; }
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
  .shot { flex: 0 0 calc((100% - 16px) / 2); scroll-snap-align: start; display: flex; flex-direction: column; gap: 8px; text-align: start; cursor: zoom-in; }
  .gallery.phone .shot { flex: 0 0 220px; }
  .shot span { font-size: 13px; font-weight: 800; color: hsl(var(--muted-foreground)); }
  .shot img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; object-position: top; border-radius: 12px; background: hsl(var(--muted)); box-shadow: 0 0 0 1px hsl(var(--foreground) / .1); }
  .gallery.phone .shot img { aspect-ratio: 390 / 844; }
  .shot:hover img { box-shadow: 0 0 0 2px hsl(var(--foreground) / .55); }
  .shot:hover span { color: hsl(var(--foreground)); }
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
  @container (max-width: 560px) {
    .facts { grid-auto-flow: row; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 0; }
    .facts div + div { border-inline-start: 0; }
    .shot { flex-basis: 86%; }
    .gallery.phone .shot { flex-basis: 46%; }
    .heading p { white-space: normal; }
  }
</style>
