<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { developerLogging, updateChannel } from '$lib/settings/ui'
  import { isAndroid } from '$lib/platform'
  import { checkForUpdate, applyUpdate, availableUpdate, updatePhase, updateProgress, updateError } from '$lib/updater'
  import { copyToClipboard } from '$lib/util/clipboard'
  import { clearDiagnostics, diagnosticEvents, diagnosticsSnapshot } from '$lib/diagnostics'
  import { ioErrorMessage, saveTextFile } from '$lib/player/history-io'
  import { authorizeHousehold, cancelHouseholdPrompt } from '$lib/profiles/household-gate'
  import { startFactoryReset } from '$lib/storage/factory-reset'
  import { restartOnboarding } from '$lib/settings/onboarding'
  import { m } from '$lib/paraglide/messages.js'
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte'
  import SettingsSubcategory from '$lib/components/settings/SettingsSubcategory.svelte'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import SettingsChoiceRow from '$lib/components/settings/SettingsChoiceRow.svelte'
  import SettingsSwitch from '$lib/components/settings/SettingsSwitch.svelte'

  let appVersion = $state('')
  let tauriVersion = $state('')
  let mpvVersion = $state('')
  let os = $state('')
  // Steam Deck / Flatpak uses its signed OSTree repositories instead of replacing the read-only
  // app binary. It still exposes the same stable/beta preference as the desktop updater.
  let flatpak = $state(false)
  let confirmReset = $state(false)
  let resetting = $state(false)
  let resetError = $state('')
  // True while the main-PIN keypad is up on a restricted profile; a second press is ignored.
  let authorizing = false
  // Leaving the page while the keypad is still loading or up cancels it, so a PIN entered later
  // cannot start a reset from a page that is gone.
  onDestroy(cancelHouseholdPrompt)

  async function resetToDefaults() {
    if (!confirmReset || resetting || authorizing) return
    resetError = ''
    authorizing = true
    let allowed = false
    try {
      allowed = await authorizeHousehold('factory-reset')
    } finally {
      authorizing = false
    }
    if (!allowed) return
    resetting = true
    try {
      // A full navigation stops stores, workers and sync before any data is removed.
      startFactoryReset()
    } catch (error) {
      resetError = ioErrorMessage(error, 'Could not start the reset.')
      resetting = false
    }
  }

  onMount(async () => {
    try {
      const { getVersion, getTauriVersion } = await import('@tauri-apps/api/app')
      appVersion = await getVersion()
      tauriVersion = await getTauriVersion()
    } catch { /* web preview */ }
    try { flatpak = await invoke<boolean>('is_flatpak') } catch { /* not desktop */ }
    try { mpvVersion = await invoke<string>('mpv_version') } catch { /* web preview */ }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const uad = (navigator as any).userAgentData
      if (uad?.getHighEntropyValues) {
        const v = await uad.getHighEntropyValues(['platform', 'platformVersion', 'architecture'])
        os = [v.platform, v.platformVersion, v.architecture].filter(Boolean).join(' ')
      } else { os = navigator.platform }
    } catch { os = navigator.platform }
  })

  // The izumi row renders on its own (it carries the search key); these follow it.
  const rows = $derived([
    // On Android there's no libmpv row (external playback); show the runtime instead.
    ...(($isAndroid ? [['Runtime', tauriVersion || '—']] : [['Runtime', tauriVersion || '—'], ['libmpv', mpvVersion || '—']]) as [string, string][]),
    ['System', os || '—'],
  ] as [string, string][])

  // Update state lives in the shared updater facade (single source of truth with the shell toast).
  // `checking`/`checked` are UI-local: whether a manual check is in flight / has run with no result.
  let checking = $state(false)
  let checked = $state(false)
  const installing = $derived($updatePhase === 'downloading')
  // Percentage is only shown once it's real (>0); before that the label stays a bare "Downloading…"
  // instead of a stuck "0%".
  const pct = $derived(Math.round($updateProgress * 100))
  const upToDate = $derived(checked && !$availableUpdate && !$updateError)

  async function checkUpdates() {
    checking = true; checked = false
    availableUpdate.set(null); updateError.set(''); updatePhase.set('idle')
    await checkForUpdate()
    checking = false; checked = true
  }

  let diagnosticNotice = $state('')
  let openingDeveloperTools = $state(false)
  async function copyDiagnostics() {
    const report = diagnosticsSnapshot({ appVersion, tauriVersion, mpvVersion, os })
    diagnosticNotice = copyToClipboard(report) ? 'Diagnostics copied' : 'Copy failed'
  }
  async function saveDiagnostics() {
    try {
      const saved = await saveTextFile(
        `izumi-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
        diagnosticsSnapshot({ appVersion, tauriVersion, mpvVersion, os }),
      )
      if (saved) diagnosticNotice = 'Diagnostics saved'
    } catch (error) { diagnosticNotice = ioErrorMessage(error, 'Save failed') }
  }
  async function openDeveloperTools() {
    openingDeveloperTools = true
    try {
      await invoke('open_developer_tools')
      diagnosticNotice = 'Developer tools opened'
    } catch (error) {
      diagnosticNotice = ioErrorMessage(error, 'Could not open developer tools')
    } finally {
      openingDeveloperTools = false
    }
  }
</script>

{#snippet brandMark()}<img src="/brand/izumi-mark-color.svg" alt="" class="size-8" />{/snippet}
{#snippet updateControl()}
  {#if !$availableUpdate}
    <button type="button" data-focusable onclick={checkUpdates} disabled={checking}
            class="min-h-10 rounded-md bg-secondary px-4 text-sm font-bold transition hover:bg-accent disabled:opacity-60">
      {checking ? 'Checking…' : 'Check for updates'}
    </button>
  {/if}
{/snippet}
{#snippet setupControl()}
  <button type="button" data-focusable onclick={restartOnboarding} class="min-h-10 shrink-0 rounded-lg bg-secondary px-3 text-sm font-bold hover:bg-accent">{m.settings_run_setup()}</button>
{/snippet}
{#snippet resetControl()}
  {#if !confirmReset}
    <button type="button" data-focusable onclick={() => confirmReset = true}
            class="min-h-10 rounded-md border border-destructive/40 px-4 text-sm font-bold text-destructive hover:bg-destructive/10">Reset</button>
  {/if}
{/snippet}
{#snippet loggingSwitch()}
  <SettingsSwitch value={$developerLogging} onToggle={() => ($developerLogging = !$developerLogging)} label="Developer logging" interactive={false} />
{/snippet}
{#snippet diagnosticsControl()}
  <button type="button" data-focusable onclick={copyDiagnostics} class="min-h-10 rounded-md bg-secondary px-3 text-sm font-bold hover:bg-accent">Copy report</button>
  <button type="button" data-focusable onclick={saveDiagnostics} class="min-h-10 rounded-md bg-secondary px-3 text-sm font-bold hover:bg-accent">Save report</button>
  <button type="button" data-focusable onclick={() => { clearDiagnostics(); diagnosticNotice = 'Diagnostics cleared' }} class="min-h-10 rounded-md border border-border px-3 text-sm font-bold hover:bg-secondary">Clear</button>
{/snippet}
{#snippet devtoolsControl()}
  <button type="button" data-focusable onclick={openDeveloperTools} disabled={openingDeveloperTools}
          class="min-h-10 rounded-md border border-border px-3 text-sm font-bold hover:bg-secondary disabled:opacity-60">
    {openingDeveloperTools ? 'Opening…' : 'Open developer tools'}
  </button>
{/snippet}

<SettingsSection section="about">
  <SettingsSubcategory id="version">
    <SettingsRow settingKey="app-version" title="izumi" value={appVersion ? `v${appVersion}` : '—'} leading={brandMark} />
    {#each rows as [k, v] (k)}
      <SettingsRow title={k} value={v} />
    {/each}
    <SettingsRow settingKey="updates" title="Updates" description="Checked at launch and every 6 hours; nothing installs without your OK" control={updateControl} expanded={!!$availableUpdate || upToDate || !!$updateError}>
      {#if $availableUpdate}
        <div class="rounded-md border border-primary/40 bg-primary/10 p-3">
          <div class="text-sm font-bold">
            {$availableUpdate.channelSwitch
              ? `Switch to ${$availableUpdate.channelSwitch === 'beta' ? 'Beta' : 'Stable'} channel`
              : `Update available — v${$availableUpdate.version}`}
          </div>
          {#if $availableUpdate.notes}<p class="mt-1 line-clamp-4 whitespace-pre-line text-xs text-muted-foreground">{$availableUpdate.notes}</p>{/if}
          {#if flatpak}
            <p class="mt-1 text-xs text-muted-foreground">On the Steam Deck the update applies the next time you launch izumi from Steam.</p>
          {/if}
          <button type="button" data-focusable onclick={applyUpdate} disabled={installing}
                  class="mt-3 min-h-10 rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground transition disabled:opacity-60">
            {installing
              ? (flatpak ? 'Installing…' : pct > 0 ? `Downloading… ${pct}%` : 'Downloading…')
              : $availableUpdate.channelSwitch ? 'Switch channel'
                : flatpak ? 'Install update' : $isAndroid ? 'Download & install' : 'Restart & install'}
          </button>
        </div>
      {:else if upToDate}
        <p class="text-sm text-muted-foreground">On the latest {$updateChannel} build.</p>
      {/if}
      {#if $updateError}<p role="alert" class="mt-2 text-xs text-destructive">{$updateError}</p>{/if}
    </SettingsRow>
    <SettingsRow title="Documentation" description="Setup guides, including the Samsung TV companion" href="/docs" chevron />
  </SettingsSubcategory>

  <SettingsSubcategory id="changelog">
    <SettingsRow title="Changelog" description="Recent changes, straight from the commit history" href="/app/settings/about/changelog" chevron />
  </SettingsSubcategory>

  <SettingsSubcategory id="licenses">
    <SettingsRow title="License information" description="Open-source licence, data providers and acknowledgements" href="/app/settings/about/license-information" chevron />
  </SettingsSubcategory>

  <SettingsSubcategory id="reset">
    <SettingsRow settingKey="setup-assistant" title={m.settings_setup_assistant()} description={m.settings_setup_assistant_hint()} control={setupControl} />
    <SettingsRow settingKey="reset-defaults" title="Reset izumi to defaults" description="Remove all local client data and restore the default settings." control={resetControl} expanded={confirmReset}>
      <div class="rounded-md border border-destructive/40 bg-destructive/5 p-4" aria-busy={resetting}>
        <p class="text-sm font-bold">Reset izumi to defaults?</p>
        <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
          This permanently removes all profiles, sign-ins, settings, local libraries, watch history,
          extensions, device pairings, caches and downloads stored in izumi’s app folder on this device.
          Cloud data and files saved outside the app folder are kept. This cannot be undone.
        </p>
        <p class="mt-2 text-xs text-muted-foreground">{$isAndroid ? 'izumi will close. Open it again to start fresh.' : 'izumi will restart with default settings.'}</p>
        <a href="/app/settings/devices#backup" data-focusable class="mt-3 inline-block text-xs font-bold underline underline-offset-2">Export a backup first</a>
        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" data-focusable disabled={resetting} onclick={() => { confirmReset = false; resetError = '' }}
                  class="min-h-10 rounded-md border border-border px-4 text-sm font-bold hover:bg-secondary disabled:opacity-60">Cancel</button>
          <button type="button" data-focusable disabled={resetting} onclick={resetToDefaults}
                  class="min-h-10 rounded-md bg-destructive px-4 text-sm font-bold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60">
            {resetting ? 'Resetting…' : 'Delete local data & reset'}
          </button>
        </div>
        {#if resetError}<p role="alert" class="mt-2 text-xs text-destructive">{resetError}</p>{/if}
      </div>
    </SettingsRow>
  </SettingsSubcategory>

  <SettingsSubcategory id="advanced" summary="Release channel, developer logging, diagnostics, DevTools">
    <!-- Android always tracks the latest APK release. Desktop and Flatpak both support the
         persisted stable/beta channel; Flatpak maps it to its matching OSTree branch. -->
    {#if !$isAndroid}
      <SettingsChoiceRow settingKey="release-channel" title="Release channel" description="Beta receives pre-releases first." value={$updateChannel} onChange={(value) => ($updateChannel = value as 'stable' | 'beta')} options={[
        { value: 'stable', label: 'Stable' },
        { value: 'beta', label: 'Beta' },
      ]} />
      <SettingsRow settingKey="developer-logging" title="Developer logging" description="Verbose logs in DevTools; switch off after debugging" learnMore="Forward verbose frontend, native, and JVM extension-runtime events to DevTools. Logs may contain source URLs or account material." control={loggingSwitch} onActivate={() => ($developerLogging = !$developerLogging)} pressed={$developerLogging} />
    {/if}
    <SettingsRow settingKey="diagnostics-report" title="Diagnostics report" description="Latest {$diagnosticEvents.length} errors; sensitive settings are redacted" control={diagnosticsControl} controlLayout="stack" expanded={!!diagnosticNotice}>
      {#if diagnosticNotice}<p role="status" class="text-xs text-muted-foreground">{diagnosticNotice}</p>{/if}
    </SettingsRow>
    {#if !$isAndroid}
      <SettingsRow settingKey="developer-tools" title="Developer tools" description="Inspect the Console and Network panels for live errors" learnMore="Network requests can contain signed links or account tokens, so redact them before sharing screenshots or logs." control={devtoolsControl} />
    {/if}
  </SettingsSubcategory>
</SettingsSection>
