<script lang="ts">
  import AddonLogo from '$lib/components/player/AddonLogo.svelte'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { entryTypeLabel } from '$lib/store/filters'
  import type { StoreEntry } from '$lib/store/types'

  let {
    entry, icon, storeName, thirdParty, trustLabel, installed, update, enabled, busy, locked, error = '',
    onclose, oninstall, onremove, ontoggle, onsettings, settingsLabel = 'Settings', onmanage,
  }: {
    entry: StoreEntry
    /** Artwork found for this entry when its listing has none (e.g. an installed package's own icon). */
    icon?: string
    storeName: string
    thirdParty: boolean
    /** Plain-language signing status: the store listing and, once installed, the package itself. */
    trustLabel: string
    installed: boolean
    /** Installed, and this store lists a newer version the entry may update to. */
    update: boolean
    /** Installed and switched on. Ignored when not installed. */
    enabled: boolean
    busy: boolean
    locked: boolean
    /** The last install or remove failure, shown here because the page's own message sits under the sheet. */
    error?: string
    onclose: () => void
    oninstall: () => void
    onremove?: () => void
    ontoggle?: () => void
    onsettings?: () => void
    settingsLabel?: string
    /** For entries managed on another page (themes). */
    onmanage?: () => void
  } = $props()

  const downloadHost = $derived.by(() => {
    const install = entry.install
    const url = install.type === 'addon'
      ? install.manifestUrl
      : install.type === 'extension'
        ? install.spec
        : install.type === 'package'
          ? (install.pkg.packageFormat === 'aniyomi-repo' ? install.pkg.apk : install.pkg.package)
          : install.release.download
    try {
      return new URL(url).hostname
    } catch {
      return ''
    }
  })
  const live = $derived(entry.install.type === 'addon' || entry.install.type === 'extension')
  const installLabel = $derived(entry.install.type === 'theme'
    ? 'Preview & install'
    : entry.install.type === 'addon' && entry.install.configureUrl ? 'Configure & install' : 'Install')
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape' && !busy) onclose() }} />

<div class="fixed inset-0 z-[100] grid place-items-end bg-black/75 sm:place-items-center sm:p-4" role="presentation"
     onclick={(event) => { if (event.target === event.currentTarget && !busy) onclose() }}>
  <div role="dialog" aria-modal="true" aria-labelledby="store-entry-title" data-nav-trap data-nav-escape
       class="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-background p-5 shadow-2xl sm:rounded-2xl sm:p-6">
    <div class="flex items-start gap-3">
      <AddonLogo logo={icon ?? entry.icon} name={entry.name} id={entry.id} size={56} />
      <div class="min-w-0 flex-1">
        <h2 id="store-entry-title" class="truncate text-lg font-black">{entry.name}</h2>
        <p class="text-xs text-muted-foreground">
          {entryTypeLabel(entry)}{#if entry.version} · v{entry.version}{/if}{#if entry.author} · by {entry.author}{/if}
        </p>
      </div>
    </div>
    {#if entry.preview}
      <img src={entry.preview} alt={`${entry.name} preview`} referrerpolicy="no-referrer" class="mt-4 w-full rounded-lg border border-border" />
    {/if}
    {#if entry.description}<p class="mt-4 whitespace-pre-line text-sm text-muted-foreground">{entry.description}</p>{/if}
    <dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      <dt class="text-muted-foreground">Store</dt>
      <dd class="min-w-0 font-bold">{storeName}{#if thirdParty} <span class="font-normal text-muted-foreground">· third-party, not reviewed by izumi</span>{/if}</dd>
      {#if downloadHost}<dt class="text-muted-foreground">Downloads from</dt><dd class="min-w-0 truncate font-bold">{downloadHost}</dd>{/if}
      <dt class="text-muted-foreground">Signing</dt><dd class="min-w-0 font-bold">{trustLabel}</dd>
      {#if entry.languages.length}<dt class="text-muted-foreground">Languages</dt><dd class="font-bold">{entry.languages.join(', ').toUpperCase()}</dd>{/if}
      {#if entry.requiresDebrid}<dt class="text-muted-foreground">Needs</dt><dd class="font-bold">A debrid account</dd>{/if}
      {#if live}<dt class="text-muted-foreground">Updates</dt><dd class="font-bold">Live source: it can change without a review step</dd>{/if}
    </dl>
    {#if locked}
      <p class="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">This store failed its signing-key check. Review it under Manage stores before installing.</p>
    {/if}
    {#if error}<p role="alert" class="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>{/if}
    <div class="mt-5 flex flex-wrap gap-2">
      {#if installed}
        {#if update}
          <button type="button" data-focusable disabled={busy || locked} onclick={oninstall}
                  class="rounded-md bg-primary px-4 py-2 text-sm font-black text-primary-foreground disabled:opacity-40">Update to v{entry.version}</button>
        {/if}
        {#if ontoggle}
          <button type="button" data-focusable disabled={busy} aria-pressed={enabled} onclick={ontoggle}
                  class="rounded-md px-3 py-2 text-sm font-black {enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-secondary'}">{enabled ? 'Enabled' : 'Enable'}</button>
        {/if}
        {#if onsettings}<button type="button" data-focusable onclick={onsettings} class="rounded-md bg-secondary px-3 py-2 text-sm font-bold">{settingsLabel}</button>{/if}
        {#if onmanage}<button type="button" data-focusable onclick={onmanage} class="rounded-md bg-secondary px-3 py-2 text-sm font-bold">Manage in Themes</button>{/if}
        {#if onremove}<button type="button" data-focusable disabled={busy} onclick={onremove} class="rounded-md px-3 py-2 text-sm font-bold text-destructive active:bg-destructive/10">Remove</button>{/if}
      {:else}
        <button type="button" data-focusable disabled={busy || locked} onclick={oninstall}
                class="rounded-md bg-primary px-4 py-2 text-sm font-black text-primary-foreground disabled:opacity-40">{installLabel}</button>
      {/if}
      {#if entry.homepage}
        {@const homepage = entry.homepage}
        <button type="button" data-focusable onclick={() => void openUrl(homepage)} class="flex items-center gap-1 rounded-md bg-secondary px-3 py-2 text-sm font-bold">Website <ExternalLink size={14} /></button>
      {/if}
      <button type="button" data-focusable disabled={busy} onclick={onclose} class="ml-auto rounded-md px-3 py-2 text-sm font-bold text-muted-foreground">Close</button>
    </div>
  </div>
</div>
