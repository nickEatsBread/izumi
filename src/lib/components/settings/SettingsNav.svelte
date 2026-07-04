<script lang="ts">
  import { page } from '$app/stores'
  import Play from 'lucide-svelte/icons/play'
  import LayoutGrid from 'lucide-svelte/icons/layout-grid'
  import Rss from 'lucide-svelte/icons/rss'
  import Puzzle from 'lucide-svelte/icons/puzzle'
  import User from 'lucide-svelte/icons/user'
  import Globe from 'lucide-svelte/icons/globe'
  import Download from 'lucide-svelte/icons/download'
  import Info from 'lucide-svelte/icons/info'

  const items = [
    { title: 'Player', href: '/app/settings', icon: Play },
    { title: 'Interface', href: '/app/settings/interface', icon: LayoutGrid },
    { title: 'Sources', href: '/app/settings/sources', icon: Rss },
    { title: 'Extensions', href: '/app/settings/extensions', icon: Puzzle },
    { title: 'Downloads', href: '/app/settings/downloads', icon: Download },
    { title: 'Accounts', href: '/app/settings/accounts', icon: User },
    { title: 'Network', href: '/app/settings/network', icon: Globe },
    { title: 'About', href: '/app/settings/about', icon: Info },
  ]
  const active = (href: string) =>
    href === '/app/settings' ? $page.url.pathname === href : $page.url.pathname.startsWith(href)
</script>

<nav class="flex flex-col gap-1">
  {#each items as it (it.href)}
    {@const Icon = it.icon}
    <a
      href={it.href}
      data-focusable
      class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-bold transition-colors
        {active(it.href) ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'}"
    >
      <Icon size={18} /> {it.title}
    </a>
  {/each}
</nav>
