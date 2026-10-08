<script lang="ts">
  // The unified "Continue Watching" row. LOCAL-FIRST: it paints instantly from an on-device copy
  // (the persisted `cwSnapshot` view cache ∪ local watch history), then AniList (CURRENT) + MyAnimeList
  // (watching) reconcile in the BACKGROUND — no skeleton wait on the network. De-duped by media id,
  // resume-aware, most-recent first. All merge/sync logic lives in $lib/player/continue-watching.
  import { getContext, tick } from 'svelte'
  import { get } from 'svelte/store'
  import { getContextClient } from '@urql/svelte'
  import { focusWhenIdle } from '$lib/nav/initial-focus'
  import { gameMode } from '$lib/player/session'
  import { continueWatching, reconciling, reconciledOnce, reconcileContinueWatching, dismissContinueWatching, filterContinueWatching } from '$lib/player/continue-watching'
  import { catalogProvider, continueWatchingCatalogScope } from '$lib/settings/catalog'
  import { longPressDismiss } from './continue-dismiss'
  import Carousel from './Carousel.svelte'
  import ContinueCard from './ContinueCard.svelte'
  import * as h from '$lib/haptics'
  import { themePresentation } from '$lib/themes/runtime'
  import { ROW_CONTEXT, type RowScope } from '$lib/themes/presentation'

  let { title, userName, malActive, catalogScope }: {
    title: string
    userName?: string
    malActive: boolean
    /** Merged Home always spans providers without rewriting the user's Separate-mode preference. */
    catalogScope?: 'provider' | 'all'
  } = $props()
  const client = getContextClient()
  const rowScope = getContext<(() => RowScope) | undefined>(ROW_CONTEXT)

  // The row's view-more link (`row.more`) opens the Library, whose default list is the titles being
  // watched, each with its resume Play. izumi's own Home shows none: a theme turns it on by naming a
  // `heading.viewMore` style (`text` or `arrow`) on the continue row itself, the role `continue` or
  // the row's id, so a style set for every row (`rows.defaults`) never adds one.
  const viewMoreHref = $derived.by(() => {
    const id = rowScope?.().id ?? ''
    const byId = $themePresentation?.rows?.byId
    const own = (byId?.[id]?.heading ?? byId?.continue?.heading)?.viewMore
    return own === 'text' || own === 'arrow' ? '/app/library' : undefined
  })

  const items = $derived(filterContinueWatching(
    $continueWatching,
    $catalogProvider,
    catalogScope ?? $continueWatchingCatalogScope,
  ))

  // D on a keyboard and X on a controller remove the active card. The controller translator maps
  // X to the same D event, keeping one dismissal path and the same tracker side effect.
  let activeId = $state<number | null>(null)
  async function dismiss(item: (typeof items)[number]) {
    const idx = items.findIndex((entry) => entry.media.id === item.media.id)
    const next = items[idx + 1] ?? items[idx - 1]
    // Hover and keyboard/controller focus both set activeId. Only move focus when the dismissed
    // card actually held it; focusing after a mouse-hover D shortcut makes Chromium draw a stray
    // focus-visible outline around the replacement card.
    const restoreFocus = document.activeElement?.closest(`[data-cw-id="${item.media.id}"]`) != null
    h.warn()
    dismissContinueWatching(item.media, item.progress)
    activeId = null
    if (!restoreFocus || !next) return
    await tick()
    activeId = next.media.id
    const el = document.querySelector(`[data-cw-id="${next.media.id}"] [data-focusable]`) as HTMLElement | null
    el?.focus({ preventScroll: true })
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
  // Home without a featured banner starts on the first Continue card in Game mode, so the first A
  // resumes. A focus restore (Back to the card you left) runs first and wins.
  const firstFocus = () => get(gameMode) && location.pathname.replace(/\/$/, '') === '/app/home' && !document.querySelector('[data-slot="home.hero"]:not([data-state="loading"])')

  // Re-run whenever the tracker identity changes, not only on mount. With no tracker the reconcile
  // returns at once; when a device transfer (or a sign-in on the Sync/Accounts screens) then lands
  // the AniList/MAL token while Home is already mounted, the row stayed empty until a restart —
  // seen on a Deck straight after "Set up from another device" on 2026-09-12. The TTL inside
  // reconcileContinueWatching still stops this from re-fetching on every unrelated re-render.
  $effect(() => {
    void reconcileContinueWatching(client, userName, malActive)
  })
</script>

<svelte:window onkeydown={onKey} />

{#if cold}
  <Carousel {title} {viewMoreHref}>
    {#each Array.from({ length: 5 }) as _}
      <div data-part="row.skeleton" class="skeloader aspect-video w-[72vw] shrink-0 rounded-lg sm:w-[264px]" data-theme-continue-skeleton></div>
    {/each}
  </Carousel>
{:else if items.length}
  <Carousel {title} {viewMoreHref}>
    {#each items as item, index (item.media.id)}
      <div class="shrink-0 transition-[opacity,filter] duration-300 {provisional ? 'opacity-40 grayscale' : ''}"
           data-cw-id={item.media.id}
           use:focusWhenIdle={index === 0 ? firstFocus : false}
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
