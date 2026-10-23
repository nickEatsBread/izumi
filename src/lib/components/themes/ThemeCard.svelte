<script lang="ts">
  import ThemeShots from './ThemeShots.svelte'
  import { shotsFor, type ThemePlatform } from '$lib/themes/packages'
  import type { ThemeListing } from '$lib/store/themes'

  let { listing, platform, installed, note = '', storeName = '', onopen }: {
    listing: ThemeListing
    platform: ThemePlatform
    installed: boolean
    /** Set when this client can't install the listing: the card shows it and stays disabled. */
    note?: string
    /** Shown for listings from a store other than the official catalog. */
    storeName?: string
    onopen: (listing: ThemeListing) => void
  } = $props()
  const release = $derived(listing.release)
  let playing = $state(false)
  let intent: ReturnType<typeof setTimeout> | undefined
  // A short hover intent, so sweeping the pointer across a shelf doesn't start every card.
  function hover() { clearTimeout(intent); intent = setTimeout(() => { playing = true }, 350) }
  function focus() { clearTimeout(intent); playing = true }
  function stop() { clearTimeout(intent); playing = false }
</script>

<button type="button" class="theme-card" data-focusable data-theme-key={`${listing.origin}|${release.id}`} disabled={!!note}
  onmouseenter={hover} onmouseleave={stop} onfocus={focus} onblur={stop} onclick={() => onopen(listing)}>
  <ThemeShots shots={shotsFor(release, platform)} name={release.name} {playing} phone={platform === 'phone'} strip={platform === 'phone'} />
  <span class="title"><strong>{release.name}</strong>{#if installed}<em>Installed</em>{/if}</span>
  <span class="meta">{release.description}</span>
  {#if storeName}<span class="meta">From {storeName}</span>{/if}
  {#if note}<span class="meta">{note}</span>{/if}
</button>

<style>
  .theme-card { display: flex; flex-direction: column; gap: 4px; width: 100%; text-align: start; }
  /* Hover lifts the picture, deepens its shadow and zooms it slightly inside its frame. */
  .theme-card :global([data-theme-shots]) { border-radius: 12px; box-shadow: 0 0 0 1px hsl(var(--foreground) / .08), 0 6px 18px hsl(0 0% 0% / .25); transition: translate 350ms cubic-bezier(.2, .8, .2, 1), box-shadow 350ms ease; }
  .theme-card :global([data-theme-shots] > img) { object-position: top; transition: scale 500ms cubic-bezier(.2, .8, .2, 1); }
  .theme-card:not(:disabled):hover :global([data-theme-shots]) { translate: 0 -4px; box-shadow: 0 0 0 1px hsl(var(--foreground) / .1), 0 18px 40px hsl(0 0% 0% / .5); }
  .theme-card:not(:disabled):hover :global([data-theme-shots] > img) { scale: 1.035; }
  @media (prefers-reduced-motion: reduce) { .theme-card :global([data-theme-shots]), .theme-card :global([data-theme-shots] > img) { transition: none; } }
  .theme-card:disabled { opacity: .45; cursor: not-allowed; }
  .title { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-top: 10px; font-size: 17px; font-weight: 900; letter-spacing: -.015em; }
  em { font-style: normal; font-size: 11px; font-weight: 700; color: hsl(var(--muted-foreground)); }
  .meta { font-size: 12px; color: hsl(var(--muted-foreground)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
