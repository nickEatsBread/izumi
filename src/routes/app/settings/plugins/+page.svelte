<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'
  import ShieldCheck from '@lucide/svelte/icons/shield-check'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import SettingsSwitch from '$lib/components/settings/SettingsSwitch.svelte'
  import { SCOPE_TEXT, type PluginSetting } from '$lib/plugins/manifest'
  import {
    installedPlugins, installPlugin, pluginsEnabled, preparePlugin, preparePluginFromUrl, readSecrets, removePlugin,
    setPluginEnabled, setPluginSecret, setPluginSetting, type InstalledPlugin, type PreparedPlugin,
  } from '$lib/plugins/registry'
  import { pluginConformance, pluginLogs, pluginRuns } from '$lib/plugins/host'
  import { protectedSurface } from '$lib/themes/safe-mode'

  let url = $state('')
  let busy = $state(false)
  let error = $state('')
  /** A plugin waiting for the viewer to approve its permissions. */
  let pending = $state<PreparedPlugin | null>(null)
  let files = $state<HTMLInputElement | undefined>()
  let shownLog = $state<string | null>(null)

  const runOf = (id: string) => $pluginRuns.find((run) => run.id === id)

  async function fetchText(target: string) {
    const reply = await invoke<{ status: number; body: string }>('http_get', { url: target, requestId: crypto.randomUUID(), timeoutMs: 20_000, maxBytes: 3 * 1024 * 1024 })
    if (reply.status < 200 || reply.status >= 300) throw new Error(`${target} answered ${reply.status}.`)
    return reply.body
  }

  async function fromUrl(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    busy = true
    try { pending = await preparePluginFromUrl(url.trim(), fetchText) } catch (e) { error = e instanceof Error ? e.message : String(e) } finally { busy = false }
  }

  /** Development: pick plugin.json and its main file from disk. */
  async function fromFiles() {
    error = ''
    const list = [...(files?.files ?? [])]
    const manifestFile = list.find((f) => f.name === 'plugin.json')
    if (!manifestFile) { error = 'Pick plugin.json together with its .js file.'; return }
    try {
      const manifestText = await manifestFile.text()
      const mainName = JSON.parse(manifestText)?.main?.path
      const main = list.find((f) => f.name === mainName)
      if (!main) throw new Error(`Pick ${mainName ?? 'the main file'} too.`)
      pending = await preparePlugin(manifestText, await main.text(), 'file')
    } catch (e) { error = e instanceof Error ? e.message : String(e) }
    if (files) files.value = ''
  }

  async function approve() {
    if (!pending) return
    await installPlugin(pending)
    pending = null
    url = ''
  }

  const settingValue = (plugin: InstalledPlugin, setting: PluginSetting) =>
    setting.type === 'secret' ? (readSecrets(plugin.manifest.id)[setting.id] ? '••••••••' : '') : plugin.settings[setting.id] ?? ''

  function writeSetting(plugin: InstalledPlugin, setting: PluginSetting, raw: string | boolean) {
    if (setting.type === 'secret') setPluginSecret(plugin.manifest.id, setting.id, String(raw))
    else if (setting.type === 'number') setPluginSetting(plugin.manifest.id, setting.id, Number(raw))
    else setPluginSetting(plugin.manifest.id, setting.id, raw)
  }
</script>

<div class="p-4 sm:p-8">
  <h2 data-settings-page-title class="mb-1 text-xl font-black">Plugins</h2>
  <p class="mb-6 max-w-2xl text-sm text-muted-foreground">
    Plugins add features to izumi. Each runs in a sandbox with no access to your accounts, sources or files,
    and can only do what you allow when you install it.
  </p>

  <div class="max-w-2xl space-y-8">
    <section class="flex items-start justify-between gap-4 rounded-xl border border-border p-4">
      <div>
        <h3 class="text-sm font-black">Enable plugins (beta)</h3>
        <p class="mt-1 text-sm text-muted-foreground">Off by default. Turning it off stops every plugin.</p>
        {#if $pluginConformance && !$pluginConformance.ok}
          <p class="mt-2 text-sm text-destructive">Plugins are switched off on this device: the sandbox did not block {$pluginConformance.failed.join(', ')}.</p>
        {/if}
      </div>
      <SettingsSwitch value={$pluginsEnabled} onToggle={() => ($pluginsEnabled = !$pluginsEnabled)} label="Enable plugins (beta)" />
    </section>

    {#if pending}
      <section class="rounded-xl border border-primary/50 p-4" aria-labelledby="plugin-consent-heading" data-theme-protected use:protectedSurface>
        <h3 id="plugin-consent-heading" class="flex items-center gap-2 text-base font-black"><ShieldCheck size={18} /> Install {pending.manifest.name}?</h3>
        <p class="mt-1 text-sm text-muted-foreground">{pending.manifest.description}</p>
        <p class="mt-1 text-xs text-muted-foreground">By {pending.manifest.author} · version {pending.manifest.version} · {pending.manifest.id}</p>
        <h4 class="mt-4 text-sm font-bold">It will be able to</h4>
        <ul class="mt-1 list-disc space-y-1 pl-5 text-sm">
          {#each pending.manifest.permissions.scopes as scope (scope)}<li>{SCOPE_TEXT[scope]}</li>{/each}
          {#if !pending.manifest.permissions.scopes.length}<li>Nothing beyond its own panel and settings</li>{/if}
        </ul>
        {#if pending.manifest.permissions.network}
          {@const network = pending.manifest.permissions.network}
          <p class="mt-3 text-sm"><span class="font-bold">Internet:</span>
            {[...network.domains, ...(network.fromSetting ? ['the address you enter in its settings'] : [])].join(', ')}</p>
          <p class="mt-1 text-sm text-muted-foreground">Why: {network.reason}</p>
        {/if}
        <div class="mt-4 flex gap-2">
          <button data-focusable class="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground" onclick={approve}>Install</button>
          <button data-focusable class="rounded-lg bg-secondary px-4 py-2 text-sm font-bold" onclick={() => (pending = null)}>Cancel</button>
        </div>
      </section>
    {/if}

    <section aria-labelledby="plugins-installed-heading">
      <h3 id="plugins-installed-heading" class="mb-2 text-sm font-black">Installed</h3>
      {#if !$installedPlugins.length}
        <p class="text-sm text-muted-foreground">No plugins yet.</p>
      {/if}
      <div class="space-y-3">
        {#each $installedPlugins as plugin (plugin.manifest.id)}
          {@const run = runOf(plugin.manifest.id)}
          <article class="rounded-xl border border-border p-4" data-plugin={plugin.manifest.id}>
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <h4 class="font-bold">{plugin.manifest.name} <span class="text-xs font-normal text-muted-foreground">{plugin.manifest.version}</span></h4>
                <p class="text-sm text-muted-foreground">{plugin.manifest.description}</p>
                <p class="mt-1 text-xs text-muted-foreground">
                  {#if !$pluginsEnabled}Plugins are off{:else if !plugin.enabled}Off{:else if run?.state === 'ready'}Running{:else if run?.state === 'failed'}Stopped: {run.error}{:else}Starting{/if}
                  · {plugin.manifest.permissions.scopes.map((s) => SCOPE_TEXT[s]).join(' · ') || 'No permissions'}
                </p>
              </div>
              <SettingsSwitch value={plugin.enabled} onToggle={() => setPluginEnabled(plugin.manifest.id, !plugin.enabled)} label="Enable {plugin.manifest.name}" />
            </div>
            {#if plugin.manifest.settings.length}
              <div class="mt-3 space-y-3">
                {#each plugin.manifest.settings as setting (setting.id)}
                  <label class="block text-sm">
                    <span class="font-bold">{setting.label}</span>
                    {#if setting.description}<span class="block text-xs text-muted-foreground">{setting.description}</span>{/if}
                    {#if setting.type === 'toggle'}
                      <input type="checkbox" data-focusable class="mt-1" checked={!!plugin.settings[setting.id]} onchange={(e) => writeSetting(plugin, setting, e.currentTarget.checked)} />
                    {:else if setting.type === 'select'}
                      <select data-focusable class="mt-1 w-full rounded-md bg-input px-3 py-2" value={String(plugin.settings[setting.id] ?? '')} onchange={(e) => writeSetting(plugin, setting, e.currentTarget.value)}>
                        {#each setting.options ?? [] as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
                      </select>
                    {:else}
                      <input data-focusable class="mt-1 w-full rounded-md bg-input px-3 py-2"
                             type={setting.type === 'secret' ? 'password' : setting.type === 'number' ? 'number' : setting.type === 'url' ? 'url' : 'text'}
                             placeholder={setting.placeholder} value={settingValue(plugin, setting)} autocomplete="off"
                             onfocus={(e) => { if (setting.type === 'secret') e.currentTarget.value = '' }}
                             onchange={(e) => writeSetting(plugin, setting, e.currentTarget.value.trim())} />
                    {/if}
                  </label>
                {/each}
              </div>
            {/if}
            <div class="mt-3 flex flex-wrap gap-2 text-sm">
              <button data-focusable class="rounded-md bg-secondary px-3 py-1.5 font-bold" onclick={() => (shownLog = shownLog === plugin.manifest.id ? null : plugin.manifest.id)}>Log</button>
              <button data-focusable class="flex items-center gap-1 rounded-md bg-secondary px-3 py-1.5 font-bold text-destructive" onclick={() => removePlugin(plugin.manifest.id)}><Trash2 size={14} /> Remove</button>
            </div>
            {#if shownLog === plugin.manifest.id}
              <pre class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">{($pluginLogs[plugin.manifest.id] ?? ['Nothing logged yet.']).join('\n')}</pre>
            {/if}
          </article>
        {/each}
      </div>
    </section>

    <section aria-labelledby="plugins-add-heading">
      <h3 id="plugins-add-heading" class="mb-2 text-sm font-black">Add a plugin</h3>
      <form class="flex gap-2" onsubmit={fromUrl}>
        <input data-focusable bind:value={url} type="url" placeholder="https://…/plugin.json" class="min-w-0 flex-1 rounded-md bg-input px-3 py-2 text-sm" />
        <button data-focusable disabled={busy || !url.trim()} class="rounded-md bg-secondary px-4 py-2 text-sm font-bold disabled:opacity-50">Add</button>
      </form>
      <p class="mt-2 text-xs text-muted-foreground">For plugin authors: <label class="cursor-pointer underline">pick plugin.json and its .js file<input bind:this={files} type="file" multiple accept=".json,.js,.mjs" class="sr-only" onchange={fromFiles} /></label>.</p>
      {#if error}<p class="mt-2 text-sm text-destructive" role="alert">{error}</p>{/if}
    </section>
  </div>
</div>
