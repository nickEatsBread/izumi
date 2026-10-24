<script lang="ts">
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte'
  import SettingsSubcategory from '$lib/components/settings/SettingsSubcategory.svelte'
  // The old pages render here until their rows move into this section's subcategories. The sync page
  // reads ?section=tv and ?offer= from the URL, so device-transfer links keep working here.
  import SyncPage from '../sync/+page.svelte'
  import BackupPage from '../backup/+page.svelte'
</script>

<SettingsSection section="devices">
  <SettingsSubcategory id="devices" title="Device sync" plain><SyncPage /></SettingsSubcategory>
  <SettingsSubcategory id="backup" plain><BackupPage /></SettingsSubcategory>
</SettingsSection>
