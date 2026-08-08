<script lang="ts">
  import { episodeLayout, browseLayout, hideSpoilers, absoluteEpisodeNumbers, uiScale, showAdult, wheelScrollAcross, scheduleLayout, scheduleDefaultTab, scheduleStickyHeader, scheduleShowNextUp, haptics, cwDismissAction, DEFAULT_HOME_ROWS, hiddenHomeRows, homeRowOrder, airingNotifications, airingNotificationLeadMinutes, themePreset, motionPreference, highContrast, largeInteractionTargets, type EpisodeLayout, type BrowseLayout, type ScheduleLayout, type ScheduleTab, type CwDismissAction, type ThemePreset } from '$lib/settings/ui'
  import Toggle from '$lib/components/settings/Toggle.svelte'
  import { isAndroid } from '$lib/platform'
  import { setAiringNotificationsEnabled } from '$lib/notifications/airing'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import { m } from '$lib/paraglide/messages.js'
  import { getLocale, setLocale, type Locale } from '$lib/paraglide/runtime.js'

  const locale = getLocale()
  const changeLocale = (value: string) => setLocale(value as Locale)

  let notificationError = $state('')
  async function toggleAiringNotifications() {
    notificationError = ''
    const enabled = await setAiringNotificationsEnabled(!$airingNotifications)
    if (!enabled) notificationError = m.settings_notification_permission_error()
  }

  const cwActions: { value: CwDismissAction; label: string; hint: string }[] = [
    { value: 'none', label: 'Do nothing', hint: 'Just hide it from the row.' },
    { value: 'paused', label: 'Set On Hold', hint: 'Also move it to On Hold / Paused on your tracker.' },
    { value: 'dropped', label: 'Set Dropped', hint: 'Also mark it Dropped on your tracker.' },
  ]

  const layouts: { value: EpisodeLayout; label: string; hint: string }[] = [
    { value: 'cards', label: 'Cards', hint: 'Thumbnails, titles, ratings and a watch-progress bar.' },
    { value: 'compact', label: 'Compact', hint: 'Simple text rows — denser, lighter on data.' },
    { value: 'grid', label: 'Numbers', hint: 'Dense number tiles for browsing long-runners at a glance.' },
  ]

  const browseLayouts: { value: BrowseLayout; label: string; hint: string }[] = [
    { value: 'grid', label: 'Grid', hint: 'Cover-art tiles, three across.' },
    { value: 'list', label: 'List', hint: 'A vertical list of compact rows — small cover, title and meta. Denser, text-forward.' },
  ]

  const scheduleLayouts: { value: ScheduleLayout; label: string; hint: string }[] = [
    { value: 'agenda', label: 'Agenda', hint: 'One long list — each day is a full-width section. Big and easy to read.' },
    { value: 'days', label: 'Day at a time', hint: 'Tabs across the top; one day shown large. Matches the Deck view.' },
  ]

  const scheduleTabs: { value: ScheduleTab; label: string; hint: string }[] = [
    { value: 'schedule', label: 'Schedule', hint: 'The weekly airing calendar.' },
    { value: 'watchlist', label: 'Watchlist', hint: 'Your watching list — shows with new episodes first.' },
  ]
  const themes: { value: ThemePreset; label: string; background: string; surface: string; foreground: string; accent: string }[] = [
    { value: 'izumi', label: 'Izumi', background: '#09090b', surface: '#27272a', foreground: '#fafafa', accent: '#e93b69' },
    { value: 'midnight', label: 'Midnight', background: '#080b18', surface: '#1e2338', foreground: '#f2f5fb', accent: '#9b7bf7' },
    { value: 'sakura', label: 'Sakura', background: '#13080d', surface: '#302029', foreground: '#faeef3', accent: '#f47bb8' },
    { value: 'ocean', label: 'Ocean', background: '#061018', surface: '#19303d', foreground: '#eefafa', accent: '#08b6cf' },
    { value: 'light', label: 'Light', background: '#fafafa', surface: '#e7e7eb', foreground: '#121217', accent: '#be123c' },
    { value: 'system', label: 'System', background: '#f4f4f5', surface: '#18181b', foreground: '#ffffff', accent: '#e93b69' },
  ]
  const rowLabels: Record<string, string> = {
    continue: 'Continue Watching', list: 'Your List', recommendations: 'Recommended for You',
    season: 'Popular This Season', trending: 'Trending Now', popular: 'All Time Popular',
    romance: 'Romance', action: 'Action', fantasy: 'Fantasy',
  }
  const orderedRows = $derived([
    ...$homeRowOrder.filter((id) => DEFAULT_HOME_ROWS.includes(id as never)),
    ...DEFAULT_HOME_ROWS.filter((id) => !$homeRowOrder.includes(id)),
  ])
  function moveRow(id: string, direction: -1 | 1) {
    const order = [...orderedRows]
    const index = order.indexOf(id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= order.length) return
    ;[order[index], order[target]] = [order[target], order[index]]
    $homeRowOrder = order
  }
  function toggleRow(id: string) {
    $hiddenHomeRows = $hiddenHomeRows.includes(id)
      ? $hiddenHomeRows.filter((row) => row !== id)
      : [...$hiddenHomeRows, id]
  }
</script>

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">{m.settings_interface()}</h2>
  <p class="mb-4 text-sm text-muted-foreground">{m.settings_interface_intro()}</p>

  <div class="max-w-2xl">
    <label class="mb-5 flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <span><span class="block font-bold">{m.settings_language()}</span><span class="text-xs text-muted-foreground">{m.settings_language_hint()}</span></span>
      <SelectMenu value={locale} onChange={changeLocale} ariaLabel={m.settings_language()} options={[
        { value: 'en', label: m.language_english() }, { value: 'ja', label: m.language_japanese() },
      ]} />
    </label>

    <h3 class="mb-1 text-sm font-black">{m.settings_theme()}</h3>
    <p class="mb-2 text-xs text-muted-foreground">{m.settings_theme_hint()}</p>
    <div class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {#each themes as theme (theme.value)}
        <button data-focusable onclick={() => ($themePreset = theme.value)} aria-pressed={$themePreset === theme.value}
          class="flex min-w-0 items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors {$themePreset === theme.value ? 'border-theme ring-1 ring-theme/30' : 'border-border hover:bg-secondary'}">
          <span class="relative h-10 w-14 shrink-0 overflow-hidden rounded-md border border-black/20 shadow-sm" style={`background:${theme.background}`}>
            <span class="absolute inset-x-1.5 bottom-1.5 h-4 rounded-sm" style={`background:${theme.surface}`}></span>
            <span class="absolute left-2 top-2 h-1 w-5 rounded-full" style={`background:${theme.foreground}`}></span>
            <span class="absolute bottom-2 right-2 size-2.5 rounded-full" style={`background:${theme.accent}`}></span>
          </span>
          <span class="min-w-0 flex-1 font-bold">{theme.label}</span>
          {#if $themePreset === theme.value}<span class="size-2 shrink-0 rounded-full bg-theme" aria-hidden="true"></span>{/if}
        </button>
      {/each}
    </div>

    <div class="mb-5 space-y-3">
      <label class="flex items-center justify-between gap-3 rounded-md border border-border p-3">
        <span><span class="block font-bold">{m.settings_motion()}</span><span class="text-xs text-muted-foreground">{m.settings_motion_hint()}</span></span>
        <SelectMenu bind:value={$motionPreference} ariaLabel={m.settings_motion()} options={[
          { value: 'system', label: m.settings_system() }, { value: 'reduce', label: m.settings_reduced() }, { value: 'full', label: m.settings_full() },
        ]} />
      </label>
      <Toggle label={m.settings_high_contrast()} desc={m.settings_high_contrast_hint()} value={$highContrast} onToggle={() => ($highContrast = !$highContrast)} />
      <Toggle label={m.settings_large_targets()} desc={m.settings_large_targets_hint()} value={$largeInteractionTargets} onToggle={() => ($largeInteractionTargets = !$largeInteractionTargets)} />
    </div>

    {#if $isAndroid}
      <div class="mb-4">
        <Toggle label={m.settings_haptics()} desc={m.settings_haptics_hint()} value={$haptics} onToggle={() => ($haptics = !$haptics)} />
      </div>
    {/if}

    <p class="mb-1 text-sm font-bold">{m.settings_episode_layout()}</p>
    <div class="mb-4 grid gap-2 sm:grid-cols-2">
      {#each layouts as opt (opt.value)}
        <button
          data-focusable
          onclick={() => ($episodeLayout = opt.value)}
          aria-pressed={$episodeLayout === opt.value}
          class="rounded-md border p-3 text-left transition-colors
            {$episodeLayout === opt.value ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary'}"
        >
          <div class="flex items-center justify-between">
            <span class="font-bold">{opt.label}</span>
            {#if $episodeLayout === opt.value}<span class="text-xs font-bold text-primary">{m.settings_selected()}</span>{/if}
          </div>
          <p class="mt-1 text-xs text-muted-foreground">{opt.hint}</p>
        </button>
      {/each}
    </div>

    <p class="mb-1 text-sm font-bold">{m.settings_browse_layout()}</p>
    <div class="mb-4 grid gap-2 sm:grid-cols-2">
      {#each browseLayouts as opt (opt.value)}
        <button
          data-focusable
          onclick={() => ($browseLayout = opt.value)}
          aria-pressed={$browseLayout === opt.value}
          class="rounded-md border p-3 text-left transition-colors
            {$browseLayout === opt.value ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary'}"
        >
          <div class="flex items-center justify-between">
            <span class="font-bold">{opt.label}</span>
            {#if $browseLayout === opt.value}<span class="text-xs font-bold text-primary">{m.settings_selected()}</span>{/if}
          </div>
          <p class="mt-1 text-xs text-muted-foreground">{opt.hint}</p>
        </button>
      {/each}
    </div>

    <p class="mb-1 text-sm font-bold">{m.settings_schedule_layout()} <span class="font-normal text-muted-foreground">({m.settings_desktop()})</span></p>
    <div class="mb-4 grid gap-2 sm:grid-cols-2">
      {#each scheduleLayouts as opt (opt.value)}
        <button
          data-focusable
          onclick={() => ($scheduleLayout = opt.value)}
          aria-pressed={$scheduleLayout === opt.value}
          class="rounded-md border p-3 text-left transition-colors
            {$scheduleLayout === opt.value ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary'}"
        >
          <div class="flex items-center justify-between">
            <span class="font-bold">{opt.label}</span>
            {#if $scheduleLayout === opt.value}<span class="text-xs font-bold text-primary">{m.settings_selected()}</span>{/if}
          </div>
          <p class="mt-1 text-xs text-muted-foreground">{opt.hint}</p>
        </button>
      {/each}
    </div>

    <p class="mb-1 text-sm font-bold">{m.settings_schedule_default_tab()}</p>
    <div class="mb-4 grid gap-2 sm:grid-cols-2">
      {#each scheduleTabs as opt (opt.value)}
        <button
          data-focusable
          onclick={() => ($scheduleDefaultTab = opt.value)}
          aria-pressed={$scheduleDefaultTab === opt.value}
          class="rounded-md border p-3 text-left transition-colors
            {$scheduleDefaultTab === opt.value ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary'}"
        >
          <div class="flex items-center justify-between">
            <span class="font-bold">{opt.label}</span>
            {#if $scheduleDefaultTab === opt.value}<span class="text-xs font-bold text-primary">{m.settings_selected()}</span>{/if}
          </div>
          <p class="mt-1 text-xs text-muted-foreground">{opt.hint}</p>
        </button>
      {/each}
    </div>

    <div class="mb-4 space-y-3">
      <Toggle label="Pin schedule header" desc="Keep the Schedule/Watchlist tabs, week navigation, and My Shows / All toggle stuck to the top while scrolling the schedule. Off = the header scrolls away with the list (default on Android; ignored in Game mode)." value={$scheduleStickyHeader} onToggle={() => ($scheduleStickyHeader = !$scheduleStickyHeader)} />
      <Toggle label={'Show "Next up" on the schedule'} desc="The strip of soonest episodes above the schedule grid." value={$scheduleShowNextUp} onToggle={() => ($scheduleShowNextUp = !$scheduleShowNextUp)} />
    </div>

    <p class="mb-1 text-sm font-bold">{m.settings_home_rows()}</p>
    <p class="mb-2 text-xs text-muted-foreground">Reorder or hide carousel rows. Recommendations use the shows on your connected AniList account.</p>
    <div class="mb-4 divide-y divide-border overflow-hidden rounded-md border border-border">
      {#each orderedRows as id, index (id)}
        {@const hidden = $hiddenHomeRows.includes(id)}
        <div class="flex items-center gap-2 px-3 py-2">
          <button data-focusable disabled={index === 0} onclick={() => moveRow(id, -1)} aria-label={`Move ${rowLabels[id]} up`} class="rounded px-2 py-1 font-bold disabled:opacity-25 hover:bg-secondary">↑</button>
          <button data-focusable disabled={index === orderedRows.length - 1} onclick={() => moveRow(id, 1)} aria-label={`Move ${rowLabels[id]} down`} class="rounded px-2 py-1 font-bold disabled:opacity-25 hover:bg-secondary">↓</button>
          <span class="min-w-0 flex-1 font-semibold" class:opacity-50={hidden}>{rowLabels[id]}</span>
          <button data-focusable onclick={() => toggleRow(id)} aria-pressed={!hidden} class="rounded-md border border-border px-3 py-1 text-xs font-bold hover:bg-secondary">
            {hidden ? m.settings_show() : m.settings_hide()}
          </button>
        </div>
      {/each}
    </div>

    <p class="mb-1 text-sm font-bold">Remove from Continue Watching</p>
    <p class="mb-2 text-xs text-muted-foreground">
      Press <kbd class="rounded bg-secondary px-1.5 py-0.5 font-mono text-[0.7rem] font-bold">D</kbd> while hovering (or selecting) a series in the Continue Watching row to remove it. This can also update your tracker:
    </p>
    <div class="mb-4 grid gap-2 sm:grid-cols-3">
      {#each cwActions as opt (opt.value)}
        <button
          data-focusable
          onclick={() => ($cwDismissAction = opt.value)}
          aria-pressed={$cwDismissAction === opt.value}
          class="rounded-md border p-3 text-left transition-colors
            {$cwDismissAction === opt.value ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary'}"
        >
          <div class="flex items-center justify-between">
            <span class="font-bold">{opt.label}</span>
            {#if $cwDismissAction === opt.value}<span class="text-xs font-bold text-primary">{m.settings_selected()}</span>{/if}
          </div>
          <p class="mt-1 text-xs text-muted-foreground">{opt.hint}</p>
        </button>
      {/each}
    </div>

    <div class="space-y-3">
      <div data-setting-key="airing-notifications">
        <Toggle label={m.settings_notifications()} desc={m.settings_notifications_hint()} value={$airingNotifications} onToggle={toggleAiringNotifications} />
        {#if $airingNotifications}
          <label class="mt-2 flex items-center justify-between gap-3 pl-3 text-sm">
            <span class="font-bold">{m.settings_notify_me()}</span>
            <SelectMenu value={String($airingNotificationLeadMinutes)} onChange={(value) => ($airingNotificationLeadMinutes = Number(value))} ariaLabel={m.settings_notify_me()} options={[
              { value: '0', label: m.settings_when_it_airs() },
              { value: '10', label: m.settings_minutes_before({ minutes: 10 }) },
              { value: '30', label: m.settings_minutes_before({ minutes: 30 }) },
              { value: '60', label: m.settings_hour_before() },
            ]} />
          </label>
        {/if}
        {#if notificationError}<p role="alert" class="mt-1 text-xs text-amber-400">{notificationError}</p>{/if}
      </div>
      <label class="flex items-center justify-between rounded-md border border-border p-3">
        <div>
          <div class="font-bold">{m.settings_ui_scale()}</div>
          <p class="mt-1 text-xs text-muted-foreground">{m.settings_ui_scale_hint()}</p>
        </div>
        <span class="flex items-center gap-3">
          <input type="range" min="0.5" max="2" step="0.1" data-focusable bind:value={$uiScale} class="ui-range h-2 w-40 cursor-pointer" />
          <span class="w-10 text-right text-sm tabular-nums text-muted-foreground">{$uiScale.toFixed(1)}×</span>
        </span>
      </label>

      <Toggle label="Series-wide episode numbers" desc="Number episodes by their position in the whole series instead of the current season, where the two differ (episode 5 of a second season shows as A29). Affects the labels only — playback, downloads and tracking are unchanged." value={$absoluteEpisodeNumbers} onToggle={() => ($absoluteEpisodeNumbers = !$absoluteEpisodeNumbers)} />
      <Toggle label={m.settings_hide_spoilers()} desc={m.settings_hide_spoilers_hint()} value={$hideSpoilers} onToggle={() => ($hideSpoilers = !$hideSpoilers)} />
      <Toggle label={m.settings_show_adult()} desc={m.settings_show_adult_hint()} value={$showAdult} onToggle={() => ($showAdult = !$showAdult)} />
      <Toggle label="Wheel-scroll carousels" desc="Let the mouse wheel scroll home rows sideways. Off = use the row's ‹ › arrows." value={$wheelScrollAcross} onToggle={() => ($wheelScrollAcross = !$wheelScrollAcross)} />
    </div>
  </div>
</div>

<style>
  .ui-range {
    -webkit-appearance: none;
    appearance: none;
    border-radius: 9999px;
    background: rgb(255 255 255 / 0.18);
  }
  .ui-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    height: 1rem;
    width: 1rem;
    border-radius: 9999px;
    background: hsl(346.6 79.12% 51.18%);
    border: 2px solid #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.5);
  }
  .ui-range::-moz-range-thumb {
    height: 1rem;
    width: 1rem;
    border: 2px solid #fff;
    border-radius: 9999px;
    background: hsl(346.6 79.12% 51.18%);
  }
</style>
