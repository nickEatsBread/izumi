<script lang="ts">
  // Mobile bottom tab bar. Home is a fixed anchor (always first); the remaining tabs come from the
  // user's nav config (Settings → Navigation). Items placed 'top' or 'hidden' don't appear here.
  import { page } from '$app/state'
  import * as h from '$lib/haptics'
  import { effectiveNav, NAV_META, HOME_META } from '$lib/settings/nav'

  const bottom = $derived($effectiveNav.filter((c) => c.placement === 'bottom'))
  const active = (href: string) => page.url.pathname.startsWith(href)
  const HomeIcon = HOME_META.icon
</script>

<nav
  data-nav-sidebar
  class="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
>
  <a
    href={HOME_META.href}
    data-focusable
    onclick={() => h.tap()}
    class="flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.62rem] font-bold transition-colors
      {active(HOME_META.href) ? 'text-theme' : 'text-muted-foreground'}"
  >
    <HomeIcon size={20} />
    Home
  </a>
  {#each bottom as c (c.id)}
    {@const meta = NAV_META[c.id]}
    {@const Icon = meta.icon}
    <a
      href={meta.href}
      data-focusable
      onclick={() => h.tap()}
      class="flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.62rem] font-bold transition-colors
        {active(meta.href) ? 'text-theme' : 'text-muted-foreground'}"
    >
      <Icon size={20} />
      {meta.label}
    </a>
  {/each}
</nav>
