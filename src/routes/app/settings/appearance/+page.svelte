<script lang="ts">
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte'
  import SettingsSubcategory from '$lib/components/settings/SettingsSubcategory.svelte'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import SettingsChoiceRow from '$lib/components/settings/SettingsChoiceRow.svelte'
  import SettingsSwitch from '$lib/components/settings/SettingsSwitch.svelte'
  import PhoneNavEditor from '$lib/components/settings/PhoneNavEditor.svelte'
  import {
    androidTvMode, dragCarousels, haptics, highContrast, largeInteractionTargets, motionPreference, themePreset, uiScale, wheelScrollAcross,
    type AndroidTvMode, type MotionPreference, type ThemePreset,
  } from '$lib/settings/ui'
  import { isAndroid, isAndroidTv, isMobile } from '$lib/platform'
  import { m } from '$lib/paraglide/messages.js'

  const presets = [
    { value: 'izumi', label: 'Izumi', description: 'Dark, rose accent' },
    { value: 'midnight', label: 'Midnight', description: 'Deep navy, violet accent' },
    { value: 'sakura', label: 'Sakura', description: 'Plum, pink accent' },
    { value: 'ocean', label: 'Ocean', description: 'Dark teal, cyan accent' },
    { value: 'light', label: 'Light', description: 'Light, crimson accent' },
    { value: 'system', label: 'System', description: 'Follows your device' },
  ]
  // Installed and Theme Studio themes set the preset to 'custom': show it, but it is chosen in Themes.
  const presetOptions = $derived($themePreset === 'custom'
    ? [...presets, { value: 'custom', label: 'Custom', description: 'From Themes or Theme Studio', disabled: true }]
    : presets)
</script>

{#snippet contrastSwitch()}<SettingsSwitch value={$highContrast} onToggle={() => ($highContrast = !$highContrast)} label={m.settings_high_contrast()} interactive={false} />{/snippet}
{#snippet targetsSwitch()}<SettingsSwitch value={$largeInteractionTargets} onToggle={() => ($largeInteractionTargets = !$largeInteractionTargets)} label={m.settings_large_targets()} interactive={false} />{/snippet}
{#snippet hapticsSwitch()}<SettingsSwitch value={$haptics} onToggle={() => ($haptics = !$haptics)} label={m.settings_haptics()} interactive={false} />{/snippet}
{#snippet wheelSwitch()}<SettingsSwitch value={$wheelScrollAcross} onToggle={() => ($wheelScrollAcross = !$wheelScrollAcross)} label="Wheel-scroll carousels" interactive={false} />{/snippet}
{#snippet dragSwitch()}<SettingsSwitch value={$dragCarousels} onToggle={() => ($dragCarousels = !$dragCarousels)} label="Mouse-drag carousels" interactive={false} />{/snippet}
{#snippet scaleControl()}
  <span class="flex w-full items-center gap-3 sm:w-auto">
    <input type="range" min="0.5" max="2" step="0.1" data-focusable bind:value={$uiScale} aria-label={m.settings_ui_scale()} class="ui-range h-6 w-full cursor-pointer sm:h-2 sm:w-40" />
    <output class="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{$uiScale.toFixed(1)}×</output>
  </span>
{/snippet}

<SettingsSection section="appearance">
  <SettingsSubcategory id="theme">
    <SettingsChoiceRow settingKey="theme-preset" title={m.settings_theme()} description={m.settings_theme_hint()} value={$themePreset} options={presetOptions} onChange={(value) => ($themePreset = value as ThemePreset)} />
    <SettingsRow title="Themes" description="Install, update and manage themes" href="/app/settings/themes" chevron />
    <SettingsRow title="Theme Studio" description="Design your own colours, type and backdrop" href="/app/settings/theme-studio" chevron />
  </SettingsSubcategory>

  <SettingsSubcategory id="accessibility">
    <SettingsChoiceRow settingKey="motion" title={m.settings_motion()} description={m.settings_motion_hint()} value={$motionPreference} onChange={(value) => ($motionPreference = value as MotionPreference)} options={[
      { value: 'system', label: m.settings_system() },
      { value: 'reduce', label: m.settings_reduced() },
      { value: 'full', label: m.settings_full() },
    ]} />
    <SettingsRow settingKey="high-contrast" title={m.settings_high_contrast()} description={m.settings_high_contrast_hint()} control={contrastSwitch} onActivate={() => ($highContrast = !$highContrast)} pressed={$highContrast} />
    <SettingsRow settingKey="larger-interaction-targets" title={m.settings_large_targets()} description={m.settings_large_targets_hint()} control={targetsSwitch} onActivate={() => ($largeInteractionTargets = !$largeInteractionTargets)} pressed={$largeInteractionTargets} />
    <!-- The phone layout renders at zoom 1 whatever this says (app layout), so the slider is for
         desktop, the Deck and TV only. Search hides it there too (hideOn: phone). -->
    {#if !$isMobile}
      <SettingsRow settingKey="ui-scale" title={m.settings_ui_scale()} description={m.settings_ui_scale_hint()} control={scaleControl} controlLayout="stack" />
    {/if}
    {#if $isAndroid}
      <SettingsRow settingKey="haptics" title={m.settings_haptics()} description={m.settings_haptics_hint()} control={hapticsSwitch} onActivate={() => ($haptics = !$haptics)} pressed={$haptics} />
    {/if}
  </SettingsSubcategory>

  {#if $isMobile}
    <SettingsSubcategory id="navigation" plain>
      <PhoneNavEditor />
    </SettingsSubcategory>
  {/if}

  {#if $isAndroid}
    <SettingsSubcategory id="tv">
      <SettingsChoiceRow
        settingKey="android-tv-layout"
        title="Android TV layout"
        description={$isAndroidTv ? 'Remote-first layout, active now' : 'Remote-first layout, phone layout active'}
        learnMore="Wide navigation, larger focus rings and ten-foot spacing for a TV remote. Automatic turns it on when izumi runs on a TV."
        value={$androidTvMode}
        onChange={(value) => ($androidTvMode = value as AndroidTvMode)}
        options={[
          { value: 'auto', label: 'Automatic' },
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ]}
      />
    </SettingsSubcategory>
  {/if}

  <SettingsSubcategory id="advanced" summary="Wheel-scroll and mouse-drag carousels">
    <SettingsRow settingKey="wheel-scroll-carousels" title="Wheel-scroll carousels" description="Sideways wheel and trackpad gestures scroll home rows" learnMore="Vertical scrolling always moves the page. Turn this off to use each row's arrows instead." control={wheelSwitch} onActivate={() => ($wheelScrollAcross = !$wheelScrollAcross)} pressed={$wheelScrollAcross} />
    <SettingsRow settingKey="mouse-drag-carousels" title="Mouse-drag carousels" description="Drag home rows and the featured banner with the mouse" control={dragSwitch} onActivate={() => ($dragCarousels = !$dragCarousels)} pressed={$dragCarousels} />
  </SettingsSubcategory>
</SettingsSection>

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
