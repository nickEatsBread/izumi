<script lang="ts">
  // Mobile bottom tab bar (replaces the fixed left sidebar rail on narrow/Android). Four
  // destinations; Search lives as a top-right icon on the browse header, Settings absorbs profile.
  import Home from 'lucide-svelte/icons/house'
  import Calendar from 'lucide-svelte/icons/calendar'
  import Download from 'lucide-svelte/icons/download'
  import Settings from 'lucide-svelte/icons/settings'
  import { page } from '$app/state'
  import * as h from '$lib/haptics'

  // Schedule takes Cloud's tab slot (Cloud is reachable from the Downloads header instead — both
  // are "your library"). Keeps the bar at 5 so it doesn't crowd on a phone.
  // Four tabs (Search moved to a top-right icon on the browse header, so the bar stays compact and
  // in line with native anime apps). Home · Schedule · Downloads · Settings.
  const items = [
    { href: '/app/home', icon: Home, label: 'Home' },
    { href: '/app/schedule', icon: Calendar, label: 'Schedule' },
    { href: '/app/downloads', icon: Download, label: 'Downloads' },
    { href: '/app/settings', icon: Settings, label: 'Settings' },
  ]
  const active = (href: string) => page.url.pathname.startsWith(href)
</script>

<nav
  data-nav-sidebar
  class="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
>
  {#each items as it (it.href)}
    {@const Icon = it.icon}
    <a
      href={it.href}
      data-focusable
      onclick={() => h.tap()}
      class="flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.62rem] font-bold transition-colors
        {active(it.href) ? 'text-theme' : 'text-muted-foreground'}"
    >
      <Icon size={20} />
      {it.label}
    </a>
  {/each}
</nav>
