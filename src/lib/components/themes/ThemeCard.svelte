<script lang="ts">
  import ThemeShots from './ThemeShots.svelte'
  import { platformLabel, shotsFor, type ThemePlatform } from '$lib/themes/packages'
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
  <ThemeShots shots={shotsFor(release, platform)} name={release.name} {playing} phone={platform === 'phone'} />
  <span class="title"><strong>{release.name}</strong>{#if installed}<em>Installed</em>{/if}</span>
  <span class="meta">{release.author} · {platformLabel(release.platforms)}{#if storeName} · {storeName}{/if}</span>
  {#if note}<span class="meta">{note}</span>{/if}
</button>

<style>
  .theme-card { display: flex; flex-direction: column; gap: 4px; width: 100%; padding: 8px; border-radius: 14px; text-align: start; }
  .theme-card :global([data-theme-shots]) { border-radius: 10px; }
  .theme-card:not(:disabled):hover { background: hsl(var(--foreground) / .06); }
  .theme-card:disabled { opacity: .45; cursor: not-allowed; }
  .title { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-top: 8px; font-size: 15px; font-weight: 900; letter-spacing: -.01em; }
  em { font-style: normal; font-size: 11px; font-weight: 700; color: hsl(var(--muted-foreground)); }
  .meta { font-size: 11px; color: hsl(var(--muted-foreground)); }
</style>
