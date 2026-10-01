<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { nuvioCloud, type CloudProfile, type JsonRecord } from '$lib/nuvio/cloud'
  import { object, string } from '$lib/nuvio/auth'
  import NuvioCloudMedia from './NuvioCloudMedia.svelte'
  import NuvioCloudSources from './NuvioCloudSources.svelte'
  import NuvioCloudCollections from './NuvioCloudCollections.svelte'
  import NuvioCloudSettings from './NuvioCloudSettings.svelte'
  import NuvioCloudStatus from './NuvioCloudStatus.svelte'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import LockKeyhole from '@lucide/svelte/icons/lock-keyhole'
  import './nuvio.css'
  let profiles = $state.raw<CloudProfile[]>([]), selected = $state(0), section = $state('collections')
  let loading = $state(true), busy = $state(false), error = $state(''), notice = $state('')
  let editing = $state<CloudProfile | null>(null), expected = $state<CloudProfile | null>(null)
  let name = $state(''), color = $state('#7c6fe0'), inherit = $state(false), avatar = $state(''), avatarUrl = $state(''), confirmation = $state('')
  let avatars = $state.raw<JsonRecord[]>([]), showDelete = $state(false)
  let profileDialog = $state<HTMLDialogElement>(null!)
  const abort = new AbortController()
  const profile = $derived(profiles.find((row) => row.profile_index === selected))
  const sections = [{ id: 'collections', name: 'Collections' }, { id: 'library', name: 'Library' }, { id: 'progress', name: 'Continue watching' }, { id: 'history', name: 'History' }, { id: 'sources', name: 'Sources' }, { id: 'settings', name: 'Preferences' }, { id: 'home', name: 'Home layout' }, { id: 'status', name: 'Account status' }]
  onMount(() => { void refresh() })
  onDestroy(() => abort.abort())
  async function refresh() {
    loading = true; error = ''
    try {
      const result = await nuvioCloud.profiles(abort.signal)
      if (abort.signal.aborted) return
      profiles = result
      if (!result.some((row) => row.profile_index === selected)) selected = result[0]?.profile_index ?? 0
    } catch (reason) { if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : 'Could not load profiles.' }
    finally { if (!abort.signal.aborted) loading = false }
  }
  async function edit(row?: CloudProfile) {
    expected = row ? structuredClone($state.snapshot(row)) : null
    editing = row ?? { profile_index: [1, 2, 3, 4, 5, 6].find((id) => !profiles.some((entry) => entry.profile_index === id))!, name: '' }
    name = row?.name ?? ''; color = row?.avatar_color_hex || '#7c6fe0'; inherit = row?.uses_primary_addons ?? false; avatar = row?.avatar_id || ''; avatarUrl = row?.avatar_url || ''; confirmation = ''; showDelete = false; error = ''
    profileDialog.showModal()
    try { const values = await nuvioCloud.avatars(abort.signal); if (!abort.signal.aborted) avatars = values.filter((entry) => entry.is_active !== false) }
    catch { /* Custom colour and image remain available if the optional avatar catalog is offline. */ }
  }
  async function saveProfile(remove = false) {
    if (!editing || busy) return
    busy = true; error = ''
    try {
      if (remove) {
        if (confirmation !== expected?.name) throw new Error('Type the profile name to confirm deletion.')
        await nuvioCloud.deleteProfile(expected!, abort.signal)
      } else {
        if (avatarUrl && !/^https?:\/\//i.test(avatarUrl)) throw new Error('Use an HTTP(S) avatar image URL.')
        await nuvioCloud.saveProfile({ ...editing, name, avatar_color_hex: color, uses_primary_addons: editing.profile_index !== 1 && inherit, avatar_id: avatar || null, avatar_url: avatarUrl || null }, expected, abort.signal)
      }
      if (abort.signal.aborted) return
      profileDialog.close(); notice = remove ? 'Nuvio profile and its cloud data deleted.' : 'Nuvio profile saved.'; await refresh()
    } catch (reason) { if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : 'Could not save profile.' }
    finally { if (!abort.signal.aborted) busy = false }
  }
</script>

<section class="nuvio-workspace py-6" aria-label="Nuvio cloud account">
  <div class="nv-toolbar flex-col sm:flex-row sm:items-end">
    <div class="flex min-w-0 flex-1 items-end gap-3"><label class="nv-label min-w-0 flex-1 sm:max-w-xs">Nuvio profile<select data-focusable class="nv-input" bind:value={selected} disabled={loading}>{#each profiles as row}<option value={row.profile_index}>{row.name}{row.pin_enabled ? ' · PIN protected' : ''}</option>{/each}</select></label><button data-focusable class="nv-btn" disabled={!profile || loading} onclick={() => edit(profile)}>Edit profile</button></div>
    <div class="flex flex-wrap gap-2 self-end"><button data-focusable class="nv-btn" disabled={loading} onclick={refresh}>Refresh profiles</button><button data-focusable class="nv-btn" disabled={loading || profiles.length >= 6} onclick={() => edit()}>New profile</button></div>
  </div>
  {#if notice}<p class="nv-notice" role="status">{notice}</p>{/if}
  {#if error && !profileDialog?.open}<p class="nv-error" role="alert">{error}</p>{/if}
  {#if loading}<p class="nv-help flex items-center gap-2 py-8" role="status"><LoaderCircle class="size-4 animate-spin motion-reduce:animate-none" />Loading profiles…</p>
  {:else if !profiles.length}<p class="nv-empty">Create your first Nuvio profile to start using cloud storage.</p>
  {:else}
    <p class="nv-help mb-5 text-xs">Save changes to Nuvio, or copy selected data between Nuvio and izumi.</p>
    {#if profile?.pin_enabled}
      <div class="nv-panel flex flex-col items-start gap-3"><LockKeyhole class="size-6 text-muted-foreground" /><h3 class="font-bold">This profile is PIN protected</h3><p class="nv-help">Nuvio’s public API does not provide a PIN unlock flow. Manage the PIN in Nuvio, then refresh profiles here.</p><a href="https://nuvio.tv/account" target="_blank" rel="noreferrer" data-focusable class="nv-btn">Open Nuvio account ↗</a></div>
    {:else if profile}
      <nav aria-label="Cloud data" data-nav-scroll-x class="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-2">{#each sections as item}<button data-focusable class="min-h-11 shrink-0 rounded-lg px-4 text-sm font-bold {section === item.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}" aria-current={section === item.id ? 'page' : undefined} onclick={() => section = item.id}>{item.name}</button>{/each}</nav>
      {#key `${selected}:${section}`}
        {#if section === 'collections'}<NuvioCloudCollections {profile} />
        {:else if section === 'status'}<NuvioCloudStatus {profiles} />
        {:else if section === 'sources'}<NuvioCloudSources {profile} />
        {:else if section === 'settings' || section === 'home'}<NuvioCloudSettings profileId={selected} kind={section} />
        {:else if section === 'library' || section === 'progress' || section === 'history'}<NuvioCloudMedia profileId={selected} kind={section} />{/if}
      {/key}
    {/if}
  {/if}
  <p class="nv-help mt-10 border-t border-border pt-4 text-xs"><a data-focusable class="underline underline-offset-4" href="https://nuvio.tv/docs" target="_blank" rel="noreferrer">Nuvio documentation ↗</a></p>
  <dialog class="nv-dialog" bind:this={profileDialog} aria-labelledby="nv-profile-title" oncancel={(event) => { if (busy) event.preventDefault() }}>
    <div class="nv-toolbar"><h3 class="text-xl font-black" id="nv-profile-title">{expected ? 'Edit profile' : 'New profile'}</h3><button data-focusable class="nv-btn" disabled={busy} onclick={() => profileDialog.close()}>Close</button></div>
    <form onsubmit={(event) => { event.preventDefault(); void saveProfile() }} class="space-y-4">
      <fieldset disabled={busy || expected?.pin_enabled} class="space-y-4">
        <label class="nv-label">Profile name<input class="nv-input" required maxlength="64" bind:value={name} /></label>
        <div class="grid grid-cols-[80px_1fr] gap-4"><label class="nv-label">Colour<input data-focusable class="nv-input p-1" type="color" bind:value={color} /></label><label class="nv-label">Avatar<select data-focusable class="nv-input" bind:value={avatar}><option value="">Keep current avatar</option>{#each avatars as entry}<option value={string(entry.id)}>{string(entry.display_name)}</option>{/each}</select></label></div>
        <label class="nv-label">Custom avatar URL<input class="nv-input" type="url" placeholder="https://…" bind:value={avatarUrl} /></label>
        {#if editing?.profile_index !== 1}<label class="flex items-center gap-3 text-sm"><input data-focusable type="checkbox" bind:checked={inherit} />Use profile 1’s sources</label>{/if}
        <button data-focusable class="nv-btn nv-primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile to Nuvio'}</button>
      </fieldset>
    </form>
    {#if expected?.pin_enabled}<p class="nv-help mt-4">Manage this protected profile in Nuvio.</p>
    {:else if expected}
      <div class="mt-7 border-t border-border pt-5">{#if !showDelete}<button data-focusable class="nv-btn nv-danger" disabled={busy} onclick={() => showDelete = true}>Delete profile…</button>{:else}<p class="nv-help">Permanently deletes {expected.name} and all its Nuvio sources, library, playback data, settings and collections.</p><label class="nv-label mt-3">Type “{expected.name}” to confirm<input class="nv-input" bind:value={confirmation} /></label><button data-focusable class="nv-btn nv-danger mt-3" disabled={busy || confirmation !== expected.name} onclick={() => saveProfile(true)}>Delete profile and cloud data</button>{/if}</div>
    {/if}
    {#if error}<p class="nv-error" role="alert">{error}</p>{/if}
  </dialog>
</section>
