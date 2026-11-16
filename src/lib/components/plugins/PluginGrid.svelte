<script lang="ts">
  import AddonLogo from '$lib/components/player/AddonLogo.svelte'
  import { pluginNote, pluginUpdatable, type PluginEntry, type PluginSection } from '$lib/plugins/sections'

  // The plugin gallery, laid out like the Themes page: each section a titled grid of cards, opening the
  // plugin's page. Installed plugins appear only under Installed (with where they came from), so the
  // store sections list what you don't have yet.
  let { sections, loading, fromOf, onopen }: {
    sections: PluginSection[]
    /** The stores are still loading: skeleton cards stand in for their sections. */
    loading: boolean
    /** Where an install came from: its store's name, a link or a file. */
    fromOf: (entry: PluginEntry) => string
    onopen: (entry: PluginEntry) => void
  } = $props()

  const nameOf = (entry: PluginEntry) => entry.installed?.manifest.name ?? entry.listing?.entry.name ?? ''
  const authorOf = (entry: PluginEntry) => entry.installed?.manifest.author ?? entry.listing?.entry.author ?? ''
  const descriptionOf = (entry: PluginEntry) => entry.installed?.manifest.description ?? entry.listing?.entry.description ?? ''
  function status(entry: PluginEntry): string {
    if (pluginUpdatable(entry)) return 'Update'
    if (entry.installed) return entry.installed.enabled ? 'On' : 'Off'
    return pluginNote(entry)
  }
</script>

<div class="plugin-grid" data-plugin-grid>
  {#each sections as section (section.id)}
    <section aria-labelledby={`plugin-section-${section.id}`}>
      <h3 id={`plugin-section-${section.id}`}>{section.title}</h3>
      <div class="grid">
        {#each section.entries as entry (entry.key)}
          {@const label = status(entry)}
          <button type="button" class="card" data-focusable data-plugin-key={entry.key} data-hint-a="Open" onclick={() => onopen(entry)}>
            <AddonLogo logo={entry.listing?.entry.icon} name={nameOf(entry)} id={entry.key} size={48} />
            <span class="info">
              <span class="who">
                <strong>{nameOf(entry)}</strong>
                <span>{#if authorOf(entry)}By {authorOf(entry)}{/if}{#if entry.installed}{authorOf(entry) ? ' · ' : ''}From {fromOf(entry)}{/if}</span>
              </span>
              {#if descriptionOf(entry)}<span class="description">{descriptionOf(entry)}</span>{/if}
            </span>
            {#if label}<span class="status" class:on={label === 'On' || label === 'Update'}>{label}</span>{/if}
          </button>
        {/each}
      </div>
    </section>
  {/each}
  {#if loading}
    <div class="grid skeletons" aria-label="Loading plugins" aria-busy="true">{#each [1, 2, 3, 4] as item (item)}<span class="skeleton skeloader"></span>{/each}</div>
  {/if}
</div>

<style>
  /* rem, so the cards grow with a TV's larger root. */
  section + section, section + .skeletons { margin-top: 2.25rem; }
  h3 { margin: 0 0 .875rem .375rem; font-size: 1.1875rem; font-weight: 900; letter-spacing: -.02em; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
  /* Hover and focus lift the card and deepen its shadow; never a bare outline. */
  .card { display: flex; align-items: flex-start; gap: .875rem; min-width: 0; padding: 1rem; border-radius: 1rem; text-align: start; background: hsl(var(--foreground) / .045);
    box-shadow: 0 0 0 1px hsl(var(--foreground) / .08); transition: transform .2s ease, box-shadow .2s ease, background-color .2s ease; }
  .card:hover, .card:focus-visible { transform: translateY(-.1875rem); background: hsl(var(--foreground) / .07); box-shadow: 0 .75rem 1.75rem hsl(0 0% 0% / .35), 0 0 0 1px hsl(var(--foreground) / .14); }
  .info { display: grid; gap: .375rem; flex: 1; min-width: 0; }
  .who { display: grid; gap: .125rem; min-width: 0; }
  .who > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  strong { font-size: 1.0625rem; font-weight: 900; letter-spacing: -.015em; }
  .who span { font-size: .75rem; color: hsl(var(--muted-foreground)); }
  .description { font-size: .8125rem; line-height: 1.45; color: hsl(var(--foreground) / .8); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
  .status { flex: none; display: inline-flex; align-items: center; margin-top: .125rem; padding: .1875rem .625rem; border-radius: 999px; font-size: .6875rem; font-weight: 800; background: hsl(var(--foreground) / .08); color: hsl(var(--muted-foreground)); }
  .status.on { background: hsl(var(--foreground)); color: hsl(var(--background)); }
  .skeleton { height: 6.5rem; border-radius: 1rem; background: hsl(var(--muted)); }
  /* Phones and narrow pages: one card per row. */
  @container (max-width: 36rem) {
    .grid { grid-template-columns: minmax(0, 1fr); }
  }
</style>
