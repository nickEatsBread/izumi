<script lang="ts">
  import CatalogBrandLogo from '../catalog/CatalogBrandLogo.svelte'
  import CatalogSwitcher from '../catalog/CatalogSwitcher.svelte'
  import Home from '@lucide/svelte/icons/house'
  import Calendar from '@lucide/svelte/icons/calendar'
  import Search from '@lucide/svelte/icons/search'
  import Download from '@lucide/svelte/icons/download'
  import Users from '@lucide/svelte/icons/users'
  import Settings from '@lucide/svelte/icons/settings'
  import VenetianMask from '@lucide/svelte/icons/venetian-mask'
  import LibraryBig from '@lucide/svelte/icons/library-big'
  import LogIn from '@lucide/svelte/icons/log-in'
  import { goto } from '$app/navigation'
  import { anilistUserName, malUserName, anilistUserAvatar, malUserAvatar, malUser } from '$lib/trackers/config'
  import { anilistUser } from '$lib/anilist/account'
  import { traktUserName, traktUserAvatar } from '$lib/trakt/config'
  import { page } from '$app/state'
  import { playing } from '$lib/player/session'
  import { inputType } from '$lib/nav'
  import { activeProfile, profileSwitcherOpen, profilesEnabled } from '$lib/profiles/store'
  import { profileAvatarUrl } from '$lib/profiles/avatars'
  import { incognito, toggleIncognito } from '$lib/stores/incognito'
  import { offlineMode } from '$lib/stores/offline'
  import { catalogScreen, catalogSwitcherPlacement, enabledCatalogScreens, resolveCatalogSwitcherPlacement } from '$lib/settings/catalog'
  import * as h from '$lib/haptics'
  import { m } from '$lib/paraglide/messages.js'
  import { themePresentation } from '$lib/themes/runtime'

  let { placement = 'sidebar' }: { placement?: 'sidebar' | 'top' } = $props()
  const compact = $derived($themePresentation?.shell?.compact === true)
  const top = $derived(placement === 'top')
  // Nav items (top). Settings + profile are pinned to the BOTTOM.
  const items = [
    { href: '/app/home', icon: Home, label: m.nav_home(), anim: 'group-hover:animate-[bounce-sm_0.4s_ease]' },
    { href: '/app/schedule', icon: Calendar, label: m.nav_schedule(), anim: 'group-hover:animate-[swing_0.5s_ease]' },
    { href: '/app/search', icon: Search, label: m.nav_search(), anim: 'group-hover:animate-[wiggle_0.4s_ease]' },
    { href: '/app/downloads', icon: Download, label: m.nav_downloads(), anim: 'group-hover:animate-[bounce-sm_0.4s_ease]' },
    { href: '/app/watch', icon: Users, label: m.nav_watch_together(), anim: 'group-hover:animate-[wiggle_0.4s_ease]' },
    { href: '/app/library', icon: LibraryBig, label: 'Library', anim: '' },
  ]
  const accountName = $derived($anilistUserName || $malUserName || $traktUserName || $anilistUser || $malUser)
  const accountAvatar = $derived($anilistUserAvatar || $malUserAvatar || $traktUserAvatar)
  const accountLabel = $derived($profilesEnabled ? $activeProfile.name : accountName || 'Sign in')
  // Expand the rail to a labelled menu while it holds focus, BUT only for keyboard/gamepad
  // navigation — never a mouse. On the Deck (gameMode) any focus expands it; on desktop only
  // when the last input was the keyboard (arrow/tab), so a mouse click/hover leaves the icon
  // rail as-is. `open` drives width + labels; there's no content scrim (the rail goes opaque
  // + casts a shadow, which is enough to read the labels).
  let focused = $state(false)
  let catalogPickerOpen = $state(false)
  // Expand only when focus arrived via the d-pad / arrow keys (inputType 'dpad') — never a touch
  // tap or a mouse (which would flash the rail open then closed as it navigates; a tap should
  // just switch pages). `inputType` is the app-wide modality store (set to 'dpad' on arrow keys
  // and by the gamepad translator, 'touch'/'mouse' on pointerdown). Off during playback.
  const open = $derived(focused && !$playing && $inputType === 'dpad')
  // While playing (windowed — the rail is hidden entirely in fullscreen/Game mode), the player
  // owns input: the menu icons must not be focusable/selectable by the d-pad or keyboard. Left
  // mouse-clickable so a windowed desktop user can still click away. `df`/`tab` fall to normal
  // (focusable) in browse.
  const df = $derived($playing ? undefined : '')
  const tab = $derived($playing ? -1 : undefined)
  // Top chrome is icon-only: leftover label width from the rail anatomy stretches hover
  // highlights into huge pills and shoves destinations across the titlebar.
  const destClass = (on: boolean) => top
    ? `group relative grid size-10 shrink-0 place-items-center rounded-lg transition-colors hover:bg-accent hover:text-foreground ${on ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground'}`
    : `group relative flex h-11 shrink-0 items-center gap-3 rounded-md pl-3 transition-colors hover:bg-accent hover:text-foreground ${on ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground'}`
  const onFocusIn = () => (focused = true)
  const onFocusOut = (e: FocusEvent & { currentTarget: HTMLElement }) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focused = false
  }
  // Collapse on navigation. Selecting a nav item keeps DOM focus on it (client-side route change
  // doesn't blur), so without this the freshly-loaded page briefly shows the EXPANDED rail + its
  // shadow over the hero, then it collapses when focus later moves — a visible shadow "twitch".
  $effect(() => {
    void page.url.pathname
    focused = false
    catalogPickerOpen = false
  })
  // No active-item highlight while a video plays — the rail is inert then (you're in the player,
  // not browsing), so highlighting the page you launched from (e.g. Home) reads as "selected".
  const active = (href: string) => !$playing && (page.url.pathname.startsWith(href) || href === '/app/library' && ['/app/trakt', '/app/letterboxd'].includes(page.url.pathname))
  // This component only mounts in the desktop shell. Automatic therefore makes the brand itself
  // the catalog trigger, while an explicit Below choice still gets its own rail row.
  const switcherPlacement = $derived(resolveCatalogSwitcherPlacement($catalogSwitcherPlacement, false))
</script>

<!-- Browse: soft scrim so the banner shows through and fades into the page. Hidden while playing. -->
{#if !$playing && !top}
  <div class="theme-sidebar-scrim pointer-events-none fixed inset-y-0 left-0 z-20 w-32 bg-gradient-to-r from-background/90 via-background/30 to-transparent"></div>
{/if}

<!-- Rows are always icon + label; the rail's width (+ overflow-hidden) reveals the labels when
     expanded, so no per-state markup swap. `main` keeps its 56px margin — the expanded rail
     overlays the content (fixed) rather than reflowing it. Selection uses a quiet active-row fill;
     keyboard/gamepad FOCUS fills the row more strongly (see app.css) — no squared ring. -->
<nav data-nav-sidebar data-theme-surface="shell" onfocusin={onFocusIn} onfocusout={onFocusOut}
     class="fixed z-30 flex gap-1 transition-[width] duration-200 ease-out
       {top ? 'inset-x-0 top-0 h-[4.75rem] w-full flex-row items-center border-b border-border/50 bg-background px-3 pt-8' : 'inset-y-0 left-0 flex-col py-3 pt-9'}
       {catalogPickerOpen ? 'overflow-visible' : 'overflow-hidden'}
       {top ? '' : open ? 'w-[200px]' : compact ? 'w-12' : 'w-14'}
       {$playing || open ? 'bg-background' : ''} {open ? 'shadow-2xl' : $playing || top ? '' : 'drop-shadow-md'}">
  <!-- On Home, Integrated mode turns the brand into the catalog trigger. Everywhere else it stays
       predictable Home navigation; Below mode keeps the explicit provider row underneath. -->
  <div class="group flex h-10 shrink-0 items-center gap-2 text-left {top ? '' : 'mb-2'}">
    {#if switcherPlacement === 'integrated' && active('/app/home') && !$offlineMode && $enabledCatalogScreens.length > 1}
      <CatalogSwitcher display="brand" bind:open={catalogPickerOpen} className="ml-2 shrink-0" />
    {:else}
      <a href="/app/home" onclick={() => h.tap()} aria-label={m.nav_home()} title={m.nav_home()} tabindex={-1}
         class="ml-2 grid size-10 shrink-0 place-items-center transition-transform duration-200 group-hover:scale-110">
        <CatalogBrandLogo platform={$catalogScreen} />
      </a>
    {/if}
    {#if !top}
      <span class="whitespace-nowrap text-lg font-black transition-opacity duration-150 {open ? 'opacity-100' : 'opacity-0'}">izumi</span>
    {/if}
  </div>

  {#if !$offlineMode && switcherPlacement === 'below'}
    <CatalogSwitcher display="rail" bind:open={catalogPickerOpen} expanded={open} className="shrink-0" />
  {/if}

  {#each items as it (it.href)}
    {@const on = active(it.href)}
    <a href={it.href} title={it.label} data-focusable={df} tabindex={tab} aria-current={on ? 'page' : undefined}
       class={destClass(on)}>
      <span class="grid {top ? 'size-5' : 'w-8'} shrink-0 place-items-center"><it.icon size={20} class={it.anim} /></span>
      {#if top}
        <span class="sr-only">{it.label}</span>
      {:else}
        <span class="whitespace-nowrap text-sm font-semibold transition-opacity duration-150 {open ? 'opacity-100' : 'opacity-0'}">{it.label}</span>
      {/if}
    </a>
  {/each}

  <!-- Spacer pushes Settings + profile to the bottom of the rail, or the trailing cluster to the
       right of a top bar. -->
  <div class="flex-1"></div>

  <!-- Incognito toggle: same row anatomy as the links; violet accent + tinted icon while active
       (the top banner is the loud indicator — this stays quiet). -->
  <button onclick={toggleIncognito} title={m.nav_incognito()} data-focusable={df} tabindex={tab}
     aria-pressed={$incognito}
     class="{destClass($incognito)} {top ? '' : 'text-left'}">
    {#if $incognito && !top}<span class="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-violet-500"></span>{/if}
    <span class="grid {top ? 'size-5' : 'w-8'} shrink-0 place-items-center"><VenetianMask size={20} class="group-hover:animate-[wiggle_0.4s_ease] {$incognito ? 'text-violet-400' : ''}" /></span>
    {#if top}
      <span class="sr-only">{m.nav_incognito()}</span>
    {:else}
      <span class="whitespace-nowrap text-sm font-semibold transition-opacity duration-150 {open ? 'opacity-100' : 'opacity-0'}">{m.nav_incognito()}</span>
    {/if}
  </button>

  <a href="/app/settings" title={m.nav_settings()} data-focusable={df} tabindex={tab}
     aria-current={active('/app/settings') ? 'page' : undefined}
     class={destClass(active('/app/settings'))}>
    <span class="grid {top ? 'size-5' : 'w-8'} shrink-0 place-items-center"><Settings size={20} class="group-hover:animate-[spin_0.6s_ease]" /></span>
    {#if top}
      <span class="sr-only">{m.nav_settings()}</span>
    {:else}
      <span class="whitespace-nowrap text-sm font-semibold transition-opacity duration-150 {open ? 'opacity-100' : 'opacity-0'}">{m.nav_settings()}</span>
    {/if}
  </a>

  <button type="button" onclick={() => $profilesEnabled ? ($profileSwitcherOpen = true) : goto('/app/settings/accounts')} title={$profilesEnabled ? `Switch profile · ${$activeProfile.name}` : accountLabel} data-focusable={df} tabindex={tab}
     class="{top ? destClass(false) : 'group mt-1 flex h-12 w-full shrink-0 items-center gap-3 rounded-md pl-3 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'}">
    <span class="grid {top ? 'size-8' : 'w-8'} shrink-0 place-items-center">
      {#if $profilesEnabled}
        <img src={profileAvatarUrl($activeProfile.avatar, $activeProfile.color)} alt="" class="size-8 rounded-lg" />
      {:else if accountAvatar}
        <img src={accountAvatar} alt="" class="size-8 rounded-full object-cover" />
      {:else}<LogIn size={20} />{/if}
    </span>
    {#if top}
      <span class="sr-only">{accountLabel}</span>
    {:else}
      <span class="max-w-[140px] truncate whitespace-nowrap text-sm font-semibold transition-opacity duration-150 {open ? 'opacity-100' : 'opacity-0'}">{accountLabel}</span>
    {/if}
  </button>
</nav>
