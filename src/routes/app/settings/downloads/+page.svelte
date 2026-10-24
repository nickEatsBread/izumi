<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { open } from '@tauri-apps/plugin-dialog'
  import {
    downloadDir, downloadConcurrency, downloadCachedOnly, downloadQuality, downloadCodec,
    autoDownloadDelayMinutes, type Quality,
  } from '$lib/settings/ui'
  import { isAndroid } from '$lib/platform'
  import { downloads } from '$lib/downloads/store'
  import { forceOffline } from '$lib/stores/offline'
  import {
    autoDownloadRules, autoDownloadRunning, removeAutoDownloadRule, runAutoDownloadRules,
    updateAutoDownloadRule,
  } from '$lib/downloads/rules'
  import RefreshButton from '$lib/components/RefreshButton.svelte'
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte'
  import SettingsSubcategory from '$lib/components/settings/SettingsSubcategory.svelte'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import SettingsChoiceRow from '$lib/components/settings/SettingsChoiceRow.svelte'
  import SettingsSwitch from '$lib/components/settings/SettingsSwitch.svelte'
  import CacheStorageSettings from '$lib/components/settings/CacheStorageSettings.svelte'
  import Trash2 from '@lucide/svelte/icons/trash-2'

  // Desktop: native folder picker → an absolute filesystem path the reqwest downloader can write to.
  // (Android's picker returns a content:// tree URI, which the downloader can't use — so it's
  // offered on desktop only; Android downloads stay in app storage.)
  let pickMsg = $state('')
  async function browse() {
    pickMsg = ''
    try {
      const picked = await open({ directory: true, title: 'Choose download folder' })
      if (typeof picked === 'string') $downloadDir = picked
    } catch {
      pickMsg = 'Folder picker unavailable.'
    }
  }

  const fmtBytes = (n: number) => {
    if (!n) return '0 MB'
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, v = n
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
    return `${v.toFixed(1)} ${u[i]}`
  }
  const used = $derived(Object.values($downloads).filter((d) => d.status === 'done').reduce((s, d) => s + (d.bytes || 0), 0))
  let checkResult = $state('Checked')
  let checkError = $state('')
  const toggleOffline = () => ($forceOffline = !$forceOffline)
  const toggleCachedOnly = () => ($downloadCachedOnly = !$downloadCachedOnly)

  async function checkAutoDownloads() {
    checkError = ''
    try {
      const queued = await runAutoDownloadRules()
      checkResult = queued ? `${queued} queued` : 'Up to date'
      return true
    } catch (error) {
      checkError = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  onMount(async () => {
    if (!$downloadDir) { try { $downloadDir = await invoke<string>('download_dir_default') } catch { /* not in Tauri */ } }
  })
</script>

<SettingsSection section="downloads">
  <SettingsSubcategory id="offline">
    <SettingsRow
      settingKey="offline-mode"
      title="Offline mode"
      description="Only downloaded content, no network requests"
      learnMore="Turns on automatically if you open the app with no connection."
      onActivate={toggleOffline}
      pressed={$forceOffline}
    >
      {#snippet control()}
        <SettingsSwitch value={$forceOffline} onToggle={toggleOffline} label="Offline mode" interactive={false} />
      {/snippet}
    </SettingsRow>
  </SettingsSubcategory>

  <SettingsSubcategory id="folder">
    <SettingsRow
      settingKey="download-folder"
      title="Download folder"
      description={$isAndroid ? "Saved to the app's private storage on Android" : 'Absolute path, or Browse to pick one'}
      learnMore={$isAndroid
        ? "Picking a custom folder needs Android's document-provider support and isn't available yet."
        : 'Leave the default unless you want downloads on another drive.'}
      controlLayout="stack"
    >
      {#snippet control()}
        <span class="flex w-full gap-2 sm:w-80">
          <input type="text" data-focusable bind:value={$downloadDir} readonly={$isAndroid} aria-label="Download folder" placeholder="(default: app data / downloads)" class="min-w-0 flex-1 rounded-md bg-input px-3 py-2.5 text-base sm:py-2 sm:text-sm {$isAndroid ? 'text-muted-foreground' : ''}" />
          {#if !$isAndroid}<button data-focusable onclick={browse} class="shrink-0 rounded-md bg-secondary px-4 py-2 text-sm font-bold transition-colors hover:bg-accent">Browse…</button>{/if}
        </span>
      {/snippet}
    </SettingsRow>
    {#if pickMsg}<p role="alert" class="px-3 py-2 text-xs text-destructive">{pickMsg}</p>{/if}
    <SettingsChoiceRow
      settingKey="download-quality"
      title="Download quality"
      description="Falls back to the best match when none is exact"
      learnMore="Used by manual downloads and automatic new-episode downloads."
      value={$downloadQuality}
      options={[
        { value: '2160', label: '4K' }, { value: '1080', label: '1080p' },
        { value: '720', label: '720p' }, { value: '480', label: '480p' },
        { value: 'any', label: 'Any' },
      ]}
      onChange={(value) => ($downloadQuality = value as Quality)}
    />
    <SettingsRow
      settingKey="automatic-downloads"
      title="Automatic downloads"
      description="Turn on per series from its Download menu"
      learnMore="izumi checks on launch, when reconnecting and every 15 minutes while running."
    >
      {#snippet control()}
        <RefreshButton
          onRefresh={checkAutoDownloads}
          label="Check now"
          busyLabel="Checking…"
          successLabel={checkResult}
          disabled={$autoDownloadRunning}
          class="min-w-[7.5rem] shrink-0 rounded-md bg-secondary px-3 py-2 text-xs font-bold hover:bg-accent"
        />
      {/snippet}
      {#if checkError}<p role="alert" class="mb-3 text-xs text-destructive">{checkError}</p>{/if}
      {#if !$autoDownloadRules.length}
        <p class="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No series enabled. Open a series, choose Download…, then turn on “Auto-download new episodes”.</p>
      {:else}
        <div class="space-y-2">
          {#each $autoDownloadRules as rule (rule.id)}
            <div class="flex flex-wrap items-center gap-3 rounded-md bg-secondary/50 p-3 sm:p-2.5">
              {#if rule.poster}<img src={rule.poster} alt="" loading="lazy" decoding="async" class="h-12 w-9 rounded object-cover" />{/if}
              <div class="min-w-0 flex-1"><div class="truncate text-sm font-bold">{rule.title}</div><div class="text-xs text-muted-foreground">Waiting for episode {rule.nextEpisode}{rule.lastError ? ` · ${rule.lastError}` : ''}</div></div>
              <label data-touch-target class="inline-flex items-center gap-1 py-2 text-xs font-bold sm:py-0"><input data-focusable type="checkbox" checked={rule.enabled} onchange={(e) => updateAutoDownloadRule(rule.id, { enabled: e.currentTarget.checked })} /> Enabled</label>
              <button data-focusable aria-label={`Remove ${rule.title}`} data-touch-target onclick={() => removeAutoDownloadRule(rule.id)} class="grid size-10 place-items-center rounded-md text-destructive hover:bg-accent sm:size-9"><Trash2 size={16} /></button>
            </div>
          {/each}
        </div>
      {/if}
    </SettingsRow>
  </SettingsSubcategory>

  <SettingsSubcategory id="storage">
    <SettingsRow settingKey="storage-used" title="Storage used" description="Space taken by finished downloads" value={fmtBytes(used)} />
    <CacheStorageSettings />
  </SettingsSubcategory>

  <SettingsSubcategory id="advanced" summary="Simultaneous downloads, new-episode delay, codec, +1">
    <SettingsChoiceRow
      settingKey="simultaneous-downloads"
      title="Simultaneous downloads"
      description="1–2 recommended (debrid CDN + disk)."
      value={String($downloadConcurrency)}
      options={[
        { value: '1', label: '1' }, { value: '2', label: '2' },
        { value: '3', label: '3' }, { value: '4', label: '4' },
      ]}
      onChange={(value) => ($downloadConcurrency = Number(value))}
    />
    <SettingsRow settingKey="new-episode-delay" title="New-episode delay" description="Wait after the scheduled air time before looking for a release.">
      {#snippet control()}
        <span class="flex items-center gap-2">
          <input data-focusable type="number" min="0" max="1440" aria-label="New-episode delay in minutes" bind:value={$autoDownloadDelayMinutes} class="w-20 rounded-md bg-input px-3 py-2.5 text-right text-base sm:py-2 sm:text-sm" />
          <span class="text-sm text-muted-foreground">min</span>
        </span>
      {/snippet}
    </SettingsRow>
    <SettingsChoiceRow
      settingKey="download-codec"
      title="Download codec"
      value={$downloadCodec}
      options={[
        { value: 'any', label: 'Any' }, { value: 'h264', label: 'H.264' },
        { value: 'h265', label: 'H.265 / HEVC' }, { value: 'av1', label: 'AV1' },
      ]}
      onChange={(value) => ($downloadCodec = value as 'any' | 'h264' | 'h265' | 'av1')}
    />
    <SettingsRow
      settingKey="only-download-cached-sources"
      title="Only download cached sources"
      description="Require a source your debrid service already has"
      onActivate={toggleCachedOnly}
      pressed={$downloadCachedOnly}
    >
      {#snippet control()}
        <SettingsSwitch value={$downloadCachedOnly} onToggle={toggleCachedOnly} label="Only download cached sources" interactive={false} />
      {/snippet}
    </SettingsRow>
  </SettingsSubcategory>
</SettingsSection>
