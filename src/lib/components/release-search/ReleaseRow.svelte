<script lang="ts">
  import { describe, type Stream } from '$lib/stremio/parse'
  import { isPackRelease } from '$lib/release-search/release-media'

  let { stream, episode, onpick }: { stream: Stream; episode?: number; onpick: () => void } = $props()

  const info = $derived(describe(stream))
  const quality = $derived(info.quality ? `${info.quality}p` : '')
  const facts = $derived([
    info.sizeLabel,
    info.seeders != null ? `${info.seeders} seeders` : 'seeders unknown',
    info.addon,
    isPackRelease(stream) ? `plays episode ${episode ?? 1}` : '',
  ].filter(Boolean).join(' · '))
</script>

<button type="button" data-focusable data-release-row onclick={onpick}
  class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-1 py-3 text-left hover:bg-secondary/40 focus-visible:bg-secondary/40">
  <span class="truncate text-sm" title={info.label}>{info.label}</span>
  {#if quality}<span class="rounded-md bg-secondary px-2 py-0.5 text-xs font-semibold">{quality}</span>{:else}<span></span>{/if}
  <span class="col-span-2 truncate text-xs text-muted-foreground">{facts}</span>
</button>
