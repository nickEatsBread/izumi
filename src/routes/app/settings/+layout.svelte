<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/stores'
  import SettingsNav from '$lib/components/settings/SettingsNav.svelte'
  import SettingsSearch from '$lib/components/settings/SettingsSearch.svelte'
  import { isMobile } from '$lib/platform'
  import { heroMedia } from '$lib/stores/hero'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import * as h from '$lib/haptics'
  import { fly } from 'svelte/transition'
  import { m } from '$lib/paraglide/messages.js'
  import { acquireEdgeToEdge } from '$lib/actions/edge-to-edge'

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
  const childTitles: Record<string, string> = {
    '/app/settings/player': 'Player', '/app/settings/subtitles': 'Subtitles',
    '/app/settings/hotkeys': 'Hotkeys',
    '/app/settings/store': 'Source Store',
    '/app/settings/catalog': 'Catalog',
    // Nested routes come FIRST: the lookup below takes the first prefix that matches, so listing
    // /sources ahead of /sources/priority would title the reorder screen "Sources".
    '/app/settings/sources/priority': 'Source priority',
    '/app/settings/sources': 'Sources',
    '/app/settings/downloads': 'Downloads', '/app/settings/interface': 'Interface',
    '/app/settings/history': 'History', '/app/settings/sync': 'Device sync',
    '/app/settings/backup': 'Backup & restore',
    '/app/settings/accounts': 'Accounts', '/app/settings/network': 'Network',
    '/app/settings/changelog': 'Changelog',
    '/app/settings/about/license-information': 'License Information', '/app/settings/about': 'About',
  }
  const childTitle = $derived.by(() => {
    const p = $page.url.pathname
    const hit = Object.keys(childTitles).find((k) => p === k || p.startsWith(k + '/'))
    return hit ? childTitles[hit] : m.nav_settings()
  })

  // Back goes one level up, not straight to the index: a sub-screen like the source reorder is
  // reached FROM its category, and dropping the user two levels loses their place in that page.
  const backHref = $derived.by(() => {
    if ($page.url.pathname === '/app/settings/sources/priority') return '/app/settings/sources?tab=ordering'
    if ($page.url.pathname === '/app/settings/store') return '/app/settings/sources?tab=manage'
    const parts = $page.url.pathname.replace(/\/+$/, '').split('/')
    return parts.length > 4 ? parts.slice(0, -1).join('/') : '/app/settings'
  })

  // Search results for shared Toggle rows carry a stable key. Once the destination page has
  // rendered, bring that exact control into view and briefly tint it so the user's eye lands on
  // the setting they searched for. Retry for a few frames because mobile route transitions mount
  // the child after the URL store updates.
  $effect(() => {
    const path = $page.url.pathname
    const key = $page.url.searchParams.get('setting')
    void path
    if (!key || typeof document === 'undefined') return
    let cancelled = false
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    const find = () => {
      if (cancelled) return
      const target = document.querySelector<HTMLElement>(`[data-setting-key="${CSS.escape(key)}"]`)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        target.classList.add('settings-search-hit')
        timer = setTimeout(() => target.classList.remove('settings-search-hit'), 1800)
      } else if (++tries < 12) {
        timer = setTimeout(find, 50)
      }
    }
    timer = setTimeout(find, 0)
    return () => { cancelled = true; clearTimeout(timer) }
  })

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
        <a href={backHref} data-focusable onclick={() => h.tap()} aria-label={m.common_back_to_settings()}
           class="grid h-10 w-10 place-items-center rounded-full transition-colors active:bg-accent">
          <ChevronLeft size={22} />
        </a>
        <span class="text-lg font-black">{childTitle}</span>
        <span class="ml-auto"><SettingsSearch compact /></span>
      </div>
      {#key $page.url.pathname}
        <!-- Vertical, short, and fading: a push that reads as a platform screen change rather than
             a carousel. app.css shortens every transition under the reduced-motion gate. -->
        <div class="settings-child" in:fly={{ y: 12, duration: 160, opacity: 0 }}>{@render children()}</div>
      {/key}
    </div>
  {/if}
{:else}
  <!-- Desktop: nav rail + content side-by-side (unchanged). -->
  <div class="flex min-h-screen flex-row">
    <aside class="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-border bg-background p-4">
      <h1 class="mb-3 px-3 text-2xl font-black">{m.nav_settings()}</h1>
      <div class="mb-4 px-1"><SettingsSearch /></div>
      <div class="min-h-0 flex-1"><SettingsNav /></div>
      <div class="mt-auto space-y-0.5 px-3 pt-6 text-xs text-muted-foreground">
        {#if appVersion}<div>{m.common_client_version({ version: appVersion })}</div>{/if}
        {#if osLine}<div>{osLine}</div>{/if}
      </div>
    </aside>
    <div class="min-w-0 flex-1">{@render children()}</div>
  </div>
{/if}
