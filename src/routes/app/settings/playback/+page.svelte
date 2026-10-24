<script lang="ts">
  import { isAndroid } from '$lib/platform'
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte'
  import SettingsSubcategory from '$lib/components/settings/SettingsSubcategory.svelte'
  // The old pages render here until their rows move into this section's subcategories.
  import PlayerPage from '../player/+page.svelte'
  import HotkeysPage from '../hotkeys/+page.svelte'
</script>

<SettingsSection section="playback">
  <SettingsSubcategory id="up-next" title="Player" plain><PlayerPage /></SettingsSubcategory>
  <!-- Keyboard shortcuts have nothing to bind on Android, and the old page sends Android back to
       /app/settings. Keyed on $isAndroid, not $isMobile: a narrow desktop window has a keyboard. -->
  {#if !$isAndroid}
    <SettingsSubcategory id="controls" title="Hotkeys" plain><HotkeysPage /></SettingsSubcategory>
  {/if}
</SettingsSection>
