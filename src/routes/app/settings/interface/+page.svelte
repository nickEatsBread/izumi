<script lang="ts">
  import { uiScale, wheelScrollAcross, dragCarousels, haptics, androidTvMode, themePreset, motionPreference, highContrast, largeInteractionTargets, type ThemePreset } from '$lib/settings/ui'
  import Toggle from '$lib/components/settings/Toggle.svelte'
  import { isAndroid, isAndroidTv, isMobile } from '$lib/platform'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import { m } from '$lib/paraglide/messages.js'

  const themes: { value: ThemePreset; label: string; background: string; surface: string; foreground: string; accent: string }[] = [
    { value: 'izumi', label: 'Izumi', background: '#09090b', surface: '#27272a', foreground: '#fafafa', accent: '#e93b69' },
    { value: 'midnight', label: 'Midnight', background: '#080b18', surface: '#1e2338', foreground: '#f2f5fb', accent: '#9b7bf7' },
    { value: 'sakura', label: 'Sakura', background: '#13080d', surface: '#302029', foreground: '#faeef3', accent: '#f47bb8' },
    { value: 'ocean', label: 'Ocean', background: '#061018', surface: '#19303d', foreground: '#eefafa', accent: '#08b6cf' },
    { value: 'light', label: 'Light', background: '#fafafa', surface: '#e7e7eb', foreground: '#121217', accent: '#be123c' },
    { value: 'system', label: 'System', background: '#f4f4f5', surface: '#18181b', foreground: '#ffffff', accent: '#e93b69' },
  ]
</script>

<div class="p-4 sm:p-8">
  <h2 data-settings-page-title class="mb-1 text-xl font-black">{m.settings_interface()}</h2>
  <p class="mb-4 text-sm text-muted-foreground">{m.settings_interface_intro()}</p>

  <div class="max-w-2xl">
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
    <a href="/app/settings/themes" data-focusable class="mb-5 flex min-h-14 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 transition hover:bg-accent">
      <span><span class="block font-black">Browse & customize themes</span><span class="text-xs text-muted-foreground">Install a theme or open Theme Studio to create your own look.</span></span>
      <span aria-hidden="true">→</span>
    </a>

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
      <div class="mb-4 space-y-3">
        <label data-setting-key="android-tv-layout" class="flex items-center justify-between gap-3 rounded-md border border-border p-3">
          <span><span class="block font-bold">Android TV layout</span><span class="text-xs text-muted-foreground">Remote-first wide navigation, larger focus rings, and ten-foot spacing. {$isAndroidTv ? 'Active now.' : 'Phone layout is active.'}</span></span>
          <SelectMenu bind:value={$androidTvMode} ariaLabel="Android TV layout" options={[
            { value: 'auto', label: 'Automatic' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' },
          ]} />
        </label>
        <Toggle label={m.settings_haptics()} desc={m.settings_haptics_hint()} value={$haptics} onToggle={() => ($haptics = !$haptics)} />
      </div>
    {/if}

    <div class="space-y-3">
      <!-- The phone layout renders at zoom 1 whatever this says (app layout), so the slider is for
           desktop, the Deck and TV only. Search hides it there too (hideOn: phone). -->
      {#if !$isMobile}
      <label data-setting-key="ui-scale" class="flex flex-col gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-3">
        <div>
          <div class="font-bold">{m.settings_ui_scale()}</div>
          <p class="mt-1 text-xs text-muted-foreground">{m.settings_ui_scale_hint()}</p>
        </div>
        <span class="flex items-center gap-3">
          <input type="range" min="0.5" max="2" step="0.1" data-focusable bind:value={$uiScale} class="ui-range h-6 w-full cursor-pointer sm:h-2 sm:w-40" />
          <span class="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{$uiScale.toFixed(1)}×</span>
        </span>
      </label>
      {/if}

      <Toggle label="Wheel-scroll carousels" desc="Let horizontal wheel and trackpad gestures scroll home rows. Vertical scrolling always moves the page. Off = use the row's ‹ › arrows." value={$wheelScrollAcross} onToggle={() => ($wheelScrollAcross = !$wheelScrollAcross)} />
      <Toggle label="Mouse-drag carousels" desc="Drag home rows sideways and swipe the featured banner to its previous or next title with the mouse." value={$dragCarousels} onToggle={() => ($dragCarousels = !$dragCarousels)} />
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
