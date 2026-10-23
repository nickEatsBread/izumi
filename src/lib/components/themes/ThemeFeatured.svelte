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
  // The screen in the big view. It changes only when someone picks one; nothing cycles on its own.
  let index = $state(0)
  const listing = $derived(listings.length ? listings[at % listings.length] : undefined)
  const platform = $derived(listing ? platformFor(listing.release, $isMobile ? 'phone' : 'desktop') : 'desktop')
  const shots = $derived(listing ? shotsFor(listing.release, platform) : [])
  const phone = $derived(platform === 'phone')
  // Calm on purpose: the next featured theme every 12 s, and never while the banner is hovered or focused.
  $effect(() => {
    if (held || listings.length < 2 || reducedMotion()) return
    const timer = setInterval(() => step(1), 12000)
    return () => clearInterval(timer)
  })
  function step(by: number) { at = (at + by + listings.length) % listings.length; index = 0 }
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
      <div class="card" data-nav-row in:motion={{ opacity: [0, 1], duration: 600 }}>
        <!-- The theme is shown big and uncovered; everything about it sits in the row underneath. -->
        <button type="button" class="stage" data-focusable data-theme-key={`${listing.origin}|${listing.release.id}`} aria-label={`View ${listing.release.name}`} onclick={() => onopen(listing)}>
          <ThemeShots {shots} name={listing.release.name} bind:index chrome={false} {phone} strip={phone} />
        </button>
        <div class="info">
          <div class="text"><strong class="name">{listing.release.name}</strong><p class="description">{listing.release.description}</p></div>
          {#if !phone && shots.length > 1}
            <div class="screens" role="group" aria-label={`${listing.release.name} screens`}>
              {#each shots as shot, i (shot.url)}
                <button type="button" data-focusable aria-pressed={i === index} onmouseenter={() => index = i} onfocus={() => index = i} onclick={() => index = i}>{SCREEN_LABELS[shot.screen]}</button>
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
  .card { padding: 12px; border-radius: 20px; background: hsl(var(--foreground) / .05); }
  /* The stage reads as clickable: a ring and a lift in brightness on hover, no motion (Deck-safe). */
  .stage { display: block; width: 100%; overflow: hidden; border-radius: 14px; box-shadow: 0 0 0 2px transparent; }
  .stage :global([data-theme-shots]) { aspect-ratio: 16 / 9; border-radius: 14px; background: transparent; }
  .stage :global([data-theme-shots] > img) { object-position: top; }
  .stage:hover { box-shadow: 0 0 0 2px hsl(var(--foreground) / .55); filter: brightness(1.05); }
  .info { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; padding: 14px 6px 4px; }
  .text { flex: 1 1 240px; min-width: 0; }
  .name { font-size: 24px; font-weight: 900; letter-spacing: -.03em; line-height: 1.15; }
  .description { margin-top: 2px; font-size: 13px; color: hsl(var(--muted-foreground)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .screens { display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: hsl(var(--foreground) / .07); }
  .screens button { height: 32px; padding: 0 14px; border-radius: 999px; font-size: 12px; font-weight: 800; color: hsl(var(--muted-foreground)); }
  .screens button:hover { color: hsl(var(--foreground)); }
  .screens button[aria-pressed='true'] { background: hsl(var(--foreground)); color: hsl(var(--background)); }
  .view { padding: 10px 20px; border-radius: 999px; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); font-size: 13px; font-weight: 800; }
  .view:hover { filter: brightness(1.08); }
  .pips { display: flex; justify-content: center; gap: 5px; margin-top: 12px; }
  .pips i { width: 6px; height: 6px; border-radius: 999px; background: hsl(var(--foreground) / .22); }
  .pips i.on { width: 18px; background: hsl(var(--foreground) / .8); }
  /* Narrow pages: the screen switch takes its own full-width row above the button. */
  @container (max-width: 640px) {
    .screens { order: 1; width: 100%; }
    .screens button { flex: 1 1 0; padding: 0 6px; }
    .view { order: 2; }
  }
</style>
