<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import ShieldCheck from '@lucide/svelte/icons/shield-check'
  import AddonLogo from '$lib/components/player/AddonLogo.svelte'
  import { SCOPE_TEXT, type PluginManifest, type PluginSetting } from '$lib/plugins/manifest'
  import { readSecrets, setPluginSecret, setPluginSetting, type InstalledPlugin, type PreparedPlugin } from '$lib/plugins/registry'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { pluginAccounts, pluginLogs, pluginRuns, sendPluginEvent } from '$lib/plugins/host'
  import type { PluginEntry } from '$lib/plugins/sections'

  // A plugin's page, laid out like a theme's: what it is and what you can do, then what it may do
  // (the permissions Install approves), then its settings and log once installed. The page owns every
  // action; this only lays them out.
  let { entry, prepared, from, enabledAll, busy, primary, hint, message, onback, onremove }: {
    entry: PluginEntry | null
    /** The checked plugin.json and code of the selection (a listing, an update, or a link or file). */
    prepared: PreparedPlugin | null
    /** Where it comes from: a store's name, a link or a file. */
    from: string
    /** The beta switch: plugins run only while it is on. */
    enabledAll: boolean
    busy: boolean
    primary: { label: string; disabled: boolean; run: () => void }
    /** A standing note under the actions (an id taken by another install, new permissions). */
    hint: string
    message: { text: string; error: boolean } | null
    /** Back to the gallery (also a controller's B). */
    onback: () => void
    /** Present for installs. */
    onremove?: () => void
  } = $props()

  const installed: InstalledPlugin | undefined = $derived(entry?.installed)
  const listing = $derived(entry?.listing?.entry)
  // The permissions shown are the ones Install or Update would approve, else the installed ones.
  const manifest: PluginManifest | undefined = $derived(prepared?.manifest ?? installed?.manifest)
  const name = $derived(manifest?.name ?? listing?.name ?? '')
  const author = $derived(manifest?.author ?? listing?.author ?? '')
  const description = $derived(manifest?.description ?? listing?.description ?? '')
  const version = $derived(manifest?.version ?? listing?.version)
  const run = $derived(installed ? $pluginRuns.find((item) => item.id === installed.manifest.id) : undefined)
  const status = $derived(!installed ? '' : !enabledAll ? 'Plugins are off' : !installed.enabled ? 'Off' : run?.state === 'ready' ? 'Running' : run?.state === 'failed' ? `Stopped: ${run.error}` : 'Starting')
  // Drawn from what the running plugin sends (ui.setAccount), like its player panel.
  const account = $derived(installed && run?.state === 'ready' ? $pluginAccounts[installed.manifest.id] : undefined)
  let showLog = $state(false)

  const settingValue = (plugin: InstalledPlugin, setting: PluginSetting) =>
    setting.type === 'secret' ? (readSecrets(plugin.manifest.id)[setting.id] ? '••••••••' : '') : plugin.settings[setting.id] ?? ''

  function writeSetting(plugin: InstalledPlugin, setting: PluginSetting, raw: string | boolean) {
    if (setting.type === 'secret') setPluginSecret(plugin.manifest.id, setting.id, String(raw))
    else if (setting.type === 'number') setPluginSetting(plugin.manifest.id, setting.id, Number(raw))
    else setPluginSetting(plugin.manifest.id, setting.id, raw)
  }
</script>

<section class="plugin-pane" data-plugin-pane data-nav-back-scope aria-busy={busy} aria-labelledby="plugin-pane-title">
  <button type="button" class="back" data-focusable data-nav-back onclick={onback}><ArrowLeft size={18} aria-hidden="true" /> All plugins</button>
  <div class="head">
    <AddonLogo logo={listing?.icon} {name} id={entry?.key} size={64} />
    <div class="who"><h3 id="plugin-pane-title">{name}</h3>{#if author}<p>By {author}</p>{/if}</div>
    <div class="actions">
      <!-- aria-disabled, never disabled: Install turning into Turn off must not drop a controller's focus. -->
      <button type="button" class="control primary" data-focusable data-plugin-primary data-nav-region-default aria-disabled={primary.disabled || undefined} onclick={() => { if (!primary.disabled) primary.run() }}>{primary.label}</button>
      {#if onremove}<button type="button" class="control" data-focusable aria-disabled={busy || undefined} onclick={() => { if (!busy) onremove() }}>Remove</button>{/if}
    </div>
  </div>
  {#if message}<p role={message.error ? 'alert' : 'status'} class="message" class:error={message.error}>{message.text}</p>{/if}
  {#if hint}<p class="hint">{hint}</p>{/if}
  {#if description}<p class="description">{description}</p>{/if}
  <dl class="facts">
    {#if version}<div><dt>Version</dt><dd>{version}</dd></div>{/if}
    {#if from}<div><dt>From</dt><dd>{from}</dd></div>{/if}
    {#if status}<div><dt>Status</dt><dd>{status}</dd></div>{/if}
    {#if manifest}<div><dt>ID</dt><dd>{manifest.id}</dd></div>{/if}
  </dl>

  <div class="block">
    <h4><ShieldCheck size={16} aria-hidden="true" /> {installed && !prepared ? 'It can' : 'It will be able to'}</h4>
    {#if manifest}
      <ul>
        {#each manifest.permissions.scopes as scope (scope)}<li>{SCOPE_TEXT[scope]}</li>{/each}
        {#if !manifest.permissions.scopes.length}<li>Nothing beyond its own panel and settings</li>{/if}
      </ul>
      {#if manifest.permissions.network}
        {@const network = manifest.permissions.network}
        <p><strong>Internet:</strong> {[...network.domains, ...(network.fromSetting ? ['the address you enter in its settings'] : [])].join(', ')}</p>
        <p class="muted">Why: {network.reason}</p>
      {/if}
      <p class="muted">It runs in a sandbox with no access to your accounts, sources or files.</p>
    {:else}
      <p class="muted">{busy ? 'Checking the plugin…' : 'Its permissions show once the plugin is checked.'}</p>
    {/if}
  </div>

  {#if installed}
    {#if account && (account.text || account.buttons.length)}
      <div class="block" data-plugin-account>
        <h4>Account</h4>
        {#if account.text}<p>{account.text}</p>{/if}
        {#if account.buttons.length}
          <div class="actions wrap">
            {#each account.buttons as button (button.id)}
              <button type="button" class="control" class:primary={button.primary} data-focusable
                      onclick={() => sendPluginEvent(installed.manifest.id, 'account', { id: button.id })}>{button.label}</button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    {#if installed.manifest.settings.length}
      <div class="block">
        <h4>Settings</h4>
        {#each installed.manifest.settings as setting (setting.id)}
          <label class="setting">
            <span class="label">{setting.label}</span>
            {#if setting.description}<span class="muted">{setting.description}</span>{/if}
            {#if setting.links?.length}
              <span class="links">
                {#each setting.links as link, i (i)}
                  <button type="button" class="link" data-focusable onclick={(e) => { e.preventDefault(); void openUrl(link.url) }}>{link.label}</button>
                {/each}
              </span>
            {/if}
            {#if setting.type === 'toggle'}
              <input type="checkbox" data-focusable class="check" checked={!!installed.settings[setting.id]} onchange={(e) => writeSetting(installed, setting, e.currentTarget.checked)} />
            {:else if setting.type === 'select'}
              <select data-focusable class="field" value={String(installed.settings[setting.id] ?? '')} onchange={(e) => writeSetting(installed, setting, e.currentTarget.value)}>
                {#each setting.options ?? [] as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
              </select>
            {:else}
              <input data-focusable class="field"
                     type={setting.type === 'secret' ? 'password' : setting.type === 'number' ? 'number' : setting.type === 'url' ? 'url' : 'text'}
                     placeholder={setting.placeholder} value={settingValue(installed, setting)} autocomplete="off"
                     onfocus={(e) => { if (setting.type === 'secret') e.currentTarget.value = '' }}
                     onchange={(e) => writeSetting(installed, setting, e.currentTarget.value.trim())} />
            {/if}
          </label>
        {/each}
      </div>
    {/if}
    <div class="block">
      <button type="button" class="control" data-focusable aria-expanded={showLog} onclick={() => (showLog = !showLog)}>{showLog ? 'Hide log' : 'Show log'}</button>
      {#if showLog}<pre>{($pluginLogs[installed.manifest.id] ?? ['Nothing logged yet.']).join('\n')}</pre>{/if}
    </div>
  {/if}
</section>

<style>
  .plugin-pane { display: flex; flex-direction: column; gap: .875rem; padding: 1rem; border-radius: 1.25rem; background: hsl(var(--foreground) / .045); }
  .back { display: inline-flex; align-self: flex-start; align-items: center; gap: .5rem; min-height: 2.75rem; font-size: .8125rem; font-weight: 800; }
  .head { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem 1rem; }
  .who { flex: 1; min-width: 10rem; }
  h3 { font-size: 1.625rem; font-weight: 900; letter-spacing: -.03em; line-height: 1.1; }
  .who p { margin-top: .25rem; font-size: .8125rem; color: hsl(var(--muted-foreground)); }
  .actions { display: flex; gap: .5rem; }
  .control { display: inline-flex; align-items: center; justify-content: center; min-height: 2.625rem; padding: 0 1.125rem; border-radius: 999px; font-size: .8125rem; font-weight: 800; white-space: nowrap; background: hsl(var(--foreground) / .1); transition: background-color .15s ease, filter .15s ease; }
  .control:not([aria-disabled='true']):hover { background: hsl(var(--foreground) / .16); }
  .control.primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
  .control.primary:not([aria-disabled='true']):hover { background: hsl(var(--primary)); filter: brightness(1.1); }
  .control[aria-disabled='true'] { opacity: .5; cursor: default; }
  .description { font-size: .875rem; line-height: 1.6; color: hsl(var(--foreground) / .82); }
  .hint, .message { font-size: .8125rem; line-height: 1.5; color: hsl(var(--muted-foreground)); }
  .message { padding: .625rem .875rem; border-radius: .625rem; background: hsl(var(--background) / .55); color: hsl(var(--foreground)); }
  .message.error { box-shadow: inset .1875rem 0 0 hsl(var(--theme)); }
  .facts { display: flex; flex-wrap: wrap; gap: .5rem 1.75rem; }
  dt { font-size: .625rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: hsl(var(--muted-foreground)); }
  dd { margin-top: .125rem; font-size: .8125rem; font-weight: 700; overflow-wrap: anywhere; }
  .block { display: grid; gap: .5rem; padding: .875rem 1rem; border-radius: .875rem; background: hsl(var(--background) / .55); font-size: .875rem; }
  h4 { display: flex; align-items: center; gap: .5rem; font-size: .875rem; font-weight: 900; }
  ul { display: grid; gap: .25rem; padding-left: 1.25rem; list-style: disc; }
  .muted { font-size: .75rem; color: hsl(var(--muted-foreground)); }
  .setting { display: grid; gap: .25rem; margin-top: .25rem; }
  .label { font-weight: 800; }
  .field { width: 100%; min-height: 2.5rem; padding: .5rem .75rem; border-radius: .5rem; background: hsl(var(--input)); }
  .check { justify-self: start; margin-top: .25rem; }
  .wrap { flex-wrap: wrap; }
  .links { display: flex; flex-wrap: wrap; gap: .25rem 1rem; }
  .link { font-size: .75rem; font-weight: 700; color: hsl(var(--primary)); text-decoration: underline; text-underline-offset: .15em; }
  pre { max-height: 12rem; overflow: auto; white-space: pre-wrap; padding: .5rem; border-radius: .5rem; background: hsl(var(--muted)); font-size: .75rem; }
  .actions .control, .back { flex: none; }
  /* Phones: the actions share a row under the name. */
  @container (max-width: 40rem) {
    .plugin-pane { padding: .75rem; border-radius: 1rem; }
    .actions { flex: 1 1 100%; }
    .actions .control { flex: 1; }
  }
</style>
