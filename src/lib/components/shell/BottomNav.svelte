<script lang="ts">
  // Mobile bottom tab bar (replaces the fixed left sidebar rail on narrow/Android). Same
  // destinations, flattened to the 5 that fit a phone bar; Settings absorbs the profile link.
  import Home from 'lucide-svelte/icons/house'
  import Search from 'lucide-svelte/icons/search'
  import Download from 'lucide-svelte/icons/download'
  import Cloud from 'lucide-svelte/icons/cloud'
  import Settings from 'lucide-svelte/icons/settings'
  import { page } from '$app/state'

  const items = [
    { href: '/app/home', icon: Home, label: 'Home' },
    { href: '/app/search', icon: Search, label: 'Search' },
    { href: '/app/downloads', icon: Download, label: 'Downloads' },
    { href: '/app/cloud', icon: Cloud, label: 'Cloud' },
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
      class="flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.62rem] font-bold transition-colors
        {active(it.href) ? 'text-theme' : 'text-muted-foreground'}"
    >
      <Icon size={20} />
      {it.label}
    </a>
  {/each}
</nav>
