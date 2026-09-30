<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { nuvioCloud, type CloudProfile, type JsonRecord } from '$lib/nuvio/cloud'
  import { object, first, string } from '$lib/nuvio/auth'
  import NuvioArtwork from './NuvioArtwork.svelte'
  let { profiles }: { profiles: CloudProfile[] } = $props()
  let busy = $state(false), error = $state(''), status = $state('Checking…'), email = $state(''), overview = $state.raw<JsonRecord>({})
  let wall = $state.raw<JsonRecord>({}), offset = $state(0), wallView = $state('top'), wallOpen = $state(false)
  const abort = new AbortController()
  const members = $derived(Array.isArray(object(wall[wallView]).members) ? object(wall[wallView]).members as JsonRecord[] : [])
  const total = $derived(Number(object(wall[wallView]).totalCount) || 0)
  onMount(() => { void load() }); onDestroy(() => abort.abort())
  async function load() {
    busy = true; error = ''
    const results = await Promise.allSettled([nuvioCloud.health(abort.signal), nuvioCloud.ping(abort.signal), nuvioCloud.overview(abort.signal), nuvioCloud.currentUser(abort.signal)])
    if (abort.signal.aborted) return
    const [health, ping, counts, user] = results
    status = health.status === 'fulfilled' ? string(object(health.value).status) || 'Unknown' : 'Unavailable'
    if (ping.status === 'rejected') status += ' · database ping unavailable'
    if (counts.status === 'fulfilled') overview = object(first(counts.value))
    if (user.status === 'fulfilled') email = string(object(user.value).email)
    if (results.some((result) => result.status === 'rejected')) error = 'Some account status information could not be loaded. Try refreshing.'
    busy = false
  }
  async function loadWall(next = 0) {
    busy = true; error = ''
    try { const value = await nuvioCloud.supporters(next, abort.signal); if (!abort.signal.aborted) { wall = object(value); offset = next; wallOpen = true } }
    catch (reason) { if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : 'Could not load supporters.' }
    finally { if (!abort.signal.aborted) busy = false }
  }
</script>
<div class="nv-toolbar"><div><h3 class="text-lg font-extrabold">Account status</h3><p class="nv-help mt-1">{email || 'Nuvio account'} · <span class="capitalize">{status}</span></p></div><button data-focusable class="nv-btn" disabled={busy} onclick={load}>Refresh status</button></div>
{#if error}<p class="nv-error" role="alert">{error}</p>{/if}
<div class="overflow-x-auto" data-nav-scroll-x><table class="w-full text-left text-sm"><thead class="text-xs text-muted-foreground"><tr><th class="p-3">Profile</th><th class="p-3">Sources</th><th class="p-3">Library</th><th class="p-3">Resume points</th><th class="p-3">Watched</th></tr></thead><tbody>{#each profiles as profile}<tr class="border-t border-border"><th class="p-3">{profile.name}</th>{#each ['addons', 'library_items', 'watch_progress', 'watched_items'] as key}<td class="p-3">{profile.pin_enabled ? 'Locked' : object(overview[key])[profile.profile_index] ?? '—'}</td>{/each}</tr>{/each}</tbody></table></div>
<div class="mt-8 border-t border-border pt-6"><div class="nv-toolbar"><div><h4 class="font-extrabold">The Nuvio supporter wall</h4><p class="nv-help mt-1">Community members who help support Nuvio.</p></div>{#if !wallOpen}<button data-focusable class="nv-btn" disabled={busy} onclick={() => loadWall()}>Browse supporters</button>{:else}<select data-focusable class="nv-input max-w-40" aria-label="Supporter order" bind:value={wallView} onchange={() => loadWall(0)}><option value="top">Top supporters</option><option value="recent">Recent supporters</option></select>{/if}</div>{#if wallOpen}<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{#each members as member}<div class="flex min-w-0 items-center gap-3"><div class="size-10 shrink-0 overflow-hidden rounded-full bg-secondary"><NuvioArtwork url={string(member.avatarUrl)} title={string(member.displayName)} /></div><div class="min-w-0"><p class="truncate text-sm font-bold">{string(member.displayName)}</p><p class="nv-help truncate text-xs">{string(member.membershipLevel).replace(/_/g, ' ')}</p></div></div>{/each}</div><div class="mt-5 flex items-center justify-between gap-3"><button data-focusable class="nv-btn" disabled={busy || offset === 0} onclick={() => loadWall(Math.max(0, offset - 48))}>Previous</button><span class="nv-help">{total ? offset + 1 : 0}–{Math.min(offset + members.length, total)} of {total}</span><button data-focusable class="nv-btn" disabled={busy || offset + 48 >= total} onclick={() => loadWall(offset + 48)}>Next</button></div>{/if}</div>
