<script lang="ts">
  import { page } from '$app/stores'
  import { isMobile } from '$lib/platform'
  import * as h from '$lib/haptics'
  import { ripple } from '$lib/actions/ripple'
  import { settingsRailHref } from '$lib/settings/hierarchy'
  import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from '$lib/settings/sections'
  import { sectionIcon } from './section-icons'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'

  // The 11 sections (settings/sections.ts): grouped for the phone index, flat in rail order on
  // desktop. Keyboard shortcuts and the phone bar now live inside Playback and Appearance, which gate
  // them per platform, so this list has nothing to filter.
  const groups = SETTINGS_GROUPS.map((group) => ({ ...group, items: SETTINGS_SECTIONS.filter((section) => section.group === group.id) }))
  // The lit rail item comes from the shared route table (settings/hierarchy.ts): a sub-page keeps its
  // section lit (Store → Sources and store, Themes → Appearance), and the bare /app/settings landing,
  // which renders Playback on desktop, lights Playback.
  const active = (href: string) => settingsRailHref($page.url.pathname) === href
  // Rail links keep focus through the navigation (SvelteKit's keep-focus attribute below), so a
  // controller or keyboard user stays on the rail. A pointer click (detail > 0) lets go instead: no
  // ring is left behind, and the next d-pad press starts from the rail's current item.
  function releasePointerFocus(event: MouseEvent) {
    if (event.detail > 0) (event.currentTarget as HTMLElement).blur()
  }
</script>

{#if $isMobile}
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
  <!-- Desktop: the vertical rail. Long titles wrap inside the 14rem column instead of overflowing it. -->
  <nav data-settings-rail data-nav-scroll-container class="flex h-full flex-col gap-1 overflow-y-auto overscroll-contain pr-1">
    {#each SETTINGS_SECTIONS as it (it.id)}
      {@const Icon = sectionIcon(it.id)}
      <a href={it.href} data-focusable data-section={it.id} data-group={it.group}
         data-nav-region-default={active(it.href) ? '' : undefined}
         aria-current={active(it.href) ? 'page' : undefined}
         data-sveltekit-keepfocus onclick={releasePointerFocus}
         class="flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm font-bold leading-tight transition-colors
           {active(it.href) ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'}">
        <Icon size={18} class="shrink-0" /> {it.title}
      </a>
    {/each}
  </nav>
{/if}
