<script lang="ts">
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte'
  import SettingsSubcategory from '$lib/components/settings/SettingsSubcategory.svelte'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
</script>

<!-- The language rows still live on the pages these link to, until they move here. -->
<SettingsSection section="languages">
  <SettingsSubcategory id="app">
    <SettingsRow title="App and title language" description="Interface language and how titles are written" href="/app/settings/appearance?setting=app-language" chevron />
  </SettingsSubcategory>
  <SettingsSubcategory id="playback">
    <SettingsRow title="Audio and subtitle language" description="Preferred audio track and default subtitles" href="/app/settings/playback" chevron />
  </SettingsSubcategory>
  <SettingsSubcategory id="sources">
    <SettingsRow title="Source languages" description="Languages and audio your sources should offer" href="/app/settings/sources?tab=manage" chevron />
  </SettingsSubcategory>
  <SettingsSubcategory id="downloads">
    <SettingsRow title="Download audio" description="Sub, dub or either for downloaded episodes" href="/app/settings/downloads" chevron />
  </SettingsSubcategory>
</SettingsSection>
