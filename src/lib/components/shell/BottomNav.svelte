<script lang="ts">
  // Mobile bottom tab bar. Home is a fixed anchor (always first); the remaining tabs come from the
  // user's nav config (Settings → Navigation). Items placed 'top' or 'hidden' don't appear here.
  // A theme's `shell.bottomNav` restyles the bar (flush, floating card or centred pill), its
  // labels, active indicator, colours and size; destinations stay the user's.
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import * as h from '$lib/haptics'
  import { effectiveNav, NAV_META, HOME_META } from '$lib/settings/nav'
  import { m } from '$lib/paraglide/messages.js'
  import { themePresentation } from '$lib/themes/runtime'
  import { themeColorCss } from '$lib/themes/presentation'
  import CompanionLinkIndicator from './CompanionLinkIndicator.svelte'

  const labels = {
    schedule: m.nav_schedule, downloads: m.nav_downloads, watch: m.nav_watch_together,
    settings: m.nav_settings, search: m.nav_search,
    trakt: () => 'Trakt',
    letterboxd: () => 'Letterboxd',
    library: () => 'Library',
  }

  const bottom = $derived($effectiveNav.filter((c) => c.placement === 'bottom'))
  const active = (href: string) => page.url.pathname.startsWith(href)
  const HomeIcon = HOME_META.icon

  const nav = $derived($themePresentation?.shell?.bottomNav ?? {})
  const style = $derived(nav.style ?? 'bar')
  const labelMode = $derived(nav.labels ?? 'always')
  const indicator = $derived(nav.indicator ?? 'none')
  const height = $derived(nav.height ?? 56)
  const iconSize = $derived(nav.iconSize ?? 20)
  const activeColor = $derived(themeColorCss(nav.activeColor))
  const inactiveColor = $derived(themeColorCss(nav.inactiveColor))
  const background = $derived(themeColorCss(nav.background))
  const indicatorTint = $derived(themeColorCss(nav.activeColor ?? 'theme', 0.18))
  const blur = $derived(nav.blur ?? true)
  const border = $derived(nav.border ?? style === 'bar')
  const radius = $derived(nav.radius ?? (style === 'pill' ? 999 : 24))
  const items = $derived([{ id: 'home', href: HOME_META.href, icon: HomeIcon, label: m.nav_home }, ...bottom.map((c) => ({ id: c.id, href: NAV_META[c.id].href, icon: NAV_META[c.id].icon, label: labels[c.id] }))])

  // Auto-hide on scroll: glide the bar down when scrolling down (more content on screen), slide it
  // back up on any upward scroll or near the top. Matches the native "immersive nav" pattern.
  let hidden = $state(false)
  let lastY = 0
  onMount(() => {
    lastY = window.scrollY
    const onScroll = () => {
      if (nav.hide === 'never') { hidden = false; return }
      const y = window.scrollY
      if (y > lastY + 6 && y > 64) hidden = true
      else if (y < lastY - 6 || y < 64) hidden = false
      lastY = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  })
</script>

<nav
  data-nav-sidebar
  data-theme-surface="shell"
  data-theme-bottom-nav={style}
  class="fixed z-30 flex items-stretch transition-transform duration-300 ease-out
    {style === 'bar' ? 'inset-x-0 bottom-0 justify-around pb-[env(safe-area-inset-bottom)]' : ''}
    {style === 'floating' ? 'inset-x-3 justify-around shadow-2xl' : ''}
    {style === 'pill' ? 'left-1/2 -translate-x-1/2 gap-1 px-2 shadow-2xl' : ''}
    {border ? (style === 'bar' ? 'border-t border-border' : 'border border-border/70') : ''}
    {background ? '' : style === 'bar' ? 'bg-background/95' : 'bg-card/95'}
    {blur ? 'backdrop-blur' : ''}
    {hidden ? (style === 'bar' ? 'translate-y-full' : style === 'pill' ? 'translate-y-[150%] -translate-x-1/2' : 'translate-y-[150%]') : (style === 'pill' ? 'translate-y-0 -translate-x-1/2' : 'translate-y-0')}"
  style:background={background}
  style:border-radius={style === 'bar' ? undefined : `${radius}px`}
  style:bottom={style === 'bar' ? undefined : `calc(${style === 'pill' ? 16 : 12}px + env(safe-area-inset-bottom))`}
>
  <div class="absolute -top-10 right-3"><CompanionLinkIndicator floating /></div>
  {#each items as item (item.id)}
    {@const on = active(item.href)}
    {@const Icon = item.icon}
    <a
      href={item.href}
      data-focusable
      aria-current={on ? 'page' : undefined}
      onclick={() => h.tap()}
      class="relative flex flex-col items-center justify-center gap-0.5 text-[0.62rem] font-bold transition-colors
        {style === 'pill' ? 'px-4' : 'flex-1'}
        {on ? (activeColor ? '' : 'text-theme') : (inactiveColor ? '' : 'text-muted-foreground')}"
      style:height={`${height}px`}
      style:color={on ? activeColor : inactiveColor}
    >
      {#if indicator === 'line' && on}
        <span class="absolute inset-x-3 top-0 h-0.5 rounded-full" style:background={activeColor ?? 'hsl(var(--theme))'}></span>
      {/if}
      <span class="relative grid place-items-center rounded-full px-4 py-1">
        {#if indicator === 'pill' && on}
          <span class="absolute inset-0 rounded-full" style:background={indicatorTint}></span>
        {/if}
        <Icon size={iconSize} class="relative" />
      </span>
      {#if labelMode === 'always' || (labelMode === 'active' && on)}
        <span>{item.label()}</span>
      {/if}
      {#if indicator === 'dot' && on}
        <span class="size-1 rounded-full" style:background={activeColor ?? 'hsl(var(--theme))'}></span>
      {/if}
    </a>
  {/each}
</nav>
