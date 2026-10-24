<script lang="ts">
  import { isMobile } from '$lib/platform'
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte'
  import SettingsSubcategory from '$lib/components/settings/SettingsSubcategory.svelte'
  // The old pages render here until their rows move into this section's subcategories. The Interface
  // page opens with its Themes link, so Themes and Theme Studio stay one step away.
  import InterfacePage from '../interface/+page.svelte'
  import NavigationPage from '../navigation/+page.svelte'
</script>

<SettingsSection section="appearance">
  <SettingsSubcategory id="theme" title="Interface" plain><InterfacePage /></SettingsSubcategory>
  <!-- The bottom bar and top icons exist only in the phone layout; the desktop rail is fixed. -->
  {#if $isMobile}
    <SettingsSubcategory id="navigation" plain><NavigationPage /></SettingsSubcategory>
  {/if}
</SettingsSection>
