<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { page } from '$app/stores'
  import { afterNavigate } from '$app/navigation'
  import SettingsNav from '$lib/components/settings/SettingsNav.svelte'
  import SettingsSearch from '$lib/components/settings/SettingsSearch.svelte'
  import { isMobile, isTv } from '$lib/platform'
  import { heroMedia } from '$lib/stores/hero'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import * as h from '$lib/haptics'
  import { fly } from 'svelte/transition'
  import { m } from '$lib/paraglide/messages.js'
  import { acquireEdgeToEdge } from '$lib/actions/edge-to-edge'
  import { SETTING_FALLBACK_PARAM, SETTING_PARAM } from '$lib/settings/search'
  import { revealSetting } from '$lib/settings/search-target'
  import { settingsPageTitle, settingsParent } from '$lib/settings/hierarchy'
  import { settingsBack } from '$lib/settings/back'

  let { children } = $props()

  // No hero on any settings page — clear the shared banner.
  heroMedia.set(null)

  let appVersion = $state('')
  let osLine = $state('')
  onMount(async () => {
    try { const { getVersion } = await import('@tauri-apps/api/app'); appVersion = await getVersion() } catch { /* web */ }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const uad = (navigator as any).userAgentData
      if (uad?.getHighEntropyValues) {
        const v = await uad.getHighEntropyValues(['platform', 'platformVersion', 'architecture'])
        osLine = [v.platform, v.platformVersion, v.architecture].filter(Boolean).join(' ')
      } else { osLine = navigator.platform }
    } catch { osLine = navigator.platform }
  })

  // Mobile is a two-level push/pop: the grouped list index lives at the exact /app/settings path;
  // every other settings route is a "child" that shows a back-header. Treat the exact /app/settings
  // path as the index on mobile.
  const isIndex = $derived($page.url.pathname === '/app/settings')

  // Category title for the mobile back-header, so each child page's own leading heading can be
  // hidden (see <style>) — one title in the bar, app-style, not a redundant second heading below.
  // Titles and parents live in the shared route table (settings/hierarchy.ts).
  const childTitle = $derived(settingsPageTitle($page.url.pathname) ?? m.nav_settings())

  // Back goes one level up, not straight to the index: a sub-screen like the source reorder is
  // reached FROM its category, and dropping the user two levels loses their place in that page.
  // The href is the structural parent; a tap runs the same Back as B and the system Back
  // (settingsBack), which returns through history when the parent is the previous page instead of
  // pushing it again: the header no longer ping-pongs between two pages.
  const parentHref = $derived(settingsParent($page.url.pathname)?.href ?? '/app/settings')

  // A search hit (SettingsSearch → settingHref) or a deep link such as ListEditor's
  // `?setting=rating-style` names a row. After every navigation into or within Settings, including
  // the one that mounts this layout, reveal it: scroll, tint and, on a pad or TV, focus its safe
  // control (search-target.ts). History steps are skipped so route focus memory restores where the
  // user was; a newer navigation aborts a reveal that is still waiting for its row.
  let revealAbort: AbortController | null = null
  afterNavigate((navigation) => {
    revealAbort?.abort()
    revealAbort = null
    if (navigation.type === 'popstate') return
    const url = navigation.to?.url
    const key = url?.searchParams.get(SETTING_PARAM)
    if (!url || !key) return
    const controller = new AbortController()
    revealAbort = controller
    void revealSetting(key, url.searchParams.get(SETTING_FALLBACK_PARAM), controller.signal)
  })
  onDestroy(() => revealAbort?.abort())

  // The sticky back-header carries the status-bar inset itself (see the header markup), so the
  // page must not be inset a second time by `main`. Shared with the series page via a refcount:
  // their lifetimes can overlap mid-navigation, so a bare add/remove here could strip the inset
  // out from under the other screen (or vice versa).
  // Only the child screen has the sticky header that carries the inset (see the header markup).
  // The index has no header, so it must keep main's inset or its heading lands under the status bar.
  $effect(() => {
    if (!$isMobile || isIndex) return
    return acquireEdgeToEdge()
  })
</script>

{#if $isMobile}
  {#if isIndex}
    <!-- Mobile index: the grouped list, full width. -->
    <div class="p-4">
      <div class="mb-4 flex items-center justify-between px-1">
        <h1 class="text-2xl font-black">{m.nav_settings()}</h1>
        <SettingsSearch compact />
      </div>
      <SettingsNav />
      <div class="mt-6 space-y-0.5 px-1 text-xs text-muted-foreground">
        {#if appVersion}<div>{m.common_client_version({ version: appVersion })}</div>{/if}
        {#if osLine}<div>{osLine}</div>{/if}
      </div>
    </div>
  {:else}
    <!-- Mobile child: back-header + the category content. -->
    <div class="min-h-screen">
      <!-- This header owns the status-bar inset for the whole settings screen: it is `sticky`, so
           once the page scrolls it locks to the physical viewport top and `main`'s padding no
           longer protects it. Padding it here keeps the back button clear of the status bar at
           every scroll offset, and the blurred bar paints that band instead of leaving it black. -->
      <div class="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/95 px-2 py-2 backdrop-blur"
           style="padding-top:max(0.5rem,env(safe-area-inset-top))">
        <a href={parentHref} data-focusable onclick={(event) => { event.preventDefault(); h.tap(); settingsBack('header') }} aria-label={m.common_back_to_settings()}
           class="grid h-10 w-10 place-items-center rounded-full transition-colors active:bg-accent">
          <ChevronLeft size={22} />
        </a>
        <h1 class="text-lg font-black">{childTitle}</h1>
        <span class="ml-auto"><SettingsSearch compact /></span>
      </div>
      {#key $page.url.pathname}
        <!-- Vertical, short, and fading: a push that reads as a platform screen change rather than
             a carousel. app.css shortens every transition under the reduced-motion gate. -->
        <div class="settings-child" data-nav-surface="settings" in:fly={{ y: 12, duration: 160, opacity: 0 }}>{@render children()}</div>
      {/key}
    </div>
  {/if}
{:else}
  <!-- Desktop: nav rail + content side-by-side (unchanged). -->
  <div class="flex min-h-screen flex-row">
    <!-- The rail is its own d-pad region: Down at the end of a page never drops into it, and Left
         lands on the current category. Android TV keeps the shared region until the TV pass. -->
    <aside data-nav-region={$isTv ? undefined : 'settings'} class="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-border bg-background p-4">
      <h1 class="mb-3 px-3 text-2xl font-black">{m.nav_settings()}</h1>
      <div class="mb-4 px-1"><SettingsSearch /></div>
      <div class="min-h-0 flex-1"><SettingsNav /></div>
      <div class="mt-auto space-y-0.5 px-3 pt-6 text-xs text-muted-foreground">
        {#if appVersion}<div>{m.common_client_version({ version: appVersion })}</div>{/if}
        {#if osLine}<div>{osLine}</div>{/if}
      </div>
    </aside>
    <div class="min-w-0 flex-1" data-nav-surface="settings">{@render children()}</div>
  </div>
{/if}
