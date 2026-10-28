<script lang="ts">
  import { tick } from 'svelte'
  import Check from '@lucide/svelte/icons/check'
  import Ellipsis from '@lucide/svelte/icons/ellipsis'
  import Palette from '@lucide/svelte/icons/palette'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import Store from '@lucide/svelte/icons/store'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import OptionsSheet, { type SheetGroup } from '$lib/components/detail/OptionsSheet.svelte'
  import { focusByNav } from '$lib/nav'
  import { PAGE_OPTIONS_EVENT } from '$lib/nav/gamepad'
  import { activeStudioThemeId, studioThemes } from '$lib/settings/theme-studio'
  import { themePreset } from '$lib/settings/ui'
  import { THEME_PRESETS, type ThemeTokens } from '$lib/theme-tokens'
  import type { InstalledTheme } from '$lib/themes/installed'
  import { portal } from '$lib/util/portal'
  import { DEFAULT_THEME_CARD, THEME_OPTION_LABELS, appliedThemeCard, cardAfterRemove, themeCardNavId, themeOptionIds } from './controller-themes'

  // Installed themes for a controller (Game mode, TV, a pad): one large card per line, so Up/Down step
  // one theme at a time and Right ends at the card's More. A applies; More or ☰ opens the theme's
  // other actions in the options sheet. The page owns every action and its messages.
  let { items, thumb, locked, busy, canUpdate, listed, ondefault, onapply, onupdate, onrestore, onremove, onstore }: {
    items: InstalledTheme[]
    thumb: (item: InstalledTheme) => string | undefined
    /** A Theme Studio draft is open: nothing may be applied, restored or removed. */
    locked: boolean
    busy: boolean
    canUpdate: (item: InstalledTheme) => boolean
    listed: (item: InstalledTheme) => boolean
    ondefault: () => void
    onapply: (item: InstalledTheme) => void
    onupdate: (item: InstalledTheme) => void
    onrestore: (item: InstalledTheme) => void
    onremove: (item: InstalledTheme) => void
    onstore: (item: InstalledTheme) => void
  } = $props()

  interface Card { id: string; name: string; meta: string; tokens?: ThemeTokens; image?: string; item: InstalledTheme | null }
  const cards = $derived<Card[]>([
    { id: DEFAULT_THEME_CARD, name: 'Izumi default', meta: 'The original appearance', tokens: THEME_PRESETS.izumi, item: null },
    ...items.map((item) => ({ id: item.id, name: item.package.name, meta: `By ${item.package.author} · ${item.package.version}`,
      tokens: $studioThemes.find((theme) => theme.id === item.designId)?.tokens, image: thumb(item), item })),
  ])
  const applied = $derived(appliedThemeCard($themePreset, $activeStudioThemeId, items))
  let sheetFor = $state<InstalledTheme | null>(null)

  function focusCard(id: string | null) {
    const el = id ? document.querySelector<HTMLElement>(`[data-nav-id="${CSS.escape(themeCardNavId(id))}"]`) : null
    if (el && document.activeElement !== el) focusByNav(el, true)
  }
  function pick(card: Card, button: HTMLElement) {
    if (locked) return
    const held = document.activeElement === button
    if (card.item) onapply(card.item)
    else ondefault()
    // A theme restyles the page around the list (a theme can move the navigation): once it has, the
    // card that held focus is found again by its id.
    if (held) requestAnimationFrame(() => focusCard(card.id))
  }
  function remove(item: InstalledTheme) {
    const next = cardAfterRemove(cards.map((card) => card.id), item.id)
    onremove(item)
    // Before the sheet hands focus back to the removed card, which is gone.
    void tick().then(() => focusCard(next))
  }

  const ICONS = { update: RefreshCw, restore: RotateCcw, store: Store, remove: Trash2 }
  const groups = $derived.by((): SheetGroup[] => {
    const item = sheetFor
    if (!item) return []
    const run = { update: () => onupdate(item), restore: () => onrestore(item), store: () => onstore(item), remove: () => remove(item) }
    return [{ options: themeOptionIds(item, { update: canUpdate(item), store: listed(item) }).map((id) => ({
      id, label: THEME_OPTION_LABELS[id], icon: ICONS[id], onselect: run[id],
      disabled: id !== 'store' && (locked || (id === 'update' && busy)),
    })) }]
  })

  // ☰ on a theme's card opens its options, as More does; elsewhere on the page ☰ keeps its usual job.
  $effect(() => {
    const claim = (event: Event) => {
      const id = document.activeElement?.closest<HTMLElement>('[data-installed-theme]')?.dataset.installedTheme
      const item = items.find((entry) => entry.id === id)
      if (!item || sheetFor || document.querySelector('[data-nav-trap]')) return
      event.preventDefault()
      sheetFor = item
    }
    window.addEventListener(PAGE_OPTIONS_EVENT, claim)
    return () => window.removeEventListener(PAGE_OPTIONS_EVENT, claim)
  })
</script>

<ul class="list" aria-label="Themes">
  {#each cards as card (card.id)}
    {@const on = card.id === applied}
    <li class="row" data-nav-line data-installed-theme={card.id}>
      <button type="button" class="card" data-focusable data-nav-id={themeCardNavId(card.id)} data-theme-key={card.item ? `${card.item.origin}|${card.item.id}` : undefined}
        data-hint-a="Apply" data-hint-start={card.item ? 'Options' : undefined} aria-pressed={on} aria-disabled={locked || undefined}
        onclick={(event) => pick(card, event.currentTarget)}>
        <span class="thumb" style:background={card.tokens && !card.image ? `hsl(${card.tokens.background})` : undefined}>
          {#if card.image}<img src={card.image} alt="" loading="lazy" referrerpolicy="no-referrer" />
          {:else if card.tokens}<span class="accent" style:background={`hsl(${card.tokens.theme})`}></span>
          {:else}<Palette size={28} />{/if}
        </span>
        <span class="text"><strong>{card.name}</strong><span>{card.meta}</span></span>
        {#if on}<span class="badge"><Check size={18} aria-hidden="true" />Applied</span>{/if}
      </button>
      {#if card.item}
        {@const item = card.item}
        <button type="button" class="more" data-focusable data-hint-a="Options" aria-label={`More for ${card.name}`} onclick={() => (sheetFor = item)}><Ellipsis size={26} /></button>
      {/if}
    </li>
  {/each}
</ul>
{#if sheetFor}
  <!-- On <body>: the themes page is a size container and the section wrapper slides in with a
       transform, either of which can turn the sheet's `fixed` into the page's box. -->
  <div use:portal>
    <OptionsSheet title={sheetFor.package.name} subtitle={`By ${sheetFor.package.author} · ${sheetFor.package.version}`} {groups} onclose={() => (sheetFor = null)} />
  </div>
{/if}

<style>
  /* rem against the controller root (Settings' TV layout); no transitions, which blink on the Deck. */
  .list { display: grid; gap: .667rem; margin: 0; padding: 0; list-style: none; }
  .row { display: flex; align-items: stretch; gap: .444rem; }
  .card, .more { border-radius: 1rem; background: hsl(var(--foreground) / .05); }
  .card { flex: 1; min-width: 0; display: flex; align-items: center; gap: 1rem; min-height: 5.333rem; padding: .667rem 1rem .667rem .667rem; text-align: start; }
  .more { flex: none; width: 3.556rem; display: grid; place-items: center; }
  .card:focus, .more:focus { background: hsl(var(--foreground) / .14); }
  .card[aria-pressed='true'] { background: hsl(var(--primary) / .12); }
  .card[aria-pressed='true']:focus { background: hsl(var(--primary) / .2); }
  .card[aria-disabled='true'] { opacity: .45; cursor: not-allowed; }
  .thumb { width: 7.111rem; aspect-ratio: 16 / 10; flex: none; display: grid; place-items: center; overflow: hidden; border-radius: .556rem; background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .accent { width: 45%; height: .444rem; border-radius: 999px; }
  .text { flex: 1; min-width: 0; display: grid; gap: .222rem; }
  .text > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  strong { font-size: 1.111rem; font-weight: 900; letter-spacing: -.01em; }
  .text span { font-size: .833rem; color: hsl(var(--muted-foreground)); }
  .badge { flex: none; display: inline-flex; align-items: center; gap: .333rem; padding: .333rem .778rem; border-radius: 999px; font-size: .833rem; font-weight: 800; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
</style>
