<script lang="ts">
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import ThemeShots from './ThemeShots.svelte'
  import { reducedMotion } from '$lib/motion/gm-motion'
  import { platformFor, shotsFor } from '$lib/themes/packages'
  import { isMobile } from '$lib/platform'
  import type { ThemeListing } from '$lib/store/themes'

  let { listings, onopen }: { listings: ThemeListing[]; onopen: (listing: ThemeListing) => void } = $props()
  let track = $state<HTMLElement>()
  let at = $state(0)
  // Moves only when asked (arrows, a swipe, a scroll or controller focus): carousels that advance on
  // their own get ignored and annoy. The next slide peeks in, so it reads as a carousel.
  function go(i: number) {
    if (!track) return
    at = Math.max(0, Math.min(listings.length - 1, i))
    const slide = track.children[at] as HTMLElement | undefined
    if (slide) track.scrollTo({ left: slide.offsetLeft, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }
  // After a swipe or scroll, the slide nearest the left edge is the current one.
  function sync() {
    if (!track) return
    let best = 0, distance = Infinity
    for (const [i, slide] of [...track.children].entries()) {
      const d = Math.abs((slide as HTMLElement).offsetLeft - track.scrollLeft)
      if (d < distance) { distance = d; best = i }
    }
    at = best
  }
</script>

{#if listings.length}
  <section class="featured" aria-labelledby="theme-featured-title">
    <div class="head">
      <h3 id="theme-featured-title">Featured</h3>
      {#if listings.length > 1}
        <div class="arrows">
          <button type="button" data-focusable aria-label="Previous featured theme" disabled={at === 0} onclick={() => go(at - 1)}><ChevronLeft size={18} /></button>
          <button type="button" data-focusable aria-label="Next featured theme" disabled={at === listings.length - 1} onclick={() => go(at + 1)}><ChevronRight size={18} /></button>
        </div>
      {/if}
    </div>
    <div class="track" bind:this={track} onscroll={sync} data-nav-row data-nav-row-items data-nav-scroll-x>
      {#each listings as listing, i (`${listing.origin}|${listing.release.id}`)}
        {@const platform = platformFor(listing.release, $isMobile ? 'phone' : 'desktop')}
        <article class="slide" aria-label={`${listing.release.name}, ${i + 1} of ${listings.length}`}>
          <!-- The screenshot is never covered: the name and actions sit beside it. -->
          <button type="button" class="stage" data-focusable data-theme-key={`${listing.origin}|${listing.release.id}`} aria-label={`View ${listing.release.name}`} onclick={() => onopen(listing)} onfocus={() => go(i)}>
            <ThemeShots shots={shotsFor(listing.release, platform)} name={listing.release.name} chrome={false} phone={platform === 'phone'} strip={platform === 'phone'} />
          </button>
          <div class="info">
            <strong class="name">{listing.release.name}</strong>
            <p class="description">{listing.release.description}</p>
            <button type="button" class="view" data-focusable onclick={() => onopen(listing)} onfocus={() => go(i)}>View theme</button>
          </div>
        </article>
      {/each}
    </div>
    {#if listings.length > 1}<span class="pips" aria-hidden="true">{#each listings as item, i (`${item.origin}|${item.release.id}`)}<i class:on={i === at}></i>{/each}</span>{/if}
  </section>
{/if}

<style>
  .head { display: flex; align-items: center; justify-content: space-between; margin: 0 0 12px; }
  h3 { font-size: 20px; font-weight: 900; letter-spacing: -.02em; }
  .arrows { display: flex; gap: 6px; }
  .arrows button { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 999px; background: hsl(var(--foreground) / .07); }
  .arrows button:hover:not(:disabled) { background: hsl(var(--foreground) / .14); }
  .arrows button:disabled { opacity: .35; }
  .track { position: relative; display: flex; gap: 14px; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
  .track::-webkit-scrollbar { display: none; }
  /* About 40% of a window tall: the screenshot takes 62% of the slide, the details the rest. */
  .slide { flex: 0 0 82%; scroll-snap-align: start; display: grid; grid-template-columns: minmax(0, 62fr) minmax(0, 38fr); gap: 20px; padding: 12px; border-radius: 18px; background: hsl(var(--foreground) / .05); }
  .stage { display: block; align-self: start; overflow: hidden; border-radius: 12px; box-shadow: 0 0 0 2px transparent; }
  .stage :global([data-theme-shots]) { border-radius: 12px; background: transparent; }
  .stage :global([data-theme-shots] > img) { object-position: top; }
  .stage:hover { box-shadow: 0 0 0 2px hsl(var(--foreground) / .55); filter: brightness(1.05); }
  .info { display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 6px 4px 4px 0; }
  .name { font-size: 26px; font-weight: 900; letter-spacing: -.03em; line-height: 1.1; }
  .description { font-size: 13px; line-height: 1.6; color: hsl(var(--muted-foreground)); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; line-clamp: 4; overflow: hidden; }
  .view { align-self: flex-start; margin-top: auto; padding: 10px 20px; border-radius: 999px; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); font-size: 13px; font-weight: 800; }
  .view:hover { filter: brightness(1.08); }
  .pips { display: flex; justify-content: center; gap: 5px; margin-top: 12px; }
  .pips i { width: 6px; height: 6px; border-radius: 999px; background: hsl(var(--foreground) / .22); }
  .pips i.on { width: 18px; background: hsl(var(--foreground) / .8); }
  /* Narrow pages: the details stack under the screenshot. */
  @container (max-width: 640px) {
    .slide { flex-basis: 88%; grid-template-columns: 1fr; gap: 12px; }
    .info { padding: 0 4px 4px; }
    .description { -webkit-line-clamp: 2; line-clamp: 2; }
  }
</style>
