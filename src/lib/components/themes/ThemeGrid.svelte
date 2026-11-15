<script lang="ts">
  import Check from '@lucide/svelte/icons/check'
  import PaletteHomePreview from '$lib/components/settings/PaletteHomePreview.svelte'
  import { newerVersion, platformFor, shotsFor, type ThemePlatform } from '$lib/themes/packages'
  import { DEFAULT_THEME_KEY, type ThemeEntry, type ThemeSection } from '$lib/themes/store-shelves'
  import type { ThemeTokens } from '$lib/theme-tokens'

  // The store gallery: each section a titled grid of large cards. A card is the theme's screenshot,
  // never covered, with its name and status underneath; it opens the theme's page. Installed themes
  // appear only under Installed, so the store sections list what you don't have yet.
  let { sections, applied, device, loading, tokensOf, note, onopen }: {
    sections: ThemeSection[]
    /** The applied theme's key, or null while a shipped palette from Appearance is in use. */
    applied: string | null
    device: ThemePlatform
    /** The stores are still loading: skeleton cards stand in for their sections. */
    loading: boolean
    tokensOf: (entry: ThemeEntry) => ThemeTokens | undefined
    /** Why this client can't install a listing, else ''. */
    note: (entry: ThemeEntry) => string
    onopen: (entry: ThemeEntry) => void
  } = $props()

  const nameOf = (entry: ThemeEntry) => entry.key === DEFAULT_THEME_KEY ? 'Izumi default' : entry.installed?.package.name ?? entry.listing?.release.name ?? ''
  const authorOf = (entry: ThemeEntry) => entry.key === DEFAULT_THEME_KEY ? 'izumi' : entry.installed?.package.author ?? entry.listing?.release.author ?? ''
  // Desktop shows a listing's desktop Home; a phone shows three phone screens side by side.
  function shotsOf(entry: ThemeEntry) {
    const release = entry.listing?.release
    if (!release) return { urls: [] as string[], phone: false }
    const platform = platformFor(release, device)
    const shots = shotsFor(release, platform)
    return platform === 'phone' ? { urls: shots.slice(0, 3).map((shot) => shot.url), phone: true } : { urls: shots.slice(0, 1).map((shot) => shot.url), phone: false }
  }
  const updatable = (entry: ThemeEntry) => !!entry.installed && !!entry.listing && newerVersion(entry.listing.release.version, entry.installed.package.version)
  function status(entry: ThemeEntry): string {
    if (entry.key === applied) return 'Applied'
    if (updatable(entry)) return 'Update'
    return note(entry)
  }
</script>

<div class="theme-grid" data-theme-grid>
  {#each sections as section (section.id)}
    <section aria-labelledby={`theme-section-${section.id}`}>
      <h3 id={`theme-section-${section.id}`}>{section.title}</h3>
      <div class="grid">
        {#each section.entries as entry (entry.key)}
          {@const shots = shotsOf(entry)}
          {@const tokens = shots.urls.length ? undefined : tokensOf(entry)}
          {@const label = status(entry)}
          <button type="button" class="card" data-focusable data-theme-key={entry.key} data-hint-a="Open" onclick={() => onopen(entry)}>
            <span class="shot" class:phones={shots.phone} style:--tint={shots.phone ? tokensOf(entry)?.theme : undefined} style:background={tokens ? `hsl(${tokens.background})` : undefined}>
              {#if entry.key === DEFAULT_THEME_KEY}<span class="live"><PaletteHomePreview preset="izumi" /></span>
              {:else if shots.urls.length}{#each shots.urls as url (url)}<img src={url} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />{/each}
              {:else if tokens}<i style:background={`hsl(${tokens.theme})`}></i>{/if}
            </span>
            <span class="info">
              <span class="who"><strong>{nameOf(entry)}</strong><span>By {authorOf(entry)}</span></span>
              {#if label}<span class="status" class:on={label === 'Applied' || label === 'Update'}>{#if label === 'Applied'}<Check size={14} aria-hidden="true" />{/if}{label}</span>{/if}
            </span>
          </button>
        {/each}
      </div>
    </section>
  {/each}
  {#if loading}
    <div class="grid skeletons" aria-label="Loading themes" aria-busy="true">{#each [1, 2, 3, 4] as item (item)}<span class="skeleton skeloader"></span>{/each}</div>
  {/if}
</div>

<style>
  /* rem, so the cards grow with a TV's larger root. */
  section + section, section + .skeletons { margin-top: 2.25rem; }
  h3 { margin: 0 0 .875rem .375rem; font-size: 1.1875rem; font-weight: 900; letter-spacing: -.02em; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem 1rem; }
  .card { display: flex; flex-direction: column; gap: .75rem; min-width: 0; padding: .375rem; border-radius: 1.125rem; text-align: start; }
  /* Hover and focus lift the picture and deepen its shadow; never a bare outline. */
  .shot { position: relative; display: grid; place-items: center; aspect-ratio: 16 / 10; overflow: hidden; border-radius: .875rem; background: hsl(var(--muted));
    box-shadow: 0 .25rem 1rem hsl(0 0% 0% / .25), 0 0 0 1px hsl(var(--foreground) / .08); transition: transform .2s ease, box-shadow .2s ease; }
  .shot > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top; transition: transform .3s ease; }
  .card:hover .shot, .card:focus-visible .shot { transform: translateY(-.25rem); box-shadow: 0 .875rem 2.25rem hsl(0 0% 0% / .45), 0 0 0 1px hsl(var(--foreground) / .14); }
  .card:hover .shot > img { transform: scale(1.035); }
  /* Phone screens stand side by side on the theme's own colour. */
  .shot.phones { display: flex; justify-content: center; gap: 4%; padding: 5% 0; background: color-mix(in srgb, hsl(var(--tint, var(--foreground))) 14%, hsl(var(--background))); }
  .shot.phones > img { position: static; width: auto; height: 100%; max-width: 30%; border-radius: .625rem; box-shadow: 0 .5rem 1.25rem hsl(0 0% 0% / .4); }
  .live { position: absolute; inset: 0; }
  .shot i { width: 30%; height: .375rem; border-radius: 999px; }
  .info { display: flex; align-items: flex-start; justify-content: space-between; gap: .75rem; padding: 0 .25rem; }
  .who { display: grid; gap: .125rem; min-width: 0; }
  .who > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  strong { font-size: 1.0625rem; font-weight: 900; letter-spacing: -.015em; }
  .who span { font-size: .75rem; color: hsl(var(--muted-foreground)); }
  .status { flex: none; display: inline-flex; align-items: center; gap: .25rem; margin-top: .125rem; padding: .1875rem .625rem; border-radius: 999px; font-size: .6875rem; font-weight: 800; background: hsl(var(--foreground) / .08); color: hsl(var(--muted-foreground)); }
  .status.on { background: hsl(var(--foreground)); color: hsl(var(--background)); }
  .skeleton { aspect-ratio: 16 / 10; border-radius: .875rem; background: hsl(var(--muted)); }
  /* Phones and narrow pages: one card per row. */
  @container (max-width: 36rem) {
    .grid { grid-template-columns: minmax(0, 1fr); }
  }
</style>
