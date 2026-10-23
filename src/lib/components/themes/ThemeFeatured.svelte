<script lang="ts">
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import { motion } from '$lib/motion/gm-motion'
  import type { ThemeRelease, ThemePlatform } from '$lib/themes/packages'
  import type { ThemeListing } from '$lib/store/themes'

  let { listings, onopen, onpreview, previewLocked = false }: {
    listings: ThemeListing[]
    onopen: (listing: ThemeListing) => void
    /** Prepares the theme and steps into its preview from the given screenshot. */
    onpreview: (listing: ThemeListing, from: HTMLImageElement | null) => Promise<void>
    /** A Theme Studio draft is open: nothing may be previewed. */
    previewLocked?: boolean
  } = $props()
  let at = $state(0)
  let opening = $state(false)
  let windowImage = $state<HTMLImageElement>()
  const listing = $derived(listings.length ? listings[at % listings.length] : undefined)
  // Marketing-style art, not a raw screenshot: the theme's Home in a desktop window with its phone
  // Home in front, on a backdrop tinted with the theme's own accent colour.
  const home = (release: ThemeRelease, platform: ThemePlatform) => release.screenshots?.find((shot) => shot.platform === platform && shot.screen === 'home')?.url
  const desktopUrl = $derived(listing ? home(listing.release, 'desktop') ?? (listing.release.screenshots?.length ? undefined : listing.release.preview) : undefined)
  const phoneUrl = $derived(listing ? home(listing.release, 'phone') : undefined)
  // Moves only when asked: carousels that advance on their own get ignored and annoy.
  function step(by: number) { at = (at + by + listings.length) % listings.length }
  async function preview() {
    if (!listing || opening) return
    opening = true
    try { await onpreview(listing, windowImage ?? null) } finally { opening = false }
  }
</script>

{#if listing}
  <section class="spotlight" aria-roledescription="carousel" aria-label="Featured themes" data-nav-row>
    {#key `${listing.origin}|${listing.release.id}`}
      <div class="slide" class:tinted={!!listing.release.accent} style:--spot={listing.release.accent} aria-label={`${listing.release.name}, ${at + 1} of ${listings.length}`} in:motion={{ opacity: [0, 1], duration: 400 }}>
        <div class="copy">
          <h3 class="name">{listing.release.name}</h3>
          <p class="description">{listing.release.description}</p>
          <div class="actions">
            <button type="button" class="view" data-focusable data-theme-key={`${listing.origin}|${listing.release.id}`} onclick={() => onopen(listing)}>View theme</button>
            <button type="button" class="ghost" data-focusable disabled={previewLocked || opening} onclick={preview}>{opening ? 'Opening…' : 'Preview'}</button>
          </div>
        </div>
        <button type="button" class="stage" tabindex="-1" aria-label={`View ${listing.release.name}`} onclick={() => onopen(listing)}>
          {#if desktopUrl}<span class="window"><img bind:this={windowImage} src={desktopUrl} alt="" referrerpolicy="no-referrer" /></span>{/if}
          {#if phoneUrl}<span class="phone" class:alone={!desktopUrl}><img src={phoneUrl} alt="" referrerpolicy="no-referrer" /></span>{/if}
        </button>
      </div>
    {/key}
    {#if listings.length > 1}
      <div class="pager">
        <button type="button" data-focusable aria-label="Previous featured theme" onclick={() => step(-1)}><ChevronLeft size={16} /></button>
        <span>{at + 1} / {listings.length}</span>
        <button type="button" data-focusable aria-label="Next featured theme" onclick={() => step(1)}><ChevronRight size={16} /></button>
      </div>
    {/if}
  </section>
{/if}

<style>
  .spotlight { position: relative; overflow: hidden; border-radius: 22px; background: hsl(var(--foreground) / .05); }
  .slide { display: grid; grid-template-columns: minmax(0, 40fr) minmax(0, 60fr); aspect-ratio: 2.8 / 1; min-height: 280px; }
  /* The theme's accent (a validated HSL token) glowing from behind the devices. */
  .slide.tinted { background: radial-gradient(120% 140% at 85% 30%, hsl(var(--spot) / .5), hsl(var(--spot) / .12) 45%, transparent 75%); }
  .copy { display: flex; flex-direction: column; justify-content: center; gap: 12px; min-width: 0; padding: 0 24px 56px 36px; }
  .name { font-size: clamp(28px, 3.6vw, 42px); font-weight: 900; letter-spacing: -.035em; line-height: 1.05; }
  .description { font-size: 14px; line-height: 1.6; color: hsl(var(--foreground) / .78); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
  .view, .ghost { padding: 10px 20px; border-radius: 999px; font-size: 13px; font-weight: 800; }
  .view { background: hsl(var(--foreground)); color: hsl(var(--background)); }
  .ghost { background: hsl(var(--foreground) / .12); }
  .view:hover, .ghost:hover:not(:disabled) { filter: brightness(1.12); }
  .ghost:disabled { opacity: .5; cursor: not-allowed; }
  .stage { position: relative; display: block; overflow: hidden; }
  .window { position: absolute; left: 4%; top: 13%; width: 86%; overflow: hidden; border-radius: 10px; border: 1px solid hsl(0 0% 100% / .12); box-shadow: 0 24px 60px hsl(0 0% 0% / .55); }
  .phone { position: absolute; right: 3%; bottom: -6%; width: 20%; overflow: hidden; border-radius: 14px; border: 3px solid #0b0b0d; box-shadow: 0 24px 60px hsl(0 0% 0% / .65); }
  .phone.alone { right: auto; left: 34%; width: 32%; bottom: -12%; }
  .window img, .phone img { display: block; width: 100%; }
  .stage:hover .window { box-shadow: 0 24px 60px hsl(0 0% 0% / .55), 0 0 0 2px hsl(var(--foreground) / .6); }
  .pager { position: absolute; left: 36px; bottom: 18px; display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 800; color: hsl(var(--foreground) / .7); }
  .pager button { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 999px; background: hsl(var(--foreground) / .1); color: hsl(var(--foreground)); }
  .pager button:hover { background: hsl(var(--foreground) / .18); }
  /* Narrow pages: the devices on top, the details underneath. */
  @container (max-width: 640px) {
    .slide { grid-template-columns: 1fr; aspect-ratio: auto; min-height: 0; }
    .stage { order: -1; height: 220px; }
    .window { left: 6%; top: 10%; width: 78%; }
    .phone { width: 24%; }
    .copy { padding: 18px 20px 64px; }
    .pager { left: 20px; }
  }
</style>
