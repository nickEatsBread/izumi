<script lang="ts">
  import { setContext, untrack, type Snippet } from 'svelte'
  import { SETTINGS_SECTION_CONTEXT, settingsSection, type SettingsSectionId } from '$lib/settings/sections'
  import { sectionIcon } from './section-icons'

  let { section, children }: { section: SettingsSectionId; children: Snippet } = $props()

  // A section page never changes its section: read the registry entry once and hand it to the
  // SettingsSubcategory blocks below (titles, the Advanced flag).
  const def = untrack(() => settingsSection(section))
  setContext(SETTINGS_SECTION_CONTEXT, def)
  const Icon = sectionIcon(def.id)
</script>

<div data-settings-section={def.id} class="p-4 sm:p-8">
  <header data-settings-section-header class="mb-6 flex items-center gap-3">
    <span data-part="settings.section.icon" aria-hidden="true" class="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-foreground">
      <Icon size={20} />
    </span>
    <h2 data-settings-page-title class="text-2xl font-black">{def.title}</h2>
  </header>
  <div data-settings-section-body class="max-w-[880px]">
    {@render children()}
  </div>
</div>

<style>
  /* The phone layout's sticky back-header already names the section (settings/+layout.svelte). */
  :global(.settings-child) [data-settings-section-header] { display: none; }
</style>
