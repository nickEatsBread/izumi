<script lang="ts">
  import { page } from '$app/stores'
  import { isAndroid, isMobile } from '$lib/platform'
  import * as h from '$lib/haptics'
  import { ripple } from '$lib/actions/ripple'
  import Play from '@lucide/svelte/icons/play'
  import LayoutGrid from '@lucide/svelte/icons/layout-grid'
  import Rss from '@lucide/svelte/icons/rss'
  import User from '@lucide/svelte/icons/user'
  import Globe from '@lucide/svelte/icons/globe'
  import Download from '@lucide/svelte/icons/download'
  import Captions from '@lucide/svelte/icons/captions'
  import Info from '@lucide/svelte/icons/info'
  import ScrollText from '@lucide/svelte/icons/scroll-text'
  import History from '@lucide/svelte/icons/rotate-ccw-clock'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import PanelBottom from '@lucide/svelte/icons/panel-bottom'
  import Keyboard from '@lucide/svelte/icons/keyboard'
  import DatabaseBackup from '@lucide/svelte/icons/database-backup'
  import HardDrive from '@lucide/svelte/icons/hard-drive'
  import Library from '@lucide/svelte/icons/library'
  import Bookmark from '@lucide/svelte/icons/bookmark'

  // Grouped for the mobile list index (desktop rail renders them flat, in order).
  const groups = [
    { label: 'Playback', items: [
      { title: 'Player', href: '/app/settings/player', icon: Play, subtitle: 'Playback, languages, external player' },
      { title: 'Subtitles', href: '/app/settings/subtitles', icon: Captions, subtitle: 'Style, sources, sync' },
      { title: 'Hotkeys', href: '/app/settings/hotkeys', icon: Keyboard, subtitle: 'Keyboard shortcuts' },
    ] },
    { label: 'Content', items: [
      { title: 'Catalog', href: '/app/settings/catalog', icon: Library, subtitle: 'AniList, Kitsu, TMDB or Stremio metadata' },
      { title: 'Sources', href: '/app/settings/sources', icon: Rss, subtitle: 'Add, configure and prioritise sources' },
      { title: 'Downloads', href: '/app/settings/downloads', icon: Download, subtitle: 'Offline library and storage' },
      { title: 'Storage', href: '/app/settings/storage', icon: HardDrive, subtitle: 'Disk caches and space used' },
    ] },
    { label: 'App', items: [
      { title: 'Interface', href: '/app/settings/interface', icon: LayoutGrid, subtitle: 'Appearance and layout' },
      { title: 'Navigation', href: '/app/settings/navigation', icon: PanelBottom, subtitle: 'Bottom bar and shortcuts' },
      { title: 'History', href: '/app/settings/history', icon: History, subtitle: 'Watch history and progress' },
      { title: 'Scene bookmarks', href: '/app/settings/scenes', icon: Bookmark, subtitle: 'Saved moments, quotes and notes' },
      { title: 'Device sync', href: '/app/settings/sync', icon: RefreshCw, subtitle: 'Sync between your devices' },
      { title: 'Backup & restore', href: '/app/settings/backup', icon: DatabaseBackup, subtitle: 'Export and import your data' },
      { title: 'Accounts', href: '/app/settings/accounts', icon: User, subtitle: 'Trackers, Trakt and MDBList' },
      { title: 'Network', href: '/app/settings/network', icon: Globe, subtitle: 'Proxy, DNS and connectivity' },
    ] },
    { label: 'About', items: [
      { title: 'Changelog', href: '/app/settings/changelog', icon: ScrollText, subtitle: 'What changed in this release' },
      { title: 'About', href: '/app/settings/about', icon: Info, subtitle: 'Version and licences' },
    ] },
  ]
  // Hotkeys rebinds physical keyboard shortcuts for the desktop player. Android is a touch device
  // with no keyboard scope to bind into, so the whole category is dropped there — note this keys on
  // $isAndroid, NOT $isMobile: a narrow desktop window still has a keyboard.
  const visibleGroups = $derived(
    $isAndroid
      ? groups
          .map((g) => ({ ...g, items: g.items.filter((it) => it.href !== '/app/settings/hotkeys') }))
          .filter((g) => g.items.length)
      : groups,
  )
  // Navigation configures the mobile shell (bottom tab bar + top icons), so it's mobile-only — the
  // desktop app uses the fixed sidebar instead. Keep it out of the desktop rail (mobile renders
  // `visibleGroups` directly, and that whole branch is already gated on $isMobile).
  const flat = $derived(visibleGroups.flatMap((g) => g.items).filter((it) => it.href !== '/app/settings/navigation')) // desktop rail order
  const active = (href: string) =>
    $page.url.pathname === href ||
    $page.url.pathname.startsWith(href + '/') ||
    (href === '/app/settings/sources' && $page.url.pathname === '/app/settings/store') ||
    // The bare /app/settings landing renders the Player pane (desktop passthrough), so highlight
    // Player there too — otherwise the default Settings screen has no active rail item.
    (href === '/app/settings/player' && $page.url.pathname === '/app/settings')
</script>

{#if $isMobile}
  <!-- Mobile: a vertical grouped list of chevron rows. Tapping a row navigates to its route; the
       layout shows a back-header on the child page. Vertical scroll only — no horizontal strip. -->
  <div class="space-y-4">
    {#each visibleGroups as g (g.label)}
      <div>
        <div class="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">{g.label}</div>
        <div class="overflow-hidden rounded-xl bg-secondary/40">
          {#each g.items as it (it.href)}
            {@const Icon = it.icon}
            <a href={it.href} data-focusable use:ripple onclick={() => h.tap()}
               class="ripple-host flex min-h-14 items-center gap-3 border-b border-border/50 px-3 py-2.5 last:border-b-0 transition-transform active:scale-[0.985]">
              <Icon size={20} class="shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1">
                <span class="block text-[0.95rem] font-bold leading-tight">{it.title}</span>
                <span class="mt-0.5 block truncate text-[11px] text-muted-foreground">{it.subtitle}</span>
              </span>
              <ChevronRight size={18} class="shrink-0 text-muted-foreground" />
            </a>
          {/each}
        </div>
      </div>
    {/each}
  </div>
{:else}
  <!-- Desktop: vertical rail (unchanged behavior). -->
  <nav data-nav-scroll-container class="flex h-full flex-col gap-1 overflow-y-auto overscroll-contain pr-1">
    {#each flat as it (it.href)}
      {@const Icon = it.icon}
      <a href={it.href} data-focusable
         class="flex shrink-0 items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold transition-colors
           {active(it.href) ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'}">
        <Icon size={18} /> {it.title}
      </a>
    {/each}
  </nav>
{/if}
