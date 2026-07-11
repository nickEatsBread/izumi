<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { get } from 'svelte/store'
  import { updateChannel } from '$lib/settings/ui'
  import { isAndroid } from '$lib/platform'
  import { checkAndroidUpdate, downloadAndInstall, type UpdateInfo as AndroidUpdate } from '$lib/updater/android'

  const RELEASES_URL = 'https://github.com/nickEatsBread/izumi/releases/latest'

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

  type UpdateInfo = { version: string; current: string; notes: string | null; date: string | null }
  let checking = $state(false)
  let installing = $state(false)
  let update = $state<UpdateInfo | null>(null)   // desktop updater result
  let aUpdate = $state<AndroidUpdate | null>(null) // Android updater result
  let upToDate = $state(false)
  let updErr = $state('')

  async function checkUpdates() {
    checking = true; updErr = ''; upToDate = false; update = null; aUpdate = null
    try {
      if (get(isAndroid)) {
        const r = await checkAndroidUpdate()
        if (r) aUpdate = r
        else upToDate = true
      } else {
        const r = await invoke<UpdateInfo | null>('updater_check', { channel: get(updateChannel) })
        if (r) update = r
        else upToDate = true
      }
    }
    catch (e) { updErr = String(e) }
    finally { checking = false }
  }

  async function installUpdate() {
    installing = true; updErr = ''
    try {
      if (flatpak) {
        // Steam Deck: a Flatpak can't binary-swap itself (read-only sandbox → EXDEV). Send the
        // user to the release page to download + reinstall the new .flatpak.
        await openUrl(RELEASES_URL)
        installing = false
      } else if (get(isAndroid)) {
        // Downloads the APK + opens the system installer (the OS prompts to confirm).
        if (aUpdate) await downloadAndInstall(aUpdate)
        installing = false
      } else {
        await invoke('updater_install', { channel: get(updateChannel) })
        // Desktop: on success the app downloads, installs, and relaunches — nothing after runs.
      }
    }
    catch (e) { updErr = String(e); installing = false }
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

    {#if update || aUpdate}
      {@const ver = update?.version ?? aUpdate?.version}
      {@const notes = update?.notes ?? aUpdate?.notes}
      <div class="rounded-md border border-primary/40 bg-primary/10 p-3">
        <div class="text-sm font-bold">Update available — v{ver}</div>
        {#if notes}<p class="mt-1 line-clamp-4 whitespace-pre-line text-xs text-muted-foreground">{notes}</p>{/if}
        {#if flatpak}
          <p class="mt-1 text-xs text-muted-foreground">On the Steam Deck, download the new <span class="font-bold">.flatpak</span> from the release page and reinstall it (the app can't replace itself inside the Flatpak sandbox).</p>
        {/if}
        <button data-focusable onclick={installUpdate} disabled={installing}
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
    {#if updErr}<p class="mt-2 text-xs text-destructive">{updErr}</p>{/if}
  </div>

  <p class="mt-6 max-w-md text-xs text-muted-foreground">
    A native desktop anime client — Stremio add-on + debrid sourcing, native libmpv2 playback.
  </p>
</div>
