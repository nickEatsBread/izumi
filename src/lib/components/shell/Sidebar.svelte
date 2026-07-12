<script lang="ts">
  import { onMount } from 'svelte'
  import Logo from '../Logo.svelte'
  import Home from 'lucide-svelte/icons/house'
  import Calendar from 'lucide-svelte/icons/calendar'
  import Search from 'lucide-svelte/icons/search'
  import Download from 'lucide-svelte/icons/download'
  import Cloud from 'lucide-svelte/icons/cloud'
  import Settings from 'lucide-svelte/icons/settings'
  import LogIn from 'lucide-svelte/icons/log-in'
  import { page } from '$app/state'
  import { playing, gameMode } from '$lib/player/session'
  import { anilistUserName, malUserName, anilistUserAvatar, malUserAvatar } from '$lib/trackers/config'
  import { anilistUser } from '$lib/anilist/account'
  // Nav items (top). Settings + profile are pinned to the BOTTOM.
  const items = [
    { href: '/app/home', icon: Home, label: 'Home', anim: 'group-hover:animate-[bounce-sm_0.4s_ease]' },
    { href: '/app/schedule', icon: Calendar, label: 'Schedule', anim: 'group-hover:animate-[swing_0.5s_ease]' },
    { href: '/app/search', icon: Search, label: 'Search', anim: 'group-hover:animate-[wiggle_0.4s_ease]' },
    { href: '/app/downloads', icon: Download, label: 'Downloads', anim: 'group-hover:animate-[bounce-sm_0.4s_ease]' },
    { href: '/app/cloud', icon: Cloud, label: 'Cloud', anim: 'group-hover:animate-[bounce-sm_0.4s_ease]' },
  ]
  const name = $derived($anilistUserName || $malUserName || $anilistUser)
  const avatarUrl = $derived($anilistUserAvatar || $malUserAvatar)
  const initial = $derived((name || '').trim().charAt(0).toUpperCase())

  // Expand the rail to a labelled menu while it holds focus, BUT only for keyboard/gamepad
  // navigation — never a mouse. On the Deck (gameMode) any focus expands it; on desktop only
  // when the last input was the keyboard (arrow/tab), so a mouse click/hover leaves the icon
  // rail as-is. `open` drives width + labels; there's no content scrim (the rail goes opaque
  // + casts a shadow, which is enough to read the labels).
  let focused = $state(false)
  let kbd = $state(false)
  const open = $derived(focused && !$playing && ($gameMode || kbd))
  // While playing (windowed — the rail is hidden entirely in fullscreen/Game mode), the player
  // owns input: the menu icons must not be focusable/selectable by the d-pad or keyboard. Left
  // mouse-clickable so a windowed desktop user can still click away. `df`/`tab` fall to normal
  // (focusable) in browse.
  const df = $derived($playing ? undefined : '')
  const tab = $derived($playing ? -1 : undefined)
  const onFocusIn = () => (focused = true)
  const onFocusOut = (e: FocusEvent & { currentTarget: HTMLElement }) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focused = false
  }
  onMount(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key.startsWith('Arrow') || e.key === 'Tab') kbd = true }
    const onPtr = () => (kbd = false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPtr, true)
    window.addEventListener('pointermove', onPtr, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPtr, true)
      window.removeEventListener('pointermove', onPtr, true)
    }
  })
  const active = (href: string) => page.url.pathname.startsWith(href)
</script>

<!-- Browse: soft scrim so the banner shows through and fades into the page. Hidden while playing. -->
{#if !$playing}
  <div class="pointer-events-none fixed inset-y-0 left-0 z-20 w-32 bg-gradient-to-r from-background/90 via-background/30 to-transparent"></div>
{/if}

<!-- Rows are always icon + label; the rail's width (+ overflow-hidden) reveals the labels when
     expanded, so no per-state markup swap. `main` keeps its 56px margin — the expanded rail
     overlays the content (fixed) rather than reflowing it. Selection: the CURRENT page gets a
     left accent bar + brighter text (no heavy filled box); keyboard/gamepad FOCUS fills the row
     (see app.css) — no squared ring. -->
<nav data-nav-sidebar onfocusin={onFocusIn} onfocusout={onFocusOut}
     class="fixed inset-y-0 left-0 z-30 flex flex-col gap-1 overflow-hidden py-3 pt-9 transition-[width] duration-200 ease-out
       {open ? 'w-[200px]' : 'w-14'} {$playing || open ? 'bg-background' : ''} {open ? 'shadow-2xl' : $playing ? '' : 'drop-shadow-md'}">
  <a href="/app/home" class="group mb-2 flex h-10 shrink-0 items-center gap-3 pl-3" data-focusable={df} tabindex={tab}>
    <span class="grid w-8 shrink-0 place-items-center transition-transform duration-200 group-hover:scale-110"><Logo /></span>
    <span class="whitespace-nowrap text-lg font-black transition-opacity duration-150 {open ? 'opacity-100' : 'opacity-0'}">izumi</span>
  </a>

  {#each items as it (it.href)}
    {@const on = active(it.href)}
    <a href={it.href} title={it.label} data-focusable={df} tabindex={tab}
       class="group relative flex h-11 shrink-0 items-center gap-3 rounded-md pl-3 transition-colors hover:bg-accent hover:text-foreground
         {on ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground'}">
      {#if on}<span class="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-theme"></span>{/if}
      <span class="grid w-8 shrink-0 place-items-center"><it.icon size={20} class={it.anim} /></span>
      <span class="whitespace-nowrap text-sm font-semibold transition-opacity duration-150 {open ? 'opacity-100' : 'opacity-0'}">{it.label}</span>
    </a>
  {/each}

  <!-- Spacer pushes Settings + profile to the bottom. -->
  <div class="flex-1"></div>

  <a href="/app/settings" title="Settings" data-focusable={df} tabindex={tab}
     class="group relative flex h-11 shrink-0 items-center gap-3 rounded-md pl-3 transition-colors hover:bg-accent hover:text-foreground
       {active('/app/settings') ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground'}">
    {#if active('/app/settings')}<span class="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-theme"></span>{/if}
    <span class="grid w-8 shrink-0 place-items-center"><Settings size={20} class="group-hover:animate-[spin_0.6s_ease]" /></span>
    <span class="whitespace-nowrap text-sm font-semibold transition-opacity duration-150 {open ? 'opacity-100' : 'opacity-0'}">Settings</span>
  </a>

  <a href="/app/settings/accounts" title={name ? name : 'Sign in'} data-focusable={df} tabindex={tab}
     class="group mt-1 flex h-12 shrink-0 items-center gap-3 rounded-md pl-3 text-muted-foreground transition-colors hover:text-foreground">
    <span class="grid w-8 shrink-0 place-items-center">
      {#if name}
        {#if avatarUrl}
          <img src={avatarUrl} alt={name} referrerpolicy="no-referrer"
               class="h-8 w-8 rounded-full object-cover ring-2 ring-transparent transition group-hover:ring-theme/40" />
        {:else}
          <span class="grid h-8 w-8 place-items-center rounded-full bg-theme text-sm font-black text-white ring-2 ring-transparent transition group-hover:ring-theme/40">{initial}</span>
        {/if}
      {:else}
        <span class="grid h-8 w-8 place-items-center rounded-full bg-secondary transition group-hover:bg-accent"><LogIn size={16} /></span>
      {/if}
    </span>
    <span class="max-w-[140px] truncate whitespace-nowrap text-sm font-semibold transition-opacity duration-150 {open ? 'opacity-100' : 'opacity-0'}">{name || 'Sign in'}</span>
  </a>
</nav>
