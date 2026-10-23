<script lang="ts">
  import ThemeShots from './ThemeShots.svelte'
  import { motion, reducedMotion } from '$lib/motion/gm-motion'
  import { platformFor, platformLabel, shotsFor } from '$lib/themes/packages'
  import { isMobile } from '$lib/platform'
  import type { ThemeListing } from '$lib/store/themes'

  let { listings, onopen }: { listings: ThemeListing[]; onopen: (listing: ThemeListing) => void } = $props()
  let at = $state(0)
  let held = $state(false)
  const listing = $derived(listings.length ? listings[at % listings.length] : undefined)
  const platform = $derived(listing ? platformFor(listing.release, $isMobile ? 'phone' : 'desktop') : 'desktop')
  // The banner moves on to the next theme every 8 s, but never while it's hovered or focused.
  $effect(() => {
    if (held || listings.length < 2 || reducedMotion()) return
    const timer = setInterval(() => { at = (at + 1) % listings.length }, 8000)
    return () => clearInterval(timer)
  })
</script>

{#if listing}
  <section class="hero" aria-label="Featured theme" data-nav-row
    onmouseenter={() => held = true} onmouseleave={() => held = false} onfocusin={() => held = true} onfocusout={() => held = false}>
    {#key `${listing.origin}|${listing.release.id}`}
      <button type="button" class="feature" data-focusable data-theme-key={`${listing.origin}|${listing.release.id}`} onclick={() => onopen(listing)} in:motion={{ opacity: [0, 1], duration: 400 }}>
        <ThemeShots shots={shotsFor(listing.release, platform)} name={listing.release.name} playing chrome={false} />
        <span class="scrim" aria-hidden="true"></span>
        <span class="copy">
          <span class="eyebrow">Featured theme</span>
          <strong>{listing.release.name}</strong>
          <span class="description">{listing.release.description}</span>
          <span class="cta"><span class="view">View theme</span><span class="meta">{listing.release.author} · {platformLabel(listing.release.platforms)}</span></span>
        </span>
      </button>
    {/key}
    {#if listings.length > 1}<span class="pips" aria-hidden="true">{#each listings as item, i (`${item.origin}|${item.release.id}`)}<i class:on={i === at % listings.length}></i>{/each}</span>{/if}
  </section>
{/if}

<style>
  .hero { position: relative; }
  /* The screenshot fills the card; the copy sits on a scrim over its left side, so it reads on any theme. */
  .feature { position: relative; display: block; width: 100%; overflow: hidden; border-radius: 20px; text-align: start; color: #fff; isolation: isolate; }
  .feature :global([data-theme-shots]) { aspect-ratio: 21 / 9; border-radius: 0; }
  .feature :global([data-theme-shots] img) { object-position: top; }
  .scrim { position: absolute; inset: 0; z-index: 3; pointer-events: none;
    background: linear-gradient(90deg, hsl(0 0% 0% / .92) 0%, hsl(0 0% 0% / .76) 40%, hsl(0 0% 0% / 0) 74%), linear-gradient(0deg, hsl(0 0% 0% / .6) 0%, hsl(0 0% 0% / 0) 45%); }
  .copy { position: absolute; z-index: 4; left: clamp(20px, 4%, 44px); bottom: clamp(20px, 8%, 48px); width: min(440px, 46%); display: flex; flex-direction: column; gap: 10px; }
  .eyebrow { font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: hsl(0 0% 100% / .7); }
  strong { font-size: clamp(30px, 4.2vw, 52px); font-weight: 900; letter-spacing: -.035em; line-height: 1; }
  .description { font-size: 14px; line-height: 1.55; color: hsl(0 0% 100% / .82); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
  .cta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-top: 6px; }
  .view { padding: 10px 20px; border-radius: 999px; background: #fff; color: #000; font-size: 13px; font-weight: 800; }
  .feature:hover .view { background: hsl(0 0% 100% / .85); }
  .meta { font-size: 12px; color: hsl(0 0% 100% / .65); }
  .pips { position: absolute; z-index: 5; right: 24px; bottom: 22px; display: flex; gap: 5px; pointer-events: none; }
  .pips i { width: 6px; height: 6px; border-radius: 999px; background: hsl(0 0% 100% / .35); }
  .pips i.on { width: 20px; background: #fff; }
  /* Narrow pages (phones): a phone screenshot is busy right where overlaid copy would sit, so the
     copy moves under the image onto the card itself. */
  @container (max-width: 560px) {
    .feature { display: flex; flex-direction: column; background: hsl(var(--foreground) / .06); color: hsl(var(--foreground)); }
    .feature :global([data-theme-shots]) { aspect-ratio: 4 / 3; }
    .scrim { display: none; }
    .copy { position: static; width: auto; padding: 18px 20px 22px; }
    .eyebrow, .meta { color: hsl(var(--muted-foreground)); }
    .description { color: hsl(var(--foreground) / .8); }
    .view { background: hsl(var(--foreground)); color: hsl(var(--background)); }
    .feature:hover .view { background: hsl(var(--foreground) / .85); }
    .pips { top: 16px; bottom: auto; }
  }
</style>
