<script lang="ts">
  import Logo from '../Logo.svelte'
  import Home from 'lucide-svelte/icons/house'
  import Calendar from 'lucide-svelte/icons/calendar'
  import Search from 'lucide-svelte/icons/search'
  import Settings from 'lucide-svelte/icons/settings'
  import { page } from '$app/state'
  const items = [
    { href: '/app/home', icon: Home, label: 'Home' },
    { href: '/app/schedule', icon: Calendar, label: 'Schedule' },
    { href: '/app/search', icon: Search, label: 'Search' },
    { href: '/app/settings', icon: Settings, label: 'Settings' },
  ]
</script>
<nav class="fixed inset-y-0 left-0 z-30 flex w-14 flex-col items-center gap-2 bg-background/80 py-3 backdrop-blur">
  <a href="/app/home" class="mb-3" data-focusable><Logo /></a>
  {#each items as it}
    <a href={it.href} title={it.label} data-focusable
       class="grid h-10 w-10 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground {page.url.pathname.startsWith(it.href) ? 'bg-accent text-foreground' : ''}">
      <it.icon size={20} />
    </a>
  {/each}
</nav>
