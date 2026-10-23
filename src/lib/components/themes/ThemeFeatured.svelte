<script lang="ts">
  import ThemeShots from './ThemeShots.svelte'
  import { motion, reducedMotion } from '$lib/motion/gm-motion'
  import { platformLabel, primaryPlatform, shotsFor } from '$lib/themes/packages'
  import type { ThemeListing } from '$lib/store/themes'

  let { listings, onopen }: { listings: ThemeListing[]; onopen: (listing: ThemeListing) => void } = $props()
  let at = $state(0)
  let held = $state(false)
  const listing = $derived(listings.length ? listings[at % listings.length] : undefined)
  const platform = $derived(listing ? primaryPlatform(listing.release) : 'desktop')
  // The banner moves on to the next theme every 8 s, but never while it's hovered or focused.
  $effect(() => {
    if (held || listings.length < 2 || reducedMotion()) return
    const timer = setInterval(() => { at = (at + 1) % listings.length }, 8000)
    return () => clearInterval(timer)
  })
</script>

{#if listing}
  <section class="featured" aria-label="Featured theme" data-nav-row
    onmouseenter={() => held = true} onmouseleave={() => held = false} onfocusin={() => held = true} onfocusout={() => held = false}>
    {#key `${listing.origin}|${listing.release.id}`}
      <button type="button" class="feature" data-focusable data-theme-key={`${listing.origin}|${listing.release.id}`} onclick={() => onopen(listing)} in:motion={{ opacity: [0, 1], duration: 400 }}>
        <ThemeShots shots={shotsFor(listing.release, platform)} name={listing.release.name} playing phone={platform === 'phone'} />
        <span class="copy">
          <span class="eyebrow">Featured</span>
          <strong>{listing.release.name}</strong>
          <span class="description">{listing.release.description}</span>
          <span class="meta">{listing.release.author} · {platformLabel(listing.release.platforms)}</span>
          <span class="view">View theme</span>
        </span>
      </button>
    {/key}
    {#if listings.length > 1}<span class="pips" aria-hidden="true">{#each listings as item, i (`${item.origin}|${item.release.id}`)}<i class:on={i === at % listings.length}></i>{/each}</span>{/if}
  </section>
{/if}

<style>
  .featured { position: relative; margin-top: 8px; }
  .feature { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 24px; align-items: center; width: 100%; padding: 12px; border-radius: 18px; text-align: start; background: hsl(var(--foreground) / .04); }
  .feature:hover { background: hsl(var(--foreground) / .07); }
  .feature :global([data-theme-shots]) { border-radius: 12px; }
  .copy { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .eyebrow { color: hsl(var(--muted-foreground)); font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  strong { font-size: clamp(24px, 3vw, 34px); font-weight: 900; letter-spacing: -.03em; line-height: 1.1; }
  .description { color: hsl(var(--muted-foreground)); font-size: 13px; line-height: 1.6; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
  .meta { color: hsl(var(--muted-foreground)); font-size: 11px; }
  .view { align-self: flex-start; margin-top: 6px; padding: 9px 16px; border-radius: 999px; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); font-size: 12px; font-weight: 800; }
  .pips { position: absolute; right: 24px; bottom: 22px; display: flex; gap: 5px; }
  .pips i { width: 6px; height: 6px; border-radius: 999px; background: hsl(var(--foreground) / .25); }
  .pips i.on { width: 18px; background: hsl(var(--foreground)); }
  @media (max-width: 760px) { .feature { grid-template-columns: 1fr; } .pips { display: none; } }
</style>
