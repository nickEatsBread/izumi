<script lang="ts">
  // The unified "Continue Watching" row. LOCAL-FIRST: it paints instantly from an on-device copy
  // (the persisted `cwSnapshot` view cache ∪ local watch history), then AniList (CURRENT) + MyAnimeList
  // (watching) reconcile in the BACKGROUND — no skeleton wait on the network. De-duped by media id,
  // resume-aware, most-recent first. All merge/sync logic lives in $lib/player/continue-watching.
  import { onMount, tick } from 'svelte'
  import { getContextClient } from '@urql/svelte'
  import { continueWatching, reconciling, reconciledOnce, reconcileContinueWatching, dismissContinueWatching } from '$lib/player/continue-watching'
  import { longPressDismiss } from './continue-dismiss'
  import Carousel from './Carousel.svelte'
  import ContinueCard from './ContinueCard.svelte'
  import * as h from '$lib/haptics'

  let { title, userName, malActive }: { title: string; userName?: string; malActive: boolean } = $props()
  const client = getContextClient()

  const items = $derived($continueWatching)

  // D on a keyboard and X on a controller remove the active card. The controller translator maps
  // X to the same D event, keeping one dismissal path and the same tracker side effect.
  let activeId = $state<number | null>(null)
  async function dismiss(item: (typeof items)[number]) {
    const idx = items.findIndex((entry) => entry.media.id === item.media.id)
    const next = items[idx + 1] ?? items[idx - 1]
    h.warn()
    dismissContinueWatching(item.media, item.progress)
    await tick()
    if (next) {
      activeId = next.media.id
      const el = document.querySelector(`[data-cw-id="${next.media.id}"] [data-focusable]`) as HTMLElement | null
      el?.focus()
    } else {
      activeId = null
    }
  }
  function onKey(e: KeyboardEvent) {
    if ((e.key !== 'd' && e.key !== 'D') || e.ctrlKey || e.metaKey || e.altKey) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return // don't hijack typing
    if (activeId == null) return
    const item = items.find((i) => i.media.id === activeId)
    if (!item) return
    e.preventDefault()
    dismiss(item)
  }
  // Cold first launch only: nothing cached AND a tracker could still fill the row.
  const cold = $derived(!items.length && $reconciling && (!!userName || malActive))
  // Provisional cue: gray the cached cards while the FIRST reconcile of the session runs, then swap
  // to crisp. Later home visits reconcile silently (data is already live).
  const provisional = $derived($reconciling && !$reconciledOnce && items.length > 0)

  onMount(() => { void reconcileContinueWatching(client, userName, malActive) })
</script>

<svelte:window onkeydown={onKey} />

{#if cold}
  <Carousel {title}>
    {#each Array.from({ length: 5 }) as _}
      <div class="skeloader aspect-video w-[72vw] shrink-0 rounded-lg sm:w-[264px]"></div>
    {/each}
  </Carousel>
{:else if items.length}
  <Carousel {title}>
    {#each items as item (item.media.id)}
      <div class="shrink-0 transition-[opacity,filter] duration-300 {provisional ? 'opacity-40 grayscale' : ''}"
           data-cw-id={item.media.id}
           role="group"
           use:longPressDismiss={{ onLongPress: () => dismiss(item) }}
           onmouseenter={() => (activeId = item.media.id)}
           onmouseleave={() => { if (activeId === item.media.id) activeId = null }}
           onfocusin={() => (activeId = item.media.id)}
           onfocusout={() => { if (activeId === item.media.id) activeId = null }}>
        <ContinueCard media={item.media} progress={item.progress} />
      </div>
    {/each}
  </Carousel>
{/if}
