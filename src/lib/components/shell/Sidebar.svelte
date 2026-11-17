<script lang="ts">
  import CatalogBrandLogo from '../catalog/CatalogBrandLogo.svelte'
  import BrandText from '../BrandText.svelte'
  import CatalogSwitcher from '../catalog/CatalogSwitcher.svelte'
  import TopSearchField from './TopSearchField.svelte'
  import NavDrawer from './NavDrawer.svelte'
  import NavPanel from './NavPanel.svelte'
  import CategoriesMenu from './CategoriesMenu.svelte'
  import Home from '@lucide/svelte/icons/house'
  import Calendar from '@lucide/svelte/icons/calendar'
  import Search from '@lucide/svelte/icons/search'
  import LayoutGrid from '@lucide/svelte/icons/layout-grid'
  import Shapes from '@lucide/svelte/icons/shapes'
  import Bookmark from '@lucide/svelte/icons/bookmark'
  import History from '@lucide/svelte/icons/clock-arrow-down'
  import CalendarDays from '@lucide/svelte/icons/calendar-days'
  import List from '@lucide/svelte/icons/list'
  import Download from '@lucide/svelte/icons/download'
  import Users from '@lucide/svelte/icons/users'
  import Settings from '@lucide/svelte/icons/settings'
  import VenetianMask from '@lucide/svelte/icons/venetian-mask'
  import LibraryBig from '@lucide/svelte/icons/library-big'
  import LogIn from '@lucide/svelte/icons/log-in'
  import Menu from '@lucide/svelte/icons/menu'
  import { get } from 'svelte/store'
  import Glyph from './Glyph.svelte'
  import ButtonHints from './ButtonHints.svelte'
  import { goto } from '$app/navigation'
  import { anilistUserName, malUserName, anilistUserAvatar, malUserAvatar, malUser } from '$lib/trackers/config'
  import { anilistUser } from '$lib/anilist/account'
  import { traktUserName, traktUserAvatar } from '$lib/trakt/config'
  import { page } from '$app/state'
  import { gameMode, playing } from '$lib/player/session'
  import { startupAnimationPlaying } from '$lib/startup/animation'
  import { inputType } from '$lib/nav'
  import { controllerMode } from '$lib/nav/input'
  import { onPadButton } from '$lib/nav/pad-events'
  import { describeFocus, restoreFocus, type FocusDescriptor } from '$lib/nav/focus-memory'
  import { bumperTabs, pageBumpers, stepSection } from '$lib/nav/bumpers'
  import { settingsControllerMode } from '$lib/settings/surface'
  import { stepPageTabs } from '$lib/nav/page-tabs'
  import { glyphFamily, lastPadId, rememberPad } from '$lib/nav/glyphs'
  import { activeProfile, profileSwitcherOpen, profilesEnabled } from '$lib/profiles/store'
  import { profileAvatarUrl } from '$lib/profiles/avatars'
  import { incognito, toggleIncognito } from '$lib/stores/incognito'
  import { offlineMode } from '$lib/stores/offline'
  import {
    browseShown, catalogLabel, catalogProvider, catalogScreen, catalogSwitcherPlacement, customScreens, enabledCatalogScreens, resolveCatalogSwitcherPlacement, selectCatalogScreen,
  } from '$lib/settings/catalog'
  import { isSourceSelection, sourceAddon, sourcePackageOf } from '$lib/catalog/source-catalogs'
  import { listingHref, sourceMenus, type SourceMenu } from '$lib/catalog/source-menus'
  import { extensionServiceSettings } from '$lib/extensions/manager'
  import { sourceProfiles } from '$lib/extensions/source-profiles'
  import UserRound from '@lucide/svelte/icons/user-round'
  import { interfaceMode } from '$lib/settings/interface-mode'
  import { searchModeNav } from '$lib/settings/nav-rules'
  import * as h from '$lib/haptics'
  import { m } from '$lib/paraglide/messages.js'
  import { isTv } from '$lib/platform'
  import { themePresentation } from '$lib/themes/runtime'
  import { themeScreens } from '$lib/themes/layout-state'
  import { screenDestination } from './theme-screen-icons'

  let { placement = 'sidebar' }: { placement?: 'sidebar' | 'top' | 'drawer' } = $props()
  const compact = $derived($themePresentation?.shell?.compact === true)
  const top = $derived(placement === 'top')
  // `shell.nav: "drawer"` (API 7): no rail and no bar. Every destination, the screens and the account
  // live in a drawer that Start, Left from the left edge or the menu button opens.
  const drawerNav = $derived(placement === 'drawer')
  // `data-scrolled` once the page has scrolled, so a theme can keep the bar clear over the top of a page.
  let scrolled = $state(false)
  $effect(() => {
    if (!top) return
    const update = () => { scrolled = window.scrollY > 0 }
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  })
  const topBar = $derived($themePresentation?.shell?.top ?? {})
  const labelMode = $derived(top ? topBar.labels ?? 'icons' : 'icons')
  const brandCentered = $derived(top && topBar.brand === 'center')
  // A theme top bar search field (`shell.top.search`) replaces the Search destination link.
  const searchField = $derived(top && $interfaceMode !== 'search' && (topBar.search === 'field-center' || topBar.search === 'field-end'))
  // A centred brand owns the middle of the bar, so a centre field moves to the end instead of under it.
  const fieldCenter = $derived(searchField && topBar.search === 'field-center' && !brandCentered)
  const fieldEnd = $derived(searchField && !fieldCenter)
  // Nav items (top). Settings + profile are pinned to the BOTTOM. `id` is the destination's
  // `data-dest` (the bottom bar's ids), so a theme styles a destination wherever it sits.
  const items = [
    { id: 'home', href: '/app/home', icon: Home, label: m.nav_home(), anim: 'group-hover:animate-[bounce-sm_0.4s_ease]' },
    { id: 'schedule', href: '/app/schedule', icon: Calendar, label: m.nav_schedule(), anim: 'group-hover:animate-[swing_0.5s_ease]' },
    { id: 'search', href: '/app/search', icon: Search, label: m.nav_search(), anim: 'group-hover:animate-[wiggle_0.4s_ease]' },
    { id: 'browse', href: '/app/browse', icon: LayoutGrid, label: 'Browse', anim: '' },
    { id: 'downloads', href: '/app/downloads', icon: Download, label: m.nav_downloads(), anim: 'group-hover:animate-[bounce-sm_0.4s_ease]' },
    { id: 'watch', href: '/app/watch', icon: Users, label: m.nav_watch_together(), anim: 'group-hover:animate-[wiggle_0.4s_ease]' },
    { id: 'library', href: '/app/library', icon: LibraryBig, label: 'Library', anim: '' },
  ]
  const settingsItem = { id: 'settings', href: '/app/settings', icon: Settings, label: m.nav_settings(), anim: '' }
  const listed = $derived($browseShown ? items : items.filter((it) => it.id !== 'browse'))
  // API 8 `layout.screens`: the theme's own screens follow the destinations (not in Search box mode).
  const screenItems = $derived($themeScreens.map(screenDestination))
  const shown = $derived($interfaceMode === 'search' ? searchModeNav(listed) : [...(searchField ? listed.filter((it) => it.href !== '/app/search') : listed), ...screenItems])
  // The drawer has room for Categories after Browse (the catalog's categories as a wall of chips);
  // the rail and the top bar keep their set.
  const categoriesItem = { id: 'categories', href: '/app/categories', icon: Shapes, label: 'Categories', anim: '' }
  // A source screen adds the lists its source puts in the menu (its watchlist, history, seasons).
  let menus = $state<SourceMenu[]>([])
  // …and "Who's watching?" when its account has more than one profile of its own.
  let manyProfiles = $state(false)
  $effect(() => {
    const selection = $catalogProvider
    menus = []
    manyProfiles = false
    if (!isSourceSelection(selection)) return
    let live = true
    sourceAddon(sourcePackageOf(selection)).then((addon) => { if (live) menus = sourceMenus(addon.manifest) }).catch(() => {})
    extensionServiceSettings(sourcePackageOf(selection)).then((document) => { if (live) manyProfiles = !!sourceProfiles(document) }).catch(() => {})
    return () => { live = false }
  })
  const MENU_ICONS = { bookmark: Bookmark, history: History, calendar: CalendarDays, list: List }
  const menuItems = $derived([
    ...menus.map((menu) => ({ id: 'listing', href: listingHref(menu), icon: MENU_ICONS[menu.icon], label: menu.label, anim: '' })),
    ...(manyProfiles ? [{ id: 'profiles', href: '/app/source-profiles', icon: UserRound, label: "Who's watching?", anim: '' }] : []),
  ])
  const drawerItems = $derived(shown.flatMap((item) => item.id === 'browse' ? [item, categoriesItem, ...menuItems] : [item]))
  // `menu: "side"`: the menu is a pinned panel down the left on windows from 1100 px (the bar keeps
  // only its brand, search and trailing buttons); the menu button folds it away, and narrower
  // windows fall back to the drawer. Hidden while a video plays, like the rail goes inert.
  const sideMenu = $derived(top && topBar.menu === 'side')
  const sideWidth = $derived(topBar.sideWidth ?? 260)
  let wide = $state(true)
  $effect(() => {
    const query = window.matchMedia('(min-width: 1100px)')
    const update = () => (wide = query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  })
  const PANEL_FOLDED_KEY = 'izumi-side-panel-folded'
  let panelFolded = $state(typeof localStorage !== 'undefined' && localStorage.getItem(PANEL_FOLDED_KEY) === '1')
  const panelShown = $derived(sideMenu && wide && !panelFolded && !$playing)
  function togglePanel() {
    panelFolded = !panelFolded
    try { localStorage.setItem(PANEL_FOLDED_KEY, panelFolded ? '1' : '0') } catch { /* storage may be unavailable */ }
  }
  // The page makes room for the panel through the shell margin every full-bleed surface follows.
  $effect(() => {
    const root = document.documentElement
    if (panelShown) {
      root.setAttribute('data-theme-side-panel', '')
      root.style.setProperty('--theme-side-width', `${sideWidth}px`)
    } else {
      root.removeAttribute('data-theme-side-panel')
      root.style.removeProperty('--theme-side-width')
    }
  })
  $effect(() => () => {
    document.documentElement.removeAttribute('data-theme-side-panel')
    document.documentElement.style.removeProperty('--theme-side-width')
  })
  // `bumpers` (API 3): the destinations become tabs that L1/R1 switch, with the bumper glyphs at
  // either end; L2/R2 step the page's own tabs, Start opens the menu drawer and View opens search.
  // With a pad in use the bar's controls leave the d-pad order, so Up can never strand focus in the
  // bar; the drawer is the pad's way to every destination and Settings.
  const bumpers = $derived(top && topBar.bumpers === true)
  const padUi = $derived($gameMode || $controllerMode)
  const barOffPad = $derived(bumpers && padUi)
  const family = $derived(glyphFamily($lastPadId, $gameMode))
  $effect(() => {
    bumperTabs.set(bumpers)
    return () => bumperTabs.set(false)
  })
  const accountName = $derived($anilistUserName || $malUserName || $traktUserName || $anilistUser || $malUser)
  const accountAvatar = $derived($anilistUserAvatar || $malUserAvatar || $traktUserAvatar)
  const accountLabel = $derived($profilesEnabled ? $activeProfile.name : accountName || 'Sign in')
  // Expand the rail to a labelled menu while it holds focus, BUT only for keyboard/gamepad
  // navigation — never a mouse. On the Deck (gameMode) any focus expands it; on desktop only
  // when the last input was the keyboard (arrow/tab), so a mouse click/hover leaves the icon
  // rail as-is. `open` drives width + labels; there's no content scrim (the rail goes opaque
  // + casts a shadow, which is enough to read the labels).
  let focused = $state(false)
  let catalogPickerOpen = $state(false)
  let drawerOpen = $state(false)
  let menuBtn = $state<HTMLButtonElement>()
  // Expand only when focus arrived via the d-pad / arrow keys (inputType 'dpad') — never a touch
  // tap or a mouse (which would flash the rail open then closed as it navigates; a tap should
  // just switch pages). `inputType` is the app-wide modality store (set to 'dpad' on arrow keys
  // and by the gamepad translator, 'touch'/'mouse' on pointerdown). Off during playback.
  const open = $derived(focused && !$playing && $inputType === 'dpad')
  // While playing (windowed — the rail is hidden entirely in fullscreen/Game mode), the player
  // owns input: the menu icons must not be focusable/selectable by the d-pad or keyboard. Left
  // mouse-clickable so a windowed desktop user can still click away. `df`/`tab` fall to normal
  // (focusable) in browse.
  const df = $derived($playing || barOffPad ? undefined : '')
  const tab = $derived($playing ? -1 : undefined)
  // Top chrome is icon-only by default: leftover label width from the rail anatomy stretches
  // hover highlights into huge pills and shoves destinations across the titlebar. A theme can ask
  // for text/both labels (`shell.top.labels`) on the six destinations only — Incognito, Settings
  // and the account button always stay icon-only.
  const destClass = (on: boolean, labelled = false) => top
    ? labelled && labelMode !== 'icons'
      ? `group relative inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors hover:bg-accent hover:text-foreground ${on ? 'text-foreground' : 'text-muted-foreground'}`
      : `group relative grid size-10 shrink-0 place-items-center rounded-lg transition-colors hover:bg-accent hover:text-foreground ${on ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground'}`
    : `group relative flex h-11 shrink-0 items-center gap-3 rounded-md pl-3 transition-colors hover:bg-accent hover:text-foreground ${on ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground'}`
  const onFocusIn = () => (focused = true)
  const onFocusOut = (e: FocusEvent & { currentTarget: HTMLElement }) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focused = false
  }
  // Collapse on navigation. Selecting a nav item keeps DOM focus on it (client-side route change
  // doesn't blur), so without this the freshly-loaded page briefly shows the EXPANDED rail + its
  // shadow over the hero, then it collapses when focus later moves — a visible shadow "twitch".
  $effect(() => {
    void page.url.pathname
    focused = false
    catalogPickerOpen = false
    drawerOpen = false
  })
  // Same modal convention as the rest of the app: closing a dialog returns focus to whatever
  // opened it (see GlobalSearch's returnFocus). `drawerWasOpen` is a plain latch, NOT $state — an
  // effect that both reads and writes its own reactive dependency never settles.
  let drawerWasOpen = false
  $effect(() => {
    if (drawerWasOpen && !drawerOpen) {
      if (!bumpers && !drawerNav) menuBtn?.focus({ preventScroll: true })
      else if (drawerReturn) restoreFocus(drawerReturn)
      drawerReturn = null
    }
    drawerWasOpen = drawerOpen
  })
  // No active-item highlight while a video plays — the rail is inert then (you're in the player,
  // not browsing), so highlighting the page you launched from (e.g. Home) reads as "selected".
  // A menu list's address carries its query, so it lights up only on its own list.
  // A theme screen matches its own page only: `/app/screen/a` is not active on `/app/screen/ab`.
  const active = (href: string) => !$playing && ((href.startsWith('/app/screen/') ? page.url.pathname === href : (page.url.pathname + page.url.search).startsWith(href)) || href === '/app/library' && ['/app/trakt', '/app/letterboxd'].includes(page.url.pathname))
  // The tab L1/R1 steps from: the current page's, else the last one visited (a series page opened
  // from Home still steps from Home).
  let lastSection = $state<string | undefined>()
  $effect(() => {
    const current = shown.find((item) => active(item.href))?.href
    if (current) lastSection = current
  })
  // Start opens the drawer from wherever focus is and closing it returns there (not to the menu
  // button, which is off the d-pad order under bumper tabs). A page change drops the return target.
  // Described, not held: the control can be re-rendered while the drawer is open (the banner's
  // buttons change with its slide), and the same control, re-rendered, is where focus returns.
  let drawerReturn: FocusDescriptor | null = null
  function toggleDrawer() {
    if (!drawerOpen) drawerReturn = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? describeFocus(document.activeElement) : null
    drawerOpen = !drawerOpen
  }
  $effect(() => {
    if (!bumpers) return
    return onPadButton(({ name, pressed }) => {
      if (!pressed || get(playing) || get(startupAnimationPlaying)) return
      rememberPad()
      const dialog = [...document.querySelectorAll<HTMLElement>('[data-nav-trap]')].some((trap) => trap.checkVisibility?.() ?? true)
      if (name === 'start') { if (!dialog || drawerOpen) toggleDrawer(); return }
      if (name === 'l2' || name === 'r2') { stepPageTabs(name === 'l2' ? -1 : 1); return }
      if (dialog) return
      if (name === 'l1' || name === 'r1') {
        // Settings in controller mode steps its own sections with the bumpers (spec §5.5).
        if (get(pageBumpers)) return
        const href = stepSection(shown.map((item) => item.href), lastSection, name === 'l1' ? -1 : 1)
        if (href) void goto(href)
      } else if (name === 'select') void goto('/app/search')
    })
  })
  $effect(() => {
    if (!drawerNav) return
    const toggle = () => { if (!get(playing)) toggleDrawer() }
    const show = () => { if (!get(playing) && !drawerOpen) toggleDrawer() }
    window.addEventListener('nav-drawer-toggle', toggle)
    window.addEventListener('nav-drawer-open', show)
    // View opens Search, as on the top bar's handheld layout (and in the reference handheld app).
    const stopView = onPadButton(({ name, pressed }) => {
      if (!pressed || name !== 'select' || get(playing) || get(startupAnimationPlaying)) return
      if ([...document.querySelectorAll<HTMLElement>('[data-nav-trap]')].some((trap) => trap.checkVisibility?.() ?? true)) return
      drawerOpen = false
      void goto('/app/search')
    })
    return () => {
      window.removeEventListener('nav-drawer-toggle', toggle)
      window.removeEventListener('nav-drawer-open', show)
      stopView()
    }
  })
  function openScreen(screen: typeof $enabledCatalogScreens[number]) {
    selectCatalogScreen(screen)
    drawerOpen = false
    void goto('/app/home')
  }
  // This component only mounts in the desktop shell. Automatic therefore makes the brand itself
  // the catalog trigger, while an explicit Below choice still gets its own rail row.
  const switcherPlacement = $derived(resolveCatalogSwitcherPlacement($catalogSwitcherPlacement, false))
</script>

<!-- Browse: soft scrim so the banner shows through and fades into the page. Hidden while playing. -->
{#if !$playing && !top && !drawerNav}
  <div class="theme-sidebar-scrim pointer-events-none fixed inset-y-0 left-0 z-20 w-32 bg-gradient-to-r from-background/90 via-background/30 to-transparent"></div>
{/if}

<!-- Rows are always icon + label; the rail's width (+ overflow-hidden) reveals the labels when
     expanded, so no per-state markup swap. `main` keeps its 56px margin — the expanded rail
     overlays the content (fixed) rather than reflowing it. Selection uses a quiet active-row fill;
     keyboard/gamepad FOCUS fills the row more strongly (see app.css) — no squared ring. -->
{#if drawerNav}
  {#if !$playing && !padUi}
    <button type="button" data-part="nav.menu" bind:this={menuBtn} data-focusable aria-label="Menu" aria-expanded={drawerOpen} onclick={toggleDrawer}
      class="fixed left-3 z-30 grid size-10 place-items-center rounded-lg bg-background/70 text-foreground backdrop-blur transition-colors hover:bg-accent {$gameMode ? 'top-3' : 'top-10'}"><Menu size={20} /></button>
  {/if}
  <NavDrawer bind:open={drawerOpen} items={drawerItems} {active} head={drawerHead} after={drawerScreens} foot={drawerFoot} slide={288} duration={240} closeOnRight />
{:else}
<nav data-slot={top ? 'nav.top' : 'nav.side'} data-scrolled={top && scrolled || undefined} data-nav-sidebar data-theme-surface="shell" onfocusin={onFocusIn} onfocusout={onFocusOut}
     class="fixed z-30 flex gap-1 transition-[width] duration-200 ease-out
       {top ? 'inset-x-0 top-0 h-[var(--theme-top-bar)] w-full flex-row items-center border-b border-border/50 bg-background px-3 pt-8' : 'inset-y-0 left-0 flex-col py-3 pt-9'}
       {catalogPickerOpen ? 'overflow-visible' : 'overflow-hidden'}
       {top ? '' : open ? 'w-[200px]' : compact ? 'w-12' : 'w-14'}
       {$playing || open ? 'bg-background' : ''} {open ? 'shadow-2xl' : $playing || top ? '' : 'drop-shadow-md'}
       {brandCentered ? '!grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]' : ''}
       {top && ($gameMode || $isTv) ? '!h-[var(--theme-top-row)] !pt-0' : ''}">
  {#if brandCentered}
    <!-- A centred brand gets its own grid column instead of sharing the flex row: the links (or the
         trailing cluster) otherwise run under the absolutely-centred brand and steal its clicks once
         the row gets crowded (labels: both around 1280px, text below ~1150px). The left cell clips/
         scrolls instead of pushing into the brand's column. -->
    <div data-part="nav.start" class="flex min-w-0 items-center gap-1 overflow-hidden">
      {@render menuButton()}
      {@render belowSwitcher()}
      {@render navLinks()}
    </div>
    {@render brandBlock()}
    <div data-part="nav.end" class="flex items-center justify-end gap-1">
      {#if fieldEnd}<TopSearchField className="mr-2 w-64" focusable={!$playing && !barOffPad} tabindex={tab} />{/if}
      {@render incognitoToggle()}
      {@render settingsLink()}
      {@render accountButton()}
    </div>
  {:else}
    {@render menuButton()}
    {@render brandBlock()}
    {@render belowSwitcher()}
    {@render navLinks()}

    <!-- Spacer pushes Settings + profile to the bottom of the rail, or the trailing cluster to the
         right of a top bar. A theme top bar search field (`field-center`) takes its place instead. -->
    <div data-part="nav.spacer" class="flex flex-1 justify-center px-4">{#if fieldCenter}<TopSearchField className="w-full max-w-md" focusable={!$playing && !barOffPad} tabindex={tab} />{/if}</div>
    {#if fieldEnd}<TopSearchField className="mr-2 w-64" focusable={!$playing && !barOffPad} tabindex={tab} />{/if}
    {@render incognitoToggle()}
    {@render settingsLink()}
    {@render accountButton()}
  {/if}
</nav>
{/if}
{#if top && (topBar.menu === 'drawer' || bumpers || (sideMenu && !wide))}<NavDrawer bind:open={drawerOpen} items={[...items, ...screenItems, settingsItem]} {active} />{/if}
{#if panelShown}<NavPanel width={sideWidth} items={[...shown, settingsItem]} {active} />{/if}
{#if $themePresentation?.shell?.hints}<ButtonHints />{/if}

{#snippet drawerHead()}
  <a data-part="nav.drawer.head" href="/app/home" tabindex={-1} onclick={() => (drawerOpen = false)} class="mb-3 flex items-center gap-3 px-2">
    <CatalogBrandLogo platform={$catalogScreen} />
    <BrandText weight={800} />
  </a>
{/snippet}

{#snippet drawerScreens()}
  {#if !$offlineMode && $enabledCatalogScreens.length > 1}
    <div data-part="nav.drawer.heading" class="mt-4 px-3 pb-1 text-[0.625rem] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">Screens</div>
    {#each $enabledCatalogScreens as screen (screen)}
      {@const on = $catalogScreen === screen}
      <button type="button" data-part="nav.item" data-variant="screen" data-screen={screen} data-active={on || undefined} data-focusable onclick={() => openScreen(screen)}
        class="flex h-11 shrink-0 items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold transition-colors hover:bg-accent {on ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground'}">
        <!-- The brand mark pins its own transform, so the scale is on a wrapper. -->
        <span data-part="nav.item.icon" class="grid w-6 place-items-center"><span class="grid scale-75"><CatalogBrandLogo platform={screen} /></span></span>
        <span data-part="nav.item.label" class="truncate">{catalogLabel(screen, $customScreens)}</span>
      </button>
    {/each}
  {/if}
{/snippet}

{#snippet drawerFoot()}
  <div data-part="nav.drawer.foot" class="mt-auto flex shrink-0 items-center gap-1 border-t border-border/50 pt-3">
    <button type="button" data-part="nav.action" data-action="account" data-focusable title={accountLabel}
      onclick={() => { drawerOpen = false; if ($profilesEnabled) $profileSwitcherOpen = true; else void goto('/app/settings/accounts') }}
      class="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-left text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
      <span data-part="nav.action.icon" class="grid size-8 shrink-0 place-items-center">
        {#if $profilesEnabled}<img src={profileAvatarUrl($activeProfile.avatar, $activeProfile.color)} alt="" class="size-8 rounded-lg" />
        {:else if accountAvatar}<img src={accountAvatar} alt="" class="size-8 rounded-full object-cover" />
        {:else}<LogIn size={20} />{/if}
      </span>
      <span data-part="nav.action.label" class="truncate">{accountLabel}</span>
    </button>
    <button type="button" data-part="nav.action" data-action="incognito" data-active={$incognito || undefined} data-focusable aria-pressed={$incognito} title={m.nav_incognito()} onclick={toggleIncognito}
      class="grid size-10 shrink-0 place-items-center rounded-lg transition-colors hover:bg-accent {$incognito ? 'text-violet-400' : 'text-muted-foreground'}">
      <span data-part="nav.action.icon" class="grid place-items-center"><VenetianMask size={20} /></span>
      <span data-part="nav.action.label" class="sr-only">{m.nav_incognito()}</span>
    </button>
    <a data-part="nav.action" data-action="settings" data-active={active('/app/settings') || undefined} data-focusable href="/app/settings" title={m.nav_settings()} onclick={() => (drawerOpen = false)}
      class="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
      <span data-part="nav.action.icon" class="grid place-items-center"><Settings size={20} /></span>
      <span data-part="nav.action.label" class="sr-only">{m.nav_settings()}</span>
    </a>
  </div>
{/snippet}

{#snippet menuButton()}
  {#if top && (topBar.menu === 'drawer' || sideMenu)}
    <button type="button" data-part="nav.menu" bind:this={menuBtn} data-focusable={df} tabindex={tab} aria-label="Menu" aria-expanded={sideMenu && wide ? panelShown : drawerOpen} onclick={() => (sideMenu && wide ? togglePanel() : (drawerOpen = true))}
      class="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><Menu size={20} /></button>
  {/if}
{/snippet}

{#snippet brandBlock()}
  <!-- On Home, Integrated mode turns the brand into the catalog trigger. Everywhere else it stays
       predictable Home navigation; Below mode keeps the explicit provider row underneath. -->
  <div class="group flex h-10 shrink-0 items-center gap-2 text-left {top ? '' : 'mb-2'}">
    {#if switcherPlacement === 'integrated' && active('/app/home') && !$offlineMode && $enabledCatalogScreens.length > 1}
      <CatalogSwitcher display="brand" bind:open={catalogPickerOpen} className="ml-2 shrink-0" />
    {:else}
      <a href="/app/home" onclick={() => h.tap()} aria-label={m.nav_home()} title={m.nav_home()} tabindex={-1}
         class="ml-2 grid size-10 shrink-0 place-items-center transition-transform duration-200 group-hover:scale-110">
        <CatalogBrandLogo platform={$catalogScreen} />
      </a>
    {/if}
    {#if top}<BrandText />{/if}
    {#if !top}
      <!-- The text pins its own opacity, so the rail's fade is on a wrapper. -->
      <span class="flex transition-opacity duration-150 {open ? 'opacity-100' : 'opacity-0'}"><BrandText /></span>
    {/if}
  </div>
{/snippet}

{#snippet belowSwitcher()}
  {#if !$offlineMode && switcherPlacement === 'below'}
    <CatalogSwitcher display="rail" bind:open={catalogPickerOpen} expanded={open} className="shrink-0" />
  {/if}
{/snippet}

{#snippet navLinks()}
  <!-- With a side menu the destinations live in the panel (or the drawer), not in the bar. -->
  {#if bumpers && padUi}<span data-part="nav.bumper" data-button="l1" class="grid shrink-0 place-items-center px-1"><Glyph {family} button="l1" /></span>{/if}
  {#each sideMenu ? [] : shown as it (it.href)}
    {@const on = active(it.href)}
    <a data-part="nav.item" data-dest={it.id} data-screen={'screen' in it ? it.screen : undefined} data-active={on || undefined} href={it.href} title={it.label} data-focusable={df} tabindex={tab} aria-current={on ? 'page' : undefined}
       class={destClass(on, true)}>
      {#if labelMode !== 'text'}
        <span data-part="nav.item.icon" class="grid {top ? 'size-5' : 'w-8'} shrink-0 place-items-center"><it.icon size={20} class={it.anim} /></span>
      {/if}
      {#if !top}
        <span data-part="nav.item.label" class="whitespace-nowrap text-sm font-semibold transition-opacity duration-150 {open ? 'opacity-100' : 'opacity-0'}">{it.label}</span>
      {:else if labelMode === 'icons'}
        <span data-part="nav.item.label" class="sr-only">{it.label}</span>
      {:else}
        <span data-part="nav.item.label">{it.label}</span>
      {/if}
    </a>
  {/each}
  {#if bumpers && padUi}<span data-part="nav.bumper" data-button="r1" class="grid shrink-0 place-items-center px-1"><Glyph {family} button="r1" /></span>{/if}
  {#if top && topBar.categories}<CategoriesMenu focusable={!$playing && !barOffPad} tabindex={tab} />{/if}
{/snippet}

{#snippet incognitoToggle()}
  <!-- Incognito toggle: same row anatomy as the links; violet accent + tinted icon while active
       (the top banner is the loud indicator — this stays quiet). -->
  <button data-part="nav.action" data-action="incognito" data-active={$incognito || undefined} onclick={toggleIncognito} title={m.nav_incognito()} data-focusable={df} tabindex={tab}
     aria-pressed={$incognito}
     class="{destClass($incognito)} {top ? '' : 'text-left'}">
    {#if $incognito && !top}<span class="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-violet-500"></span>{/if}
    <span data-part="nav.action.icon" class="grid {top ? 'size-5' : 'w-8'} shrink-0 place-items-center"><VenetianMask size={20} class="group-hover:animate-[wiggle_0.4s_ease] {$incognito ? 'text-violet-400' : ''}" /></span>
    {#if top}
      <span data-part="nav.action.label" class="sr-only">{m.nav_incognito()}</span>
    {:else}
      <span data-part="nav.action.label" class="whitespace-nowrap text-sm font-semibold transition-opacity duration-150 {open ? 'opacity-100' : 'opacity-0'}">{m.nav_incognito()}</span>
    {/if}
  </button>
{/snippet}

{#snippet settingsLink()}
  <!-- Left from the controller Settings rail lands on Settings in a side strip; in a top bar the link
       sits at the far right, so a move there would read as a jump across the screen. -->
  <a data-part="nav.action" data-action="settings" data-active={active('/app/settings') || undefined} href="/app/settings" title={m.nav_settings()} data-focusable={df} tabindex={tab}
     aria-current={active('/app/settings') ? 'page' : undefined}
     data-nav-region-default={active('/app/settings') && $settingsControllerMode && !top ? '' : undefined}
     class={destClass(active('/app/settings'))}>
    <span data-part="nav.action.icon" class="grid {top ? 'size-5' : 'w-8'} shrink-0 place-items-center"><Settings size={20} class="group-hover:animate-[spin_0.6s_ease]" /></span>
    {#if top}
      <span data-part="nav.action.label" class="sr-only">{m.nav_settings()}</span>
    {:else}
      <span data-part="nav.action.label" class="whitespace-nowrap text-sm font-semibold transition-opacity duration-150 {open ? 'opacity-100' : 'opacity-0'}">{m.nav_settings()}</span>
    {/if}
  </a>
{/snippet}

{#snippet accountButton()}
  <button type="button" data-part="nav.action" data-action="account" onclick={() => $profilesEnabled ? ($profileSwitcherOpen = true) : goto('/app/settings/accounts')} title={$profilesEnabled ? `Switch profile · ${$activeProfile.name}` : accountLabel} data-focusable={df} tabindex={tab}
     class="{top ? destClass(false) : 'group mt-1 flex h-12 w-full shrink-0 items-center gap-3 rounded-md pl-3 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'}">
    <span data-part="nav.action.icon" class="grid {top ? 'size-8' : 'w-8'} shrink-0 place-items-center">
      {#if $profilesEnabled}
        <img src={profileAvatarUrl($activeProfile.avatar, $activeProfile.color)} alt="" class="size-8 rounded-lg" />
      {:else if accountAvatar}
        <img src={accountAvatar} alt="" class="size-8 rounded-full object-cover" />
      {:else}<LogIn size={20} />{/if}
    </span>
    {#if top}
      <span data-part="nav.action.label" class="sr-only">{accountLabel}</span>
    {:else}
      <span data-part="nav.action.label" class="max-w-[140px] truncate whitespace-nowrap text-sm font-semibold transition-opacity duration-150 {open ? 'opacity-100' : 'opacity-0'}">{accountLabel}</span>
    {/if}
  </button>
{/snippet}
