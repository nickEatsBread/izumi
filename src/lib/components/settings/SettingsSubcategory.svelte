<script lang="ts">
  import { getContext, type Snippet } from 'svelte'
  import { page } from '$app/state'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import { SETTINGS_SECTION_CONTEXT, SUBCATEGORY_OPEN_EVENT, subcategoryDef, type SettingsSectionDef } from '$lib/settings/sections'

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
    /** Folded line text when collapsed (Advanced: "Rendering preset, mpv options, cache, +5"). */
    summary?: string
    /** Default: true when the registry marks it advanced. */
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
  const folds = $derived(collapsible ?? def?.advanced === true)
  const collapsed = $derived(folds && !open)
  let root = $state<HTMLElement>()

  // A link to #<id> unfolds it.
  $effect(() => {
    if (page.url.hash === `#${id}`) open = true
  })
  // So does a search hit inside it: revealSetting dispatches the event, then waits for the row.
  $effect(() => {
    const el = root
    if (!el) return
    const unfold = () => { open = true }
    el.addEventListener(SUBCATEGORY_OPEN_EVENT, unfold)
    return () => el.removeEventListener(SUBCATEGORY_OPEN_EVENT, unfold)
  })
</script>

<section bind:this={root} id={id} data-settings-subcategory={id} data-collapsed={collapsed ? '' : undefined}
         aria-labelledby={`${id}-heading`} class="mb-7 scroll-mt-[calc(var(--theme-shell-top,2rem)+4rem)]">
  {#if folds}
    <h3 id={`${id}-heading`} class="mb-2">
      <button type="button" data-focusable data-subcategory-toggle aria-expanded={!collapsed} aria-controls={`${id}-body`}
              onclick={() => (open = !open)}
              class="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-sm font-black">
        <span class="shrink-0">{heading}</span>
        <span class="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground">{collapsed && summary ? summary : ''}</span>
        <ChevronDown size={16} aria-hidden="true" class="shrink-0 text-muted-foreground transition-transform {collapsed ? '' : 'rotate-180'}" />
      </button>
    </h3>
  {:else}
    <h3 id={`${id}-heading`} class="mb-2 px-1 text-sm font-black">{heading}</h3>
  {/if}
  <div id={`${id}-body`} data-settings-subcategory-body hidden={collapsed || undefined}
       class={plain ? '' : 'relative divide-y divide-border/70 rounded-xl border border-border bg-card/25 [&>*:first-child]:rounded-t-[calc(0.75rem-1px)] [&>*:last-child]:rounded-b-[calc(0.75rem-1px)]'}>
    {@render children()}
  </div>
</section>

<style>
  /* Game mode and Android TV draw no titlebar, so under a side or bottom nav the section's sticky bar
     drops the 2rem band (SettingsSection) and a chip jump lands just as far below it as elsewhere. */
  :global(html:is(.gamemode, .tv-mode):not([data-theme-nav='top'])) section[data-settings-subcategory] { scroll-margin-top: 4rem; }
</style>
