<script lang="ts">
  // The icon that says WHICH source a row came from.
  //
  // Every level of this exists because the previous single <img> had no answer for a failure:
  // a manifest logo whose host is down, or a relative path we mis-read as base64, left a broken
  // image box on the row forever. The ladder is: the addon's own icon → the shared source
  // placeholder. Never a broken box, and never nothing.
  //
  // The rung in the middle used to be a colour-hashed tile stamped with the source's initial. It
  // was invented here and nowhere else used it, so a source with no icon looked like one thing in
  // the player and another in the store. The placeholder is now shared (SourcePlaceholder), which
  // is the whole point: one missing-icon visual across the app.
  import { iconSrc } from '$lib/stremio/addon-logo'
  import SourcePlaceholder from '$lib/components/SourcePlaceholder.svelte'

  let { logo, name, id, size = 20 }: {
    logo?: string
    name?: string
    /** Kept in the API because call sites key rows on it; the icon no longer varies by identity. */
    id?: string
    size?: number
  } = $props()

  // Addon manifest logos arrive already absolute (resolved at fetch time, where the base URL is
  // known). Extension icons arrive as a bare base64 payload instead, so they still need wrapping.
  const src = $derived(iconSrc(logo))
  const radius = $derived(Math.max(3, Math.round(size * 0.22)))

  // Reset when the row is recycled onto a different source, or one dead icon would poison the
  // next addon to reuse this component instance.
  let failedSrc = $state<string | undefined>(undefined)
  let loadedSrc = $state<string | undefined>(undefined)
  const broken = $derived(!src || failedSrc === src)
  const loaded = $derived(!!src && loadedSrc === src)
</script>

<span
  title={name}
  role="img"
  aria-label={name ?? 'Source'}
  class="relative inline-flex shrink-0 items-center justify-center"
  style="height:{size}px;width:{size}px"
>
  <SourcePlaceholder {size} />
  {#if !broken}
  <img
    {src}
    alt=""
    title={name}
    width={size}
    height={size}
    loading="lazy"
    decoding="async"
    referrerpolicy="no-referrer"
    onload={() => (loadedSrc = src)}
    onerror={() => (failedSrc = src)}
    class="absolute inset-0 bg-neutral-900 object-contain transition-opacity duration-150"
    class:opacity-0={!loaded}
    style="height:{size}px;width:{size}px;border-radius:{radius}px"
  />
  {/if}
</span>
