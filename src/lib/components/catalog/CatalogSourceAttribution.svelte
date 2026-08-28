<script lang="ts">
  import type { Media, MediaCatalogIdentity } from '$lib/anilist/types'
  import AddonLogo from '$lib/components/player/AddonLogo.svelte'

  let { media, limit = 2, iconSize = 15 }: { media: Media; limit?: number; iconSize?: number } = $props()

  const sources = $derived.by(() => {
    const candidates = [media.catalog, ...(media.catalogAlternatives ?? [])]
    const seen = new Set<string>()
    return candidates.filter((source): source is MediaCatalogIdentity => {
      if (source?.provider !== 'jvm' || !source.sourceName) return false
      const key = `${source.sourceName}:${source.sourceLanguage ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })
  const visible = $derived(sources.slice(0, Math.max(1, limit)))
  const hidden = $derived(sources.slice(visible.length))
  const accessibleLabel = $derived(`Available from ${sources.map((source) => source.sourceName).join(', ')}`)
</script>

{#if sources.length}
  <div class="flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap"
       aria-label={accessibleLabel} title={accessibleLabel}>
    {#each visible as source, index (source.id)}
      {#if index}<span aria-hidden="true" class="shrink-0 text-muted-foreground/50">·</span>{/if}
      <span class="flex min-w-0 items-center gap-1">
        <AddonLogo logo={source.sourceIcon} name={source.sourceName} id={source.id} size={iconSize} />
        <span class="max-w-20 truncate">{source.sourceName}</span>
      </span>
    {/each}
    {#if hidden.length}
      <span aria-hidden="true" class="shrink-0 text-muted-foreground/50">·</span>
      <span class="shrink-0 font-bold text-muted-foreground" title={hidden.map((source) => source.sourceName).join(', ')}>+{hidden.length}</span>
    {/if}
  </div>
{/if}
