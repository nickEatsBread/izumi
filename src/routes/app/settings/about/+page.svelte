<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { updateChannel, autoUpdateCheck } from '$lib/settings/ui'
  import { isAndroid } from '$lib/platform'
  import { checkForUpdate, applyUpdate, availableUpdate, updatePhase, updateError } from '$lib/updater'
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
  const upToDate = $derived(checked && !$availableUpdate && !$updateError)

  async function checkUpdates() {
    checking = true; checked = false
    availableUpdate.set(null); updateError.set(''); updatePhase.set('idle')
    await checkForUpdate()
    checking = false; checked = true
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

    <div class="mb-3">
      <Toggle
        label="Auto-check for updates"
        desc="Check at launch and every 6 hours. Updates never install without your OK."
        value={$autoUpdateCheck}
        onToggle={() => ($autoUpdateCheck = !$autoUpdateCheck)}
      />
    </div>

    <!-- Release channel is a desktop-updater concept; the Android flow always tracks the
         latest GitHub release. -->
    {#if !$isAndroid && !flatpak}
    <label class="mb-3 flex items-center justify-between gap-4 rounded-md border border-border p-3">
      <div>
        <div class="text-sm font-bold">Release channel</div>
        <p class="mt-0.5 text-xs text-muted-foreground">Beta receives pre-releases first.</p>
      </div>
      <select data-focusable bind:value={$updateChannel} class="rounded-md bg-input px-3 py-2 text-sm">
        <option value="stable">Stable</option>
        <option value="beta">Beta</option>
      </select>
    </label>
    {/if}

    {#if $availableUpdate}
      <div class="rounded-md border border-primary/40 bg-primary/10 p-3">
        <div class="text-sm font-bold">Update available — v{$availableUpdate.version}</div>
        {#if $availableUpdate.notes}<p class="mt-1 line-clamp-4 whitespace-pre-line text-xs text-muted-foreground">{$availableUpdate.notes}</p>{/if}
        {#if flatpak}
          <p class="mt-1 text-xs text-muted-foreground">On the Steam Deck, download the new <span class="font-bold">.flatpak</span> from the release page and reinstall it (the app can't replace itself inside the Flatpak sandbox).</p>
        {/if}
        <button data-focusable onclick={applyUpdate} disabled={installing}
                class="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition disabled:opacity-60">
          {installing ? (flatpak ? 'Opening…' : 'Downloading…') : flatpak ? 'Open release page' : $isAndroid ? 'Download & install' : 'Restart & install'}
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
</div>
