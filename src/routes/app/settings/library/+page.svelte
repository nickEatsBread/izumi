<script lang="ts">
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte'
  import SettingsSubcategory from '$lib/components/settings/SettingsSubcategory.svelte'
  // The old pages render here until their rows move into this section's subcategories.
  import CatalogPage from '../catalog/+page.svelte'
  import HistoryPage from '../history/+page.svelte'
  import ScenesPage from '../scenes/+page.svelte'
</script>

<SettingsSection section="library">
  <SettingsSubcategory id="home" title="Catalog" plain><CatalogPage /></SettingsSubcategory>
  <SettingsSubcategory id="history" plain><HistoryPage /></SettingsSubcategory>
  <SettingsSubcategory id="scenes" plain><ScenesPage /></SettingsSubcategory>
</SettingsSection>
