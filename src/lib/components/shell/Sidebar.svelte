<script lang="ts">
  import Logo from '../Logo.svelte'
  import Home from 'lucide-svelte/icons/house'
  import Calendar from 'lucide-svelte/icons/calendar'
  import Search from 'lucide-svelte/icons/search'
  import Download from 'lucide-svelte/icons/download'
  import Settings from 'lucide-svelte/icons/settings'
  import LogIn from 'lucide-svelte/icons/log-in'
  import { page } from '$app/state'
  import { playing } from '$lib/player/session'
  import { anilistUserName, malUserName, anilistUserAvatar, malUserAvatar } from '$lib/trackers/config'
  import { anilistUser } from '$lib/anilist/account'
  // Nav items (top). Settings + profile are pinned to the BOTTOM.
  const items = [
    { href: '/app/home', icon: Home, label: 'Home', anim: 'group-hover:animate-[bounce-sm_0.4s_ease]' },
    { href: '/app/schedule', icon: Calendar, label: 'Schedule', anim: 'group-hover:animate-[swing_0.5s_ease]' },
    { href: '/app/search', icon: Search, label: 'Search', anim: 'group-hover:animate-[wiggle_0.4s_ease]' },
    { href: '/app/downloads', icon: Download, label: 'Downloads', anim: 'group-hover:animate-[bounce-sm_0.4s_ease]' },
  ]
  // Logged in via AniList/MAL (OAuth name, manual username, or MAL). Show the real
  // profile picture from the connected account; fall back to the name initial only
  // when no avatar is available. Links to the accounts settings.
  const name = $derived($anilistUserName || $malUserName || $anilistUser)
  const avatarUrl = $derived($anilistUserAvatar || $malUserAvatar)
  const initial = $derived((name || '').trim().charAt(0).toUpperCase())
</script>
<!-- Browse: soft scrim so the banner shows through and fades into the page (blends
     with no hard rail). Hidden while playing (the rail is solid then). -->
{#if !$playing}
  <div class="pointer-events-none fixed inset-y-0 left-0 z-20 w-32 bg-gradient-to-r from-background/90 via-background/30 to-transparent"></div>
{/if}
<!-- Playing: a solid opaque rail so the video sits to its right and never shows
     through the sidebar. -->
<nav data-nav-sidebar class="fixed inset-y-0 left-0 z-30 flex w-14 flex-col items-center gap-2 py-3 pt-9 {$playing ? 'bg-background' : 'drop-shadow-md'}">
  <a href="/app/home" class="group mb-3" data-focusable>
    <div class="transition-transform duration-200 group-hover:scale-110"><Logo /></div>
  </a>
  {#each items as it (it.href)}
    <a href={it.href} title={it.label} data-focusable
       class="group grid h-10 w-10 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground {page.url.pathname.startsWith(it.href) ? 'bg-accent text-foreground' : ''}">
      <it.icon size={20} class={it.anim} />
    </a>
  {/each}

  <!-- Spacer pushes Settings + profile to the bottom. -->
  <div class="flex-1"></div>

  <a href="/app/settings" title="Settings" data-focusable
     class="group grid h-10 w-10 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground {page.url.pathname.startsWith('/app/settings') ? 'bg-accent text-foreground' : ''}">
    <Settings size={20} class="group-hover:animate-[spin_0.6s_ease]" />
  </a>

  <a href="/app/settings/accounts" title={name ? name : 'Sign in'} data-focusable
     class="group mt-1 grid h-10 w-10 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground">
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
  </a>
</nav>
