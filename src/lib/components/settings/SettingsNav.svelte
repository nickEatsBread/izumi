<script lang="ts">
  import { page } from '$app/stores'
  import { isMobile } from '$lib/platform'
  import * as h from '$lib/haptics'
  import { ripple } from '$lib/actions/ripple'
  import { settingsRailHref } from '$lib/settings/hierarchy'
  import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from '$lib/settings/sections'
  import { sectionIcon } from '$lib/components/settings/section-icons'
  import { settingsControllerMode } from '$lib/settings/surface'
  import { settingsRailMarker } from '$lib/settings/rail-marker'
  import { railIndicator } from '$lib/settings/rail-indicator'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'

  // The 11 sections (settings/sections.ts), grouped for the phone index and the desktop rail alike.
  // Keyboard shortcuts and the phone bar now live inside Playback and Appearance, which gate them per
  // platform, so this list has nothing to filter.
  const groups = SETTINGS_GROUPS.map((group) => ({ ...group, items: SETTINGS_SECTIONS.filter((section) => section.group === group.id) }))
  // The lit rail item comes from the shared route table (settings/hierarchy.ts): a sub-page keeps its
  // section lit (Store → Sources and store, Themes → Appearance), and the bare /app/settings landing,
  // which renders Playback on desktop, lights Playback.
  const active = (href: string) => settingsRailHref($page.url.pathname) === href
  // The lit section, for the sliding indicator: the same rule as aria-current below.
  const litSection = $derived(SETTINGS_SECTIONS.find((section) => active(section.href))?.id ?? null)
  // Rail links keep focus through the navigation (SvelteKit's keep-focus attribute below), so a
  // controller or keyboard user stays on the rail. A pointer click (detail > 0) lets go instead: no
  // ring is left behind, and the next d-pad press starts from the rail's current item.
  function releasePointerFocus(event: MouseEvent) {
    if (event.detail > 0) (event.currentTarget as HTMLElement).blur()
  }
</script>

{#if $settingsControllerMode}
  <!-- Controller mode (spec §5.1-§5.2): NuvioTV's rail. Pills with a divider between the five groups;
       the lit item is the section in the pane, and while the rail has focus only the focused item is
       lit (app.css). The aside around it is its own d-pad region; settings/controller-zones.ts runs
       the preview, Right/A into the pane and L1/R1. -->
  <nav data-settings-rail data-nav-scroll-container data-nav-scroll-pivot="0.42"
       class="flex h-full flex-col gap-1 overflow-y-auto overscroll-contain p-1">
    {#each SETTINGS_SECTIONS as section, index (section.id)}
      {@const Icon = sectionIcon(section.id)}
      {#if index > 0 && SETTINGS_SECTIONS[index - 1].group !== section.group}
        <div role="separator" class="mx-4 my-1 h-px shrink-0 bg-border"></div>
      {/if}
      <a href={section.href} data-focusable data-section={section.id} data-group={section.group}
         title={section.title} aria-label={section.title}
         data-nav-region-default={active(section.href) ? '' : undefined}
         aria-current={active(section.href) ? 'page' : undefined}
         data-sveltekit-keepfocus
         class="flex h-12 shrink-0 items-center gap-3 rounded-full px-4 text-base transition-colors
           {active(section.href) ? 'bg-foreground/10 font-semibold text-foreground' : 'font-medium text-muted-foreground'}">
        <Icon size={18} class="shrink-0" />
        <span class="truncate">{section.railTitle}</span>
      </a>
    {/each}
  </nav>
{:else if $isMobile}
  <!-- Mobile: a vertical grouped list of chevron rows. Tapping a row navigates to its route; the
       layout shows a back-header on the child page. Vertical scroll only — no horizontal strip. -->
  <div class="space-y-4">
    {#each groups as g (g.id)}
      <div>
        <div class="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">{g.label}</div>
        <div class="overflow-hidden rounded-xl bg-secondary/40">
          {#each g.items as it (it.id)}
            {@const Icon = sectionIcon(it.id)}
            <a href={it.href} data-focusable use:ripple onclick={() => h.tap()}
               class="ripple-host flex min-h-14 items-center gap-3 border-b border-border/50 px-3 py-2.5 last:border-b-0 transition-transform active:scale-[0.985]">
              <Icon size={20} class="shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1">
                <span class="block text-[0.95rem] font-bold leading-tight">{it.title}</span>
                <span class="mt-0.5 block truncate text-xs text-muted-foreground">{it.subtitle}</span>
              </span>
              <ChevronRight size={18} class="shrink-0 text-muted-foreground" />
            </a>
          {/each}
        </div>
      </div>
    {/each}
  </div>
{:else}
  <!-- Desktop: the sections under their group labels. One indicator slides behind the current item
       (rail-indicator.ts) in the theme's marker style; hover is a faint fill and keyboard or pad
       focus the ring alone, so selected, hovered and focused never look alike. Both rails print the
       short railTitle (a remote cannot hover a cut-off name); the link's title and aria-label keep the
       full one. Anything that still wraps stays inside the 14rem column; the indicator takes its height. -->
  <nav data-settings-rail data-nav-scroll-container use:railIndicator={litSection}
       class="relative flex h-full flex-col overflow-y-auto overscroll-contain pr-1">
    <div data-part="settings.rail.indicator" data-marker={$settingsRailMarker} aria-hidden="true" hidden class="settings-rail-indicator"></div>
    {#each SETTINGS_GROUPS as group, index (group.id)}
      <div role="group" aria-labelledby="settings-rail-group-{group.id}" data-settings-rail-group={group.id} class="flex flex-col gap-1">
        <div id="settings-rail-group-{group.id}" class="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 {index ? 'pt-4' : ''}">{group.label}</div>
        {#each SETTINGS_SECTIONS.filter((section) => section.group === group.id) as it (it.id)}
          {@const Icon = sectionIcon(it.id)}
          <a href={it.href} data-focusable data-section={it.id} data-group={it.group}
             title={it.title} aria-label={it.title}
             data-nav-region-default={active(it.href) ? '' : undefined}
             aria-current={active(it.href) ? 'page' : undefined}
             data-sveltekit-keepfocus onclick={releasePointerFocus}
             class="relative flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm leading-tight transition-colors focus-visible:outline-offset-[-2px]
               {active(it.href) ? 'font-medium text-foreground' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'}">
            <Icon size={18} class={active(it.href) ? 'text-theme' : ''} aria-hidden="true" /> {it.railTitle}
          </a>
        {/each}
      </div>
    {/each}
  </nav>
{/if}

<style>
  /* The current-section marker (rail-indicator.ts positions it). It slides only once placed
     (data-animate): never on first paint, never under reduced motion. One rule per marker style. */
  .settings-rail-indicator { position: absolute; top: 0; left: 0; right: 0.25rem; border-radius: var(--radius); pointer-events: none; }
  .settings-rail-indicator:global([data-animate]) { transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1), height 200ms cubic-bezier(0.22, 1, 0.36, 1); }
  .settings-rail-indicator[data-marker='accent'] { background: hsl(var(--theme) / 0.16); box-shadow: inset 3px 0 0 hsl(var(--theme)); }
  .settings-rail-indicator[data-marker='fill'] { background: hsl(var(--secondary)); }
  .settings-rail-indicator[data-marker='bar'] { box-shadow: inset 3px 0 0 hsl(var(--theme)); }
  .settings-rail-indicator[data-marker='tile'] { background: hsl(var(--foreground)); }
  .settings-rail-indicator[data-marker='dot']::before { content: ''; position: absolute; top: 50%; left: 0.25rem; width: 0.375rem; height: 0.375rem; margin-top: -0.1875rem; border-radius: 9999px; background: hsl(var(--theme)); }
  /* The inverted tile: the current item's text and icon take the page background colour. */
  .settings-rail-indicator[data-marker='tile'] ~ div a[aria-current='page'],
  .settings-rail-indicator[data-marker='tile'] ~ div a[aria-current='page'] :global(svg) { color: hsl(var(--background)); }
</style>
