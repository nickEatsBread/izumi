<script lang="ts">
  // The icon that says WHICH source a row came from.
  //
  // Every level of this exists because the previous single <img> had no answer for a failure:
  // a manifest logo whose host is down, or a relative path we mis-read as base64, left a broken
  // image box on the row forever. The ladder is: the addon's own icon → a deterministic coloured
  // tile with its initial. Never a broken box, and never nothing.
  import { logoTile, iconSrc } from '$lib/stremio/addon-logo'

  let { logo, name, id, size = 20 }: {
    logo?: string
    name?: string
    id?: string
    size?: number
  } = $props()

  // Addon manifest logos arrive already absolute (resolved at fetch time, where the base URL is
  // known). Extension icons arrive as a bare base64 payload instead, so they still need wrapping.
  const src = $derived(iconSrc(logo))
  const tile = $derived(logoTile(id ?? name ?? '', name ?? ''))

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
  aria-label={name ?? 'Addon'}
  class="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded font-black leading-none text-white/95 ring-1 ring-white/10"
  style="height:{size}px;width:{size}px;font-size:{Math.round(size * 0.5)}px;background:linear-gradient(135deg,{tile.from},{tile.to})"
>
  {tile.initial}
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
    class="absolute inset-0 rounded bg-neutral-900 object-contain transition-opacity duration-150"
    class:opacity-0={!loaded}
    style="height:{size}px;width:{size}px"
  />
  {/if}
</span>
