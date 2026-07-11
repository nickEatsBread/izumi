<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { get } from 'svelte/store'
  import { updateChannel } from '$lib/settings/ui'

  let appVersion = $state('')
  let tauriVersion = $state('')
  let mpvVersion = $state('')
  let os = $state('')

  onMount(async () => {
    try {
      const { getVersion, getTauriVersion } = await import('@tauri-apps/api/app')
      appVersion = await getVersion()
      tauriVersion = await getTauriVersion()
    } catch { /* web preview */ }
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
    ['Tauri', tauriVersion || '—'],
    ['libmpv', mpvVersion || '—'],
    ['System', os || '—'],
  ] as [string, string][])

  type UpdateInfo = { version: string; current: string; notes: string | null; date: string | null }
  let checking = $state(false)
  let installing = $state(false)
  let update = $state<UpdateInfo | null>(null)
  let upToDate = $state(false)
  let updErr = $state('')

  async function checkUpdates() {
    checking = true; updErr = ''; upToDate = false; update = null
    try {
      const r = await invoke<UpdateInfo | null>('updater_check', { channel: get(updateChannel) })
      if (r) update = r
      else upToDate = true
    }
    catch (e) { updErr = String(e) }
    finally { checking = false }
  }

  async function installUpdate() {
    installing = true; updErr = ''
    try { await invoke('updater_install', { channel: get(updateChannel) }) }
    catch (e) { updErr = String(e); installing = false }
    // On success the app downloads, installs, and relaunches — nothing after runs.
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

    {#if update}
      <div class="rounded-md border border-primary/40 bg-primary/10 p-3">
        <div class="text-sm font-bold">Update available — v{update.version}</div>
        {#if update.notes}<p class="mt-1 line-clamp-4 whitespace-pre-line text-xs text-muted-foreground">{update.notes}</p>{/if}
        <button data-focusable onclick={installUpdate} disabled={installing}
                class="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition disabled:opacity-60">
          {installing ? 'Downloading…' : 'Restart & install'}
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
