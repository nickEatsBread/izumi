<script lang="ts">
  import Logo from '../Logo.svelte'
  import Home from 'lucide-svelte/icons/house'
  import Calendar from 'lucide-svelte/icons/calendar'
  import Search from 'lucide-svelte/icons/search'
  import Settings from 'lucide-svelte/icons/settings'
  import { page } from '$app/state'
  // Each item gets a distinct micro-animation that plays on hover (izumi-style).
  const items = [
    { href: '/app/home', icon: Home, label: 'Home', anim: 'group-hover:animate-[bounce-sm_0.4s_ease]' },
    { href: '/app/schedule', icon: Calendar, label: 'Schedule', anim: 'group-hover:animate-[swing_0.5s_ease]' },
    { href: '/app/search', icon: Search, label: 'Search', anim: 'group-hover:animate-[wiggle_0.4s_ease]' },
    { href: '/app/settings', icon: Settings, label: 'Settings', anim: 'group-hover:animate-[spin_0.6s_ease]' },
  ]
</script>
<nav class="fixed inset-y-0 left-0 z-30 flex w-14 flex-col items-center gap-2 bg-transparent py-3 pt-9 backdrop-blur">
  <a href="/app/home" class="group mb-3" data-focusable>
    <div class="transition-transform duration-200 group-hover:scale-110"><Logo /></div>
  </a>
  {#each items as it}
    <a href={it.href} title={it.label} data-focusable
       class="group grid h-10 w-10 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground {page.url.pathname.startsWith(it.href) ? 'bg-accent text-foreground' : ''}">
      <it.icon size={20} class={it.anim} />
    </a>
  {/each}
</nav>
