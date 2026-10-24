<script lang="ts">
  import { setContext, untrack, type Snippet } from 'svelte'
  import { isMobile } from '$lib/platform'
  import { SETTINGS_SECTION_CONTEXT, settingsSection, subcategoryDef, type SettingsSectionId } from '$lib/settings/sections'
  import { sectionIcon } from '$lib/components/settings/section-icons'
  import { trackSectionScroll, type SectionScrollState, type SectionScrollTracker } from '$lib/settings/section-scroll'

  let { section, children }: { section: SettingsSectionId; children: Snippet } = $props()

  // A section page never changes its section: read the registry entry once and hand it to the
  // SettingsSubcategory blocks below (titles, the Advanced flag).
  const def = untrack(() => settingsSection(section))
  setContext(SETTINGS_SECTION_CONTEXT, def)
  const Icon = $derived(sectionIcon(def.id))
  const titleOf = (id: string) => subcategoryDef(def.id, id)?.title ?? id

  // The chips and the sticky bar keep a long desktop page oriented. The phone page has its own
  // back-header and plain subcategory headings.
  const desktop = $derived(!$isMobile)
  let root = $state<HTMLElement>()
  let header = $state<HTMLElement>()
  let scroll = $state<SectionScrollState>({ ids: [], active: null, stuck: false })
  let tracker: SectionScrollTracker | null = null
  $effect(() => {
    if (!desktop || !root || !header) return
    const current = trackSectionScroll(root, header, (state) => { scroll = state })
    tracker = current
    return () => {
      current.destroy()
      tracker = null
    }
  })
</script>

<div bind:this={root} data-settings-section={def.id} class="p-4 sm:p-8">
  {#if desktop}
    <!-- Zero height and sticky: the bar pins to the top of the content column without taking room,
         and its top padding clears the titlebar band (--theme-shell-top). Decorative: the header
         it repeats is the page's real heading. -->
    <div class="sticky top-0 z-20 -mx-4 h-0 sm:-mx-8">
      <div data-settings-sticky data-visible={scroll.stuck ? '' : undefined} aria-hidden="true"
           class="settings-sticky absolute inset-x-0 top-0 flex items-center gap-2 border-b border-border bg-background/95 px-4 pb-2.5 text-sm backdrop-blur sm:px-8"
           style:padding-top="calc(var(--theme-shell-top, 2rem) + 0.625rem)">
        <Icon size={16} class="shrink-0 text-theme" aria-hidden="true" />
        <span class="font-medium">{def.title}</span>
        {#if scroll.active}
          <span class="text-muted-foreground">›</span>
          <span class="truncate text-muted-foreground">{titleOf(scroll.active)}</span>
        {/if}
      </div>
    </div>
  {/if}
  <div data-settings-section-body class="max-w-[880px]">
    <header bind:this={header} data-settings-section-header class="mb-5 flex items-center gap-3.5">
      <span data-part="settings.section.icon" aria-hidden="true" class="grid size-11 shrink-0 place-items-center rounded-xl bg-theme/[0.16] text-theme">
        <Icon size={22} />
      </span>
      <h2 id="settings-section-{def.id}-title" data-settings-page-title class="text-2xl font-bold tracking-tight">{def.title}</h2>
    </header>
    {#if desktop && scroll.ids.length}
      <div data-settings-chips role="group" aria-labelledby="settings-section-{def.id}-title" class="mb-7 flex flex-wrap gap-2">
        {#each scroll.ids as id (id)}
          <button type="button" data-part="chip" data-focusable data-settings-chip={id}
                  data-active={scroll.active === id ? '' : undefined}
                  aria-current={scroll.active === id ? 'location' : undefined}
                  onclick={() => tracker?.jump(id)}
                  class="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors
                    {scroll.active === id ? 'border-transparent bg-theme/[0.16] text-foreground' : 'border-border text-muted-foreground hover:bg-foreground/5 hover:text-foreground'}">
            {titleOf(id)}
          </button>
        {/each}
      </div>
    {/if}
    {@render children()}
  </div>
</div>

<style>
  /* Fades in when the header leaves and hides at once when it returns; while hidden it is out of
     hit-testing too. app.css zeroes the fade under reduced motion. */
  .settings-sticky { transition: opacity 150ms ease-out, transform 150ms ease-out; }
  .settings-sticky:not([data-visible]) { visibility: hidden; opacity: 0; transform: translateY(-0.25rem); }
  /* Game mode: the end of a CSS transition blinks on WebKitGTK and the tween promotes the bar's
     text to a soft layer (motion/gm-motion.ts), so the bar shows and hides at once. */
  :global(html.gamemode) .settings-sticky { transition: none; }
  /* The phone layout's sticky back-header already names the section (settings/+layout.svelte). */
  :global(.settings-child) [data-settings-section-header] { display: none; }
</style>
