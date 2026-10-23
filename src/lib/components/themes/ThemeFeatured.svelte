<script lang="ts">
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import ThemeShots from './ThemeShots.svelte'
  import { motion, reducedMotion } from '$lib/motion/gm-motion'
  import { SCREEN_LABELS, platformFor, shotsFor } from '$lib/themes/packages'
  import { isMobile } from '$lib/platform'
  import type { ThemeListing } from '$lib/store/themes'

  let { listings, onopen }: { listings: ThemeListing[]; onopen: (listing: ThemeListing) => void } = $props()
  let at = $state(0)
  let held = $state(false)
  // The screen in the big viewer, and whether a screen thumbnail is being pointed at (it holds there).
  let index = $state(0)
  let pinned = $state(false)
  const listing = $derived(listings.length ? listings[at % listings.length] : undefined)
  const platform = $derived(listing ? platformFor(listing.release, $isMobile ? 'phone' : 'desktop') : 'desktop')
  const shots = $derived(listing ? shotsFor(listing.release, platform) : [])
  const phone = $derived(platform === 'phone')
  // The next featured theme every 8 s, but never while any part of the banner is hovered or focused.
  $effect(() => {
    if (held || listings.length < 2 || reducedMotion()) return
    const timer = setInterval(() => step(1), 8000)
    return () => clearInterval(timer)
  })
  function step(by: number) { at = (at + by + listings.length) % listings.length; index = 0; pinned = false }
  function show(i: number) { index = i; pinned = true }
</script>

{#if listing}
  <section class="featured" aria-labelledby="theme-featured-title"
    onmouseenter={() => held = true} onmouseleave={() => held = false} onfocusin={() => held = true} onfocusout={() => held = false}>
    <div class="head">
      <h3 id="theme-featured-title">Featured</h3>
      {#if listings.length > 1}
        <div class="arrows">
          <button type="button" data-focusable aria-label="Previous featured theme" onclick={() => step(-1)}><ChevronLeft size={18} /></button>
          <button type="button" data-focusable aria-label="Next featured theme" onclick={() => step(1)}><ChevronRight size={18} /></button>
        </div>
      {/if}
    </div>
    {#key `${listing.origin}|${listing.release.id}`}
      <div class="card" data-nav-row in:motion={{ opacity: [0, 1], duration: 300 }}>
        <!-- The screenshot is never covered: everything about the theme sits in the column beside it. -->
        <button type="button" class="stage" data-focusable data-theme-key={`${listing.origin}|${listing.release.id}`} aria-label={`View ${listing.release.name}`} onclick={() => onopen(listing)}>
          <ThemeShots {shots} name={listing.release.name} bind:index playing={!pinned} rewind={false} chrome={false} {phone} strip={phone} />
        </button>
        <div class="side">
          <strong class="name">{listing.release.name}</strong>
          <p class="description">{listing.release.description}</p>
          {#if !phone && shots.length > 1}
            <div class="screens" role="group" aria-label={`${listing.release.name} screens`}>
              {#each shots as shot, i (shot.url)}
                <button type="button" class="screen" data-focusable aria-pressed={i === index} aria-label={`Show ${SCREEN_LABELS[shot.screen]}`}
                  onmouseenter={() => show(i)} onmouseleave={() => pinned = false} onfocus={() => show(i)} onblur={() => pinned = false} onclick={() => show(i)}>
                  <img src={shot.url} alt="" loading="lazy" referrerpolicy="no-referrer" />
                  <span>{SCREEN_LABELS[shot.screen]}</span>
                </button>
              {/each}
            </div>
          {/if}
          <button type="button" class="view" data-focusable onclick={() => onopen(listing)}>View theme</button>
        </div>
      </div>
    {/key}
    {#if listings.length > 1}<span class="pips" aria-hidden="true">{#each listings as item, i (`${item.origin}|${item.release.id}`)}<i class:on={i === at % listings.length}></i>{/each}</span>{/if}
  </section>
{/if}

<style>
  .head { display: flex; align-items: center; justify-content: space-between; margin: 0 0 10px 8px; }
  h3 { font-size: 19px; font-weight: 900; letter-spacing: -.02em; }
  .arrows { display: flex; gap: 6px; }
  .arrows button { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 999px; background: hsl(var(--foreground) / .07); }
  .arrows button:hover { background: hsl(var(--foreground) / .14); }
  .card { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(220px, 1fr); gap: 20px; padding: 12px; border-radius: 18px; background: hsl(var(--foreground) / .05); }
  /* The stage reads as clickable: a ring and a lift in brightness on hover, no motion (Deck-safe). */
  .stage { display: block; overflow: hidden; border-radius: 12px; box-shadow: 0 0 0 2px transparent; }
  .stage :global([data-theme-shots]) { border-radius: 12px; background: transparent; }
  .stage:hover { box-shadow: 0 0 0 2px hsl(var(--foreground) / .55); filter: brightness(1.05); }
  .side { display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: 4px 6px 4px 0; }
  .name { font-size: 26px; font-weight: 900; letter-spacing: -.03em; line-height: 1.1; }
  .description { font-size: 13px; line-height: 1.55; color: hsl(var(--muted-foreground)); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
  .screens { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  /* Each screen's name sits on its thumbnail, so the column stays as tall as the screenshot. */
  .screen { position: relative; display: block; border-radius: 6px; outline: 2px solid transparent; outline-offset: 1px; }
  .screen img { display: block; aspect-ratio: 16 / 10; width: 100%; object-fit: cover; object-position: top; border-radius: 6px; background: hsl(var(--muted)); }
  .screen span { position: absolute; left: 5px; bottom: 5px; padding: 1px 7px; border-radius: 999px; font-size: 10px; font-weight: 800; background: hsl(0 0% 0% / .72); color: #fff; }
  .screen:hover, .screen[aria-pressed='true'] { outline-color: hsl(var(--foreground)); }
  .view { align-self: flex-start; margin-top: auto; padding: 10px 20px; border-radius: 999px; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); font-size: 13px; font-weight: 800; }
  .view:hover { filter: brightness(1.08); }
  .pips { display: flex; justify-content: center; gap: 5px; margin-top: 12px; }
  .pips i { width: 6px; height: 6px; border-radius: 999px; background: hsl(var(--foreground) / .22); }
  .pips i.on { width: 18px; background: hsl(var(--foreground) / .8); }
  /* Narrower pages stack the column under the screenshot; its screens become one row. */
  @container (max-width: 760px) {
    .card { grid-template-columns: 1fr; gap: 14px; }
    .side { padding: 0 4px 4px; }
    .screens { grid-template-columns: repeat(4, 1fr); }
  }
</style>
