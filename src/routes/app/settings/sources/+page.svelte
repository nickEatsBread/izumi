<script lang="ts">
  import { onDestroy } from 'svelte'
  import { addonUrls } from '$lib/stremio/sources'
  import { extensionUrls, sourcePriority, sourcePriorityMode } from '$lib/settings/ui'
  import type { SourcePriorityMode } from '$lib/stremio/source-priority'
  import { defaultDiscussionPlatform } from '$lib/comments'
  import { checkExtensionUpdates } from '$lib/extensions/auto-update'
  import { trackerFeedUrls } from '$lib/extensions/tracker-feeds'
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte'
  import SettingsSubcategory from '$lib/components/settings/SettingsSubcategory.svelte'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import SettingsChoiceRow from '$lib/components/settings/SettingsChoiceRow.svelte'
  import TorrentDebridSettings from '$lib/components/settings/TorrentDebridSettings.svelte'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'

  // shortcut: counts the added URLs, not orphan packages (Manage sources loads those), count them here if the two numbers confuse people.
  const sourceCount = $derived($addonUrls.length + $trackerFeedUrls.length + $extensionUrls.length)
  const priorityValue = $derived($sourcePriority.length
    ? `${$sourcePriority.length} ${$sourcePriority.length === 1 ? 'source' : 'sources'} ordered`
    : 'Not set')
  const priorityModes: { value: SourcePriorityMode; label: string; description: string }[] = [
    { value: 'prefer', label: 'Prefer', description: 'Listed sources first, then the rest' },
    { value: 'strict', label: 'Strict', description: 'Only listed sources, even when they find nothing' },
  ]

  let checkingUpdates = $state(false)
  let updateCheckFeedback = $state('')
  let updateFeedbackTimer: ReturnType<typeof setTimeout> | undefined
  async function checkForUpdates() {
    if (checkingUpdates) return
    checkingUpdates = true
    updateCheckFeedback = ''
    if (updateFeedbackTimer) clearTimeout(updateFeedbackTimer)
    try {
      const result = await checkExtensionUpdates({
        retryAttempted: true,
        includeDisabledCatalogs: true,
      })
      if (result.reason === 'playback') updateCheckFeedback = 'Stop playback first'
      else if (result.reason === 'no-installed') updateCheckFeedback = 'Nothing installed'
      else if (result.reason === 'no-catalogs') updateCheckFeedback = 'No update source available'
      else if (result.reason === 'catalog-unavailable') updateCheckFeedback = 'Check failed'
      else if (result.updated.length && result.failed) updateCheckFeedback = `${result.updated.length} updated · ${result.failed} failed`
      else if (result.updated.length) updateCheckFeedback = `${result.updated.length} updated`
      else if (result.failed) updateCheckFeedback = 'Update failed'
      else updateCheckFeedback = 'Up to date'
    } catch {
      updateCheckFeedback = 'Check failed'
    } finally {
      checkingUpdates = false
      updateFeedbackTimer = setTimeout(() => (updateCheckFeedback = ''), 4500)
    }
  }
  onDestroy(() => {
    if (updateFeedbackTimer) clearTimeout(updateFeedbackTimer)
  })
</script>

<SettingsSection section="sources">
  <SettingsSubcategory id="my-sources">
    <SettingsRow
      title="Manage sources"
      description="Add, switch off, configure or remove sources"
      value={sourceCount ? `${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'}` : 'None yet'}
      href="/app/settings/sources/manage"
      chevron
    />
  </SettingsSubcategory>

  <SettingsSubcategory id="store">
    <SettingsRow title="Store" description="Find sources, packages and themes to install" href="/app/settings/store" chevron />
  </SettingsSubcategory>

  <SettingsSubcategory id="debrid">
    <TorrentDebridSettings />
  </SettingsSubcategory>

  <SettingsSubcategory id="discussion">
    <SettingsChoiceRow
      settingKey="default-discussion-source"
      title="Default discussion source"
      description="Where the player's discussion panel opens"
      learnMore="An embeddable source (Disqus or a forum) renders inline in the panel."
      value={$defaultDiscussionPlatform}
      options={[
        { value: 'disqus', label: 'Disqus' },
        { value: 'auto', label: 'Auto — all sources' },
        { value: 'reddit', label: 'Reddit' },
        { value: 'anilist', label: 'AniList' },
        { value: 'mal', label: 'MyAnimeList' },
        { value: 'youtube', label: 'YouTube' },
        { value: 'animecommunity', label: 'Anime Community' },
      ]}
      onChange={(value) => ($defaultDiscussionPlatform = value)}
    />
  </SettingsSubcategory>

  <SettingsSubcategory id="priority">
    <SettingsRow
      settingKey="source-priority"
      title="Source priority"
      description="Trusted sources first, within each quality tier"
      value={priorityValue}
      href="/app/settings/sources/priority"
      chevron
    />
  </SettingsSubcategory>

  <SettingsSubcategory id="advanced" summary="Priority mode, package updates">
    <SettingsChoiceRow
      settingKey="source-priority-mode"
      title="Priority mode"
      description="How the order treats sources it does not list"
      value={$sourcePriorityMode}
      options={priorityModes}
      onChange={(value) => ($sourcePriorityMode = value as SourcePriorityMode)}
    />
    <SettingsRow settingKey="package-updates" title="Package updates" description="Update installed packages from their catalogs">
      {#snippet control()}
        <button type="button" data-focusable disabled={checkingUpdates} onclick={() => void checkForUpdates()}
          class="inline-flex min-h-9 items-center gap-2 rounded-md bg-secondary px-3 text-xs font-bold transition-colors hover:bg-accent disabled:opacity-60">
          <RefreshCw size={14} class={checkingUpdates ? 'animate-spin' : ''} />
          {checkingUpdates ? 'Checking…' : updateCheckFeedback || 'Check now'}
        </button>
      {/snippet}
    </SettingsRow>
  </SettingsSubcategory>
</SettingsSection>
