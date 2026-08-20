<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { developerLogging, updateChannel } from '$lib/settings/ui'
  import { isAndroid } from '$lib/platform'
  import { checkForUpdate, applyUpdate, availableUpdate, updatePhase, updateProgress, updateError } from '$lib/updater'
  import { copyToClipboard } from '$lib/util/clipboard'
  import { clearDiagnostics, diagnosticEvents, diagnosticsSnapshot } from '$lib/diagnostics'
  import { save } from '@tauri-apps/plugin-dialog'
  import { ioErrorMessage } from '$lib/player/history-io'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import Toggle from '$lib/components/settings/Toggle.svelte'

  let appVersion = $state('')
  let tauriVersion = $state('')
  let mpvVersion = $state('')
  let os = $state('')
  // Steam Deck / Flatpak: the in-app binary updater can't apply an update in the read-only
  // sandbox (EXDEV), so updates route to the release page there instead.
  let flatpak = $state(false)

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

  const rows = $derived([
    ['izumi', appVersion ? `v${appVersion}` : '—'],
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
      const path = await save({
        defaultPath: `izumi-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (!path) return
      await invoke('write_text_file', { path, contents: diagnosticsSnapshot({ appVersion, tauriVersion, mpvVersion, os }) })
      diagnosticNotice = 'Diagnostics saved'
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

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">About</h2>
  <p class="mb-4 text-sm text-muted-foreground">Version information.</p>

  <div class="mb-5 flex items-center gap-3">
    <img src="/brand/izumi-mark-color.svg" alt="izumi" class="h-12 w-12" />
    <div>
      <div class="text-lg font-black leading-none">izumi</div>
      <div class="mt-1 text-xs text-muted-foreground">{appVersion ? `v${appVersion}` : ''}</div>
    </div>
  </div>

  <div class="max-w-md divide-y divide-border rounded-lg border border-border">
    {#each rows as [k, v] (k)}
      <div class="flex items-center justify-between px-4 py-3 text-sm">
        <span class="text-muted-foreground">{k}</span>
        <span class="font-mono font-bold tabular-nums">{v}</span>
      </div>
    {/each}
  </div>

  <!-- Updates -->
  <div class="mt-6 max-w-md">
    <h3 class="mb-2 text-sm font-black">Updates</h3>

    <p class="mb-3 text-xs text-muted-foreground">
      izumi checks for updates at launch and every 6 hours. Nothing installs without your OK.
    </p>

    <!-- Release channel is a desktop-updater concept; the Android flow always tracks the
         latest GitHub release. -->
    {#if !$isAndroid && !flatpak}
    <label class="mb-3 flex items-center justify-between gap-4 rounded-md border border-border p-3">
      <div>
        <div class="text-sm font-bold">Release channel</div>
        <p class="mt-0.5 text-xs text-muted-foreground">Beta receives pre-releases first.</p>
      </div>
      <SelectMenu bind:value={$updateChannel} className="min-w-28" ariaLabel="Release channel" options={[
        { value: 'stable', label: 'Stable' },
        { value: 'beta', label: 'Beta' },
      ]} />
    </label>
    {/if}

    {#if $availableUpdate}
      <div class="rounded-md border border-primary/40 bg-primary/10 p-3">
        <div class="text-sm font-bold">Update available — v{$availableUpdate.version}</div>
        {#if $availableUpdate.notes}<p class="mt-1 line-clamp-4 whitespace-pre-line text-xs text-muted-foreground">{$availableUpdate.notes}</p>{/if}
        {#if flatpak}
          <p class="mt-1 text-xs text-muted-foreground">On the Steam Deck the update installs in the background and applies the next time you launch izumi from Steam.</p>
        {/if}
        <button data-focusable onclick={applyUpdate} disabled={installing}
                class="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition disabled:opacity-60">
          {installing
            ? (flatpak ? 'Installing…' : pct > 0 ? `Downloading… ${pct}%` : 'Downloading…')
            : flatpak ? 'Install update' : $isAndroid ? 'Download & install' : 'Restart & install'}
        </button>
      </div>
    {:else}
      <div class="flex items-center gap-3">
        <button data-focusable onclick={checkUpdates} disabled={checking}
                class="rounded-md bg-secondary px-4 py-2 text-sm font-bold transition hover:bg-accent disabled:opacity-60">
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
        {#if upToDate}<span class="text-sm text-muted-foreground">On the latest {$updateChannel} build.</span>{/if}
      </div>
    {/if}
    {#if $updateError}<p class="mt-2 text-xs text-destructive">{$updateError}</p>{/if}
  </div>

  <p class="mt-6 max-w-md text-xs text-muted-foreground">
    A native desktop anime client — Stremio add-on + debrid sourcing, native libmpv2 playback.
  </p>

  <div class="mt-6 max-w-md" data-setting-key="developer-tools">
    <h3 class="mb-1 text-sm font-black">Diagnostics</h3>
    <p class="mb-3 text-xs text-muted-foreground">Izumi keeps the latest {$diagnosticEvents.length} frontend errors for this session. Reports redact settings whose names look sensitive.</p>
    {#if !$isAndroid}
      <div class="mb-3">
        <Toggle
          label="Developer logging"
          desc="Forward verbose frontend, native, and JVM extension-runtime events to DevTools. Logs may contain source URLs or account material; switch this off after debugging."
          value={$developerLogging}
          onToggle={() => ($developerLogging = !$developerLogging)}
        />
      </div>
    {/if}
    <div class="flex flex-wrap gap-2">
      <button data-focusable onclick={copyDiagnostics} class="rounded-md bg-secondary px-3 py-2 text-sm font-bold hover:bg-accent">Copy report</button>
      <button data-focusable onclick={saveDiagnostics} class="rounded-md bg-secondary px-3 py-2 text-sm font-bold hover:bg-accent">Save report</button>
      <button data-focusable onclick={() => { clearDiagnostics(); diagnosticNotice = 'Diagnostics cleared' }} class="rounded-md border border-border px-3 py-2 text-sm font-bold hover:bg-secondary">Clear</button>
      {#if !$isAndroid}
        <button data-focusable onclick={openDeveloperTools} disabled={openingDeveloperTools}
                class="rounded-md border border-border px-3 py-2 text-sm font-bold hover:bg-secondary disabled:opacity-60">
          {openingDeveloperTools ? 'Opening…' : 'Open developer tools'}
        </button>
      {/if}
    </div>
    {#if !$isAndroid}
      <p class="mt-2 text-xs text-muted-foreground">Inspect the Console and Network panels for live errors. Network requests can contain signed links or account tokens, so redact them before sharing screenshots or logs.</p>
    {/if}
    {#if diagnosticNotice}<p class="mt-2 text-xs text-muted-foreground">{diagnosticNotice}</p>{/if}
  </div>
</div>
