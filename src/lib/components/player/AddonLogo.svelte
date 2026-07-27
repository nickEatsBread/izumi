<script lang="ts">
  // The icon that says WHICH source a row came from.
  //
  // Every level of this exists because the previous single <img> had no answer for a failure:
  // a manifest logo whose host is down, or a relative path we mis-read as base64, left a broken
  // image box on the row forever. The ladder is: the addon's own icon → a deterministic coloured
  // tile with its initial. Never a broken box, and never nothing.
  import { logoTile } from '$lib/stremio/addon-logo'

  let { logo, name, id, size = 20 }: {
    logo?: string
    name?: string
    id?: string
    size?: number
  } = $props()

  // Addon manifest logos arrive already absolute (resolved at fetch time, where the base URL is
  // known). Extension icons arrive as a bare base64 payload instead, so they still need wrapping.
  const src = $derived(
    !logo ? undefined
      : /^(?:https?:|data:|blob:)/i.test(logo) ? logo
      : `data:image/png;base64,${logo}`,
  )
  const tile = $derived(logoTile(id ?? name ?? '', name ?? ''))

  // Reset when the row is recycled onto a different source, or one dead icon would poison the
  // next addon to reuse this component instance.
  let failedSrc = $state<string | undefined>(undefined)
  const broken = $derived(!src || failedSrc === src)
</script>

{#if broken}
  <span
    title={name}
    aria-label={name}
    class="inline-flex shrink-0 items-center justify-center rounded font-black leading-none text-white/95 ring-1 ring-white/10"
    style="height:{size}px;width:{size}px;font-size:{Math.round(size * 0.5)}px;background:linear-gradient(135deg,{tile.from},{tile.to})"
  >{tile.initial}</span>
{:else}
  <img
    {src}
    alt={name ?? ''}
    title={name}
    width={size}
    height={size}
    loading="lazy"
    decoding="async"
    referrerpolicy="no-referrer"
    onerror={() => (failedSrc = src)}
    class="shrink-0 rounded object-contain ring-1 ring-white/10"
    style="height:{size}px;width:{size}px"
  />
{/if}
