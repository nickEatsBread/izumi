<script lang="ts">
  import { getContext, onMount, untrack, type Snippet } from 'svelte'
  import { page } from '$app/state'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import { SETTINGS_SECTION_CONTEXT, SUBCATEGORY_OPEN_EVENT, subcategoryDef, type SettingsSectionDef } from '$lib/settings/sections'
  import { settingsControllerMode } from '$lib/settings/surface'
  import { rememberSubcategory, subcategoryFoldable, subcategoryLine, subcategoryStartsCollapsed } from '$lib/settings/subcategory-fold'

  let {
    id,
    title,
    summary,
    collapsible,
    plain = false,
    open = $bindable(false),
    children,
  }: {
    /** Registry subcategory id; also the DOM id (anchor) and the hash that unfolds it. */
    id: string
    /** Default: the registry title. */
    title?: string
    /** Folded line text (Advanced: "Rendering preset, mpv options, cache, +5"). */
    summary?: string
    /** Default: true when the registry marks it advanced. Controller mode folds every subcategory. */
    collapsible?: boolean
    /** Skip the rounded row card (list editors, previews, free-form content). */
    plain?: boolean
    /** Unfolded state, for pages that defer work until a folded block opens. */
    open?: boolean
    children: Snippet
  } = $props()

  const section = getContext<SettingsSectionDef | undefined>(SETTINGS_SECTION_CONTEXT)
  const def = $derived(section ? subcategoryDef(section.id, id) : undefined)
  const heading = $derived(title ?? def?.title ?? id)
  const foldable = $derived(subcategoryFoldable($settingsControllerMode, collapsible, def?.advanced === true))

  function startsCollapsed(): boolean {
    return subcategoryStartsCollapsed({
      foldable,
      controller: $settingsControllerMode,
      section: section?.id,
      id,
      first: section?.subcategories[0]?.id === id,
    })
  }
  // Controller mode opens the section's first subcategory, or whatever was left open, on arrival.
  if (!untrack(startsCollapsed)) open = true
  const collapsed = $derived(foldable && !open)

  function setCollapsed(next: boolean) {
    open = !next
    rememberSubcategory($settingsControllerMode, section?.id, id, !next)
  }

  let root = $state<HTMLElement>()
  let body = $state<HTMLElement>()

  // A link to #<id> (a chip, a legacy redirect) unfolds it. page.url, not afterNavigate: a same-page
  // hash link only updates page.url and fires no navigation callbacks.
  $effect(() => {
    if (page.url.hash === `#${id}`) untrack(() => setCollapsed(false))
  })
  onMount(() => {
    const node = root
    if (!node) return
    // A search hit inside a folded body asks it to open (revealSetting dispatches this, then waits for the row).
    const onOpen = () => setCollapsed(false)
    node.addEventListener(SUBCATEGORY_OPEN_EVENT, onOpen)
    return () => node.removeEventListener(SUBCATEGORY_OPEN_EVENT, onOpen)
  })

  // Controller headers say what is inside when the page gives no summary ("6 settings").
  let rows = $state(0)
  $effect(() => {
    void collapsed
    rows = body?.querySelectorAll('[data-setting-key]').length ?? 0
  })
  const line = $derived(subcategoryLine(summary, $settingsControllerMode, rows))
</script>

<section bind:this={root} id={id} data-settings-subcategory={id} data-collapsed={collapsed ? '' : undefined}
         aria-labelledby={`${id}-heading`} class="mb-7 scroll-mt-[calc(var(--theme-shell-top,2rem)+4rem)]">
  {#if foldable}
    <h3 id={`${id}-heading`} class="mb-2">
      <button type="button" data-focusable data-subcategory-toggle aria-expanded={!collapsed} aria-controls={`${id}-body`}
              onclick={() => setCollapsed(!collapsed)}
              class="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-sm font-semibold">
        <span class="shrink-0">{heading}</span>
        <span class="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground">{collapsed || $settingsControllerMode ? line : ''}</span>
        <ChevronDown size={16} aria-hidden="true" class="shrink-0 text-muted-foreground transition-transform {collapsed ? '' : 'rotate-180'}" />
      </button>
    </h3>
  {:else}
    <h3 id={`${id}-heading`} class="mb-2 px-1 text-sm font-semibold">{heading}</h3>
  {/if}
  <div bind:this={body} id={`${id}-body`} data-settings-subcategory-body hidden={collapsed || undefined}
       class={plain ? '' : 'relative divide-y divide-border/70 rounded-xl border border-border bg-card/25 [&>*:first-child]:rounded-t-[calc(0.75rem-1px)] [&>*:last-child]:rounded-b-[calc(0.75rem-1px)]'}>
    {@render children()}
  </div>
</section>

<style>
  /* Game mode and Android TV draw no titlebar, so under a side or bottom nav the section's sticky bar
     drops the 2rem band (SettingsSection) and a chip jump lands just as far below it as elsewhere. */
  :global(html:is(.gamemode, .tv-mode):not([data-theme-nav='top'])) section[data-settings-subcategory] { scroll-margin-top: 4rem; }
</style>
