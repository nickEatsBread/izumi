<script lang="ts">
  import House from '@lucide/svelte/icons/house'
  import Calendar from '@lucide/svelte/icons/calendar'
  import Search from '@lucide/svelte/icons/search'
  import Download from '@lucide/svelte/icons/download'
  import Users from '@lucide/svelte/icons/users'
  import LibraryBig from '@lucide/svelte/icons/library-big'
  import VenetianMask from '@lucide/svelte/icons/venetian-mask'
  import Settings from '@lucide/svelte/icons/settings'
  import LogIn from '@lucide/svelte/icons/log-in'
  import Play from '@lucide/svelte/icons/play'
  import Info from '@lucide/svelte/icons/info'
  import CatalogBrandLogo from '$lib/components/catalog/CatalogBrandLogo.svelte'
  import { catalogScreen } from '$lib/settings/catalog'
  import { ANILIST_HOME_ROWS, CONTINUE_HOME_ROW } from '$lib/catalog/home-options'
  import { cwSnapshot } from '$lib/player/continue-watching'
  import { banner, cardCover, resumeEp, title } from '$lib/anilist/media'
  import { resolvedThemeTokens } from '$lib/theme-tokens'
  import type { ThemePreset } from '$lib/settings/ui'

  // Home in a palette, drawn live at a 1280×800 window and scaled to fit: Sidebar's icon rail,
  // Hero's desktop banner, a Continue Watching row and a poster row, with the same classes as the
  // real components. Picking a palette drops any installed theme, so this is izumi's own layout.
  // The root is a protected surface: its `--izumi-safe-*` values become the palette inside it,
  // theme stylesheets cannot reach in, and the brand mark keeps its own colours.
  let { preset }: { preset: Exclude<ThemePreset, 'custom'> } = $props()

  const palette = $derived.by(() => {
    const tokens = resolvedThemeTokens(preset, matchMedia('(prefers-color-scheme: dark)').matches)
    const vars = Object.entries(tokens).filter(([name]) => name !== 'scheme')
      .map(([name, value]) => `--izumi-safe-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${value}`)
    return `${vars.join(';')};--radius:0.5rem;color-scheme:${tokens.scheme}`
  })

  // The user's own titles where they have some; skeletons (as Home shows while loading) otherwise.
  const entries = $derived($cwSnapshot.slice(0, 4))
  const lead = $derived(entries[0]?.media)
  const posterRow = ANILIST_HOME_ROWS.find((row) => row.id === 'season')?.title
  const rail = [House, Calendar, Search, Download, Users, LibraryBig]
  let width = $state(0)
</script>

<div bind:clientWidth={width} data-theme-protected class="relative aspect-[16/10] w-full overflow-hidden bg-background" style={palette}>
  <div class="absolute left-0 top-0 h-[800px] w-[1280px] origin-top-left overflow-hidden bg-background text-foreground" style:transform={`scale(${width / 1280})`}>
    <div class="ml-14">
      <div class="relative mb-6 h-[400px]">
        <div class="absolute -left-14 top-0 h-full w-[1280px] overflow-hidden bg-muted">
          {#if lead && banner(lead)}
            <img src={banner(lead)} alt="" class="absolute inset-0 h-full w-full object-cover" style="object-position:center 30%" />
          {:else}
            <div class="absolute inset-0 skeloader"></div>
          {/if}
          <div class="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent"></div>
          <div class="absolute inset-y-0 left-0 w-[45%] bg-gradient-to-r from-background/85 via-background/40 to-transparent"></div>
        </div>
        <div class="absolute inset-x-0 bottom-0 flex flex-col gap-3 px-8 pb-8">
          {#if lead}
            <div class="max-w-2xl">
              <p class="truncate text-4xl font-black text-white drop-shadow-[2px_2px_4px_rgba(0,0,0,.9)]">{title(lead)}</p>
              <div class="mt-4 flex items-center gap-2">
                <span class="flex items-center gap-2 rounded-md px-5 py-2 font-bold text-black shadow-lg" style:background={lead.coverImage?.color || 'hsl(346.6 79.12% 51.18%)'}><Play size={18} fill="currentColor" /> Watch Now</span>
                <span class="flex items-center gap-2 rounded-md bg-white/10 px-4 py-2 font-bold text-white"><Info size={18} /> Details</span>
              </div>
            </div>
          {:else}
            <div class="w-[34rem] space-y-4"><div class="h-10 w-4/5 rounded skeloader"></div><div class="h-4 w-2/3 rounded skeloader"></div><div class="h-4 w-full rounded skeloader"></div><div class="h-10 w-48 rounded-lg skeloader"></div></div>
          {/if}
        </div>
      </div>

      <div class="relative mb-8">
        <div class="mb-2 flex items-baseline px-8"><span class="truncate text-lg font-black">{CONTINUE_HOME_ROW.title}</span></div>
        <div class="flex gap-3 overflow-hidden px-8 pb-2">
          {#each { length: 4 } as _, index}
            {@const entry = entries[index]}
            <div class="flex w-[264px] shrink-0 flex-col">
              <div class="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
                {#if entry && (entry.media.bannerImage || cardCover(entry.media))}
                  <img src={entry.media.bannerImage || cardCover(entry.media)} alt="" class="h-full w-full object-cover" />
                {:else}
                  <div class="absolute inset-0 skeloader"></div>
                {/if}
                <div class="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent"></div>
                {#if entry}<span class="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-black">Ep {resumeEp(entry.media, entry.progress)}</span>{/if}
                <span class="absolute inset-x-0 bottom-0 h-1 bg-white/20"><span class="block h-full w-3/5 bg-theme"></span></span>
              </div>
              <div class="mt-1.5">
                {#if entry}
                  <span class="block truncate text-sm font-bold">{title(entry.media)}</span>
                  <span class="block truncate text-[0.7rem] text-muted-foreground">Episode {resumeEp(entry.media, entry.progress)}</span>
                {:else}
                  <div class="h-4 w-3/4 rounded skeloader"></div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>

      <div class="relative mb-8">
        <div class="mb-2 flex items-baseline px-8"><span class="truncate text-lg font-black">{posterRow}</span></div>
        <div class="flex gap-3 overflow-hidden px-8 pb-2">
          {#each { length: 8 } as _, index}
            {@const media = entries[index % Math.max(entries.length, 1)]?.media}
            <div class="w-[152px] shrink-0">
              <div class="relative aspect-[2/3] w-full overflow-hidden rounded-md bg-muted">
                {#if media && cardCover(media, 152)}<img src={cardCover(media, 152)} alt="" class="h-full w-full object-cover" />{:else}<div class="absolute inset-0 skeloader"></div>{/if}
              </div>
              {#if media}<div class="mt-1 line-clamp-2 text-[0.8rem] font-black leading-tight">{title(media)}</div>{/if}
            </div>
          {/each}
        </div>
      </div>
    </div>

    <div class="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-background/90 via-background/30 to-transparent"></div>
    <div class="absolute inset-y-0 left-0 flex w-14 flex-col gap-1 py-3 pt-9 drop-shadow-md">
      <div class="mb-2 flex h-10 shrink-0 items-center"><span class="ml-2 grid size-10 shrink-0 place-items-center"><CatalogBrandLogo platform={$catalogScreen} /></span></div>
      {#each rail as Icon, index}
        <span class="flex h-11 shrink-0 items-center gap-3 rounded-md pl-3 {index === 0 ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground'}"><span class="grid w-8 shrink-0 place-items-center"><Icon size={20} /></span></span>
      {/each}
      <div class="flex-1"></div>
      {#each [VenetianMask, Settings] as Icon}
        <span class="flex h-11 shrink-0 items-center gap-3 rounded-md pl-3 text-muted-foreground"><span class="grid w-8 shrink-0 place-items-center"><Icon size={20} /></span></span>
      {/each}
      <span class="mt-1 flex h-12 w-full shrink-0 items-center gap-3 rounded-md pl-3 text-muted-foreground"><span class="grid w-8 shrink-0 place-items-center"><LogIn size={20} /></span></span>
    </div>
  </div>
</div>
