<script lang="ts">
  import { heroMedia } from '$lib/stores/hero'
  import {
    watchParty, partyParticipants, partyError, partySyncing, partyNotice,
    createWatchParty, joinWatchParty, leaveWatchParty, refreshWatchParty,
  } from '$lib/watch-together/client'
  import Copy from '@lucide/svelte/icons/copy'
  import Users from '@lucide/svelte/icons/users'
  import LogOut from '@lucide/svelte/icons/log-out'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import { copyToClipboard } from '$lib/util/clipboard'
  import { torrentPlaybackMode, debridKey, debridRoomNoticeAck } from '$lib/settings/ui'
  import DebridRoomNotice from '$lib/components/watch/DebridRoomNotice.svelte'
  import { isEffectiveDebridMode, shouldWarnBeforeHosting } from '$lib/watch-together/debrid-warning'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import CircleCheck from '@lucide/svelte/icons/circle-check'
  import Clock3 from '@lucide/svelte/icons/clock-3'

  heroMedia.set(null)
  let code = $state('')
  let busy = $state(false)
  let localError = $state('')

  async function run(action: () => Promise<void>) {
    busy = true; localError = ''
    try { await action() } catch (error) { localError = error instanceof Error ? error.message : String(error) }
    finally { busy = false }
  }

  // Hosting on debrid sends the host's own resolved link to every guest. Warn before the room
  // exists, not after. Gated on debrid being the EFFECTIVE mode: with no key set, playback falls
  // back to the direct engine (see play.ts), so the warning would be wrong.
  const debridHost = $derived(isEffectiveDebridMode($torrentPlaybackMode, $debridKey))
  let noticeOpen = $state(false)

  function hostRoom() {
    if (shouldWarnBeforeHosting($torrentPlaybackMode, $debridKey, $debridRoomNoticeAck)) {
      noticeOpen = true
      return
    }
    run(createWatchParty)
  }

  function copyCode() {
    if (!$watchParty) return
    copyToClipboard($watchParty.roomCode)
  }
  const readinessLabel = (status: 'waiting' | 'loading' | 'ready' | 'buffering', paused: boolean) =>
    status === 'buffering' ? 'Buffering'
    : status === 'loading' ? 'Loading episode'
    : status === 'waiting' ? 'Waiting for playback'
    : paused ? 'Ready · paused' : 'Ready'
</script>

<div class="mx-auto max-w-3xl p-4 pb-24 sm:p-8">
  <div class="mb-6"><h1 class="text-2xl font-black">Watch Together</h1><p class="mt-1 text-sm text-muted-foreground">Keep playback synchronized across Izumi devices using the host's exact source.</p></div>
  {#if localError || $partyError}<div class="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{localError || $partyError}</div>{/if}
  {#if !$watchParty}
    <div class="grid gap-4 sm:grid-cols-2">
      <section class="rounded-2xl border border-border bg-secondary/30 p-5"><Users size={28} class="mb-3 text-theme" /><h2 class="text-lg font-black">Host a room</h2><p class="mb-5 mt-1 text-sm text-muted-foreground">Create a code, start an episode normally, and your controls become the room controls.</p><button disabled={busy} onclick={hostRoom} class="w-full rounded-lg bg-theme py-2.5 font-black text-white">Create room</button></section>
      <section class="rounded-2xl border border-border bg-secondary/30 p-5"><h2 class="text-lg font-black">Join a room</h2><p class="mb-4 mt-1 text-sm text-muted-foreground">Enter the code shown on the host device. Izumi verifies the room before joining.</p><input bind:value={code} maxlength="6" placeholder="ABC234" class="mb-3 w-full rounded-lg bg-input px-4 py-3 text-center font-mono text-xl font-black uppercase tracking-[0.3em]" /><button disabled={busy} onclick={() => run(() => joinWatchParty(code))} class="w-full rounded-lg bg-secondary py-2.5 font-black hover:bg-accent">{busy ? 'Checking room…' : 'Join room'}</button></section>
    </div>
    <p class="mt-5 rounded-lg bg-secondary/30 p-3 text-xs text-muted-foreground">Watch Together rooms are separate from Device Sync. Joining shares room presence, the host's current source, and playback controls for the current room; it does not share your history, settings or extensions.</p>
    {#if debridHost}
      <p class="mt-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs text-yellow-500/90">You're on debrid. Hosting sends your own resolved debrid link to the room, so guests stream it from their IP addresses — which providers treat as account sharing. <button onclick={() => (noticeOpen = true)} class="underline underline-offset-2">What this means</button></p>
    {/if}
  {:else}
    <section class="rounded-2xl border border-theme/30 bg-theme/5 p-6 text-center">
      <div class="text-xs font-black uppercase tracking-widest text-theme">{$watchParty.role === 'host' ? 'Hosting' : 'Joined'} room</div>
      <button onclick={copyCode} class="mx-auto mt-2 flex items-center gap-3 rounded-xl px-4 py-2 font-mono text-4xl font-black tracking-[0.2em] hover:bg-secondary"><span>{$watchParty.roomCode}</span><Copy size={19} /></button>
      <p class="mt-3 text-sm text-muted-foreground">{$watchParty.role === 'host' ? 'Start any episode. Its source and your play, pause and seek controls will be sent to the room.' : 'The host’s exact source will open on this device.'}</p>
      {#if $partySyncing}<div class="mt-3 text-sm font-bold text-theme">Resolving the host’s episode…</div>{/if}
      {#if $partyNotice}<div class="mt-3 text-sm font-bold text-muted-foreground">{$partyNotice}</div>{/if}
    </section>
    <div class="mt-5 flex items-center justify-between"><h2 class="font-black">Participants ({$partyParticipants.length})</h2><button onclick={refreshWatchParty} class="grid size-9 place-items-center rounded-lg bg-secondary"><RefreshCw size={16} /></button></div>
    <div class="mt-2 space-y-2">
      {#each $partyParticipants as participant (participant.deviceId)}
        <div class="flex items-center gap-3 rounded-lg bg-secondary/40 px-4 py-3">
          <span class="grid size-8 place-items-center rounded-full bg-theme/15 font-black text-theme">{participant.name.slice(0, 1).toUpperCase()}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-bold">{participant.name}</span>
            {#if participant.mediaId}
              <span class="block text-[0.68rem] text-muted-foreground">Episode {participant.episode ?? '—'} · {Math.floor(participant.position / 60)}:{String(Math.floor(participant.position % 60)).padStart(2, '0')}</span>
            {/if}
          </span>
          <span class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.65rem] font-black
            {participant.readiness === 'buffering' ? 'bg-amber-500/15 text-amber-400'
              : participant.readiness === 'loading' ? 'bg-sky-500/15 text-sky-400'
              : participant.readiness === 'ready' ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-background text-muted-foreground'}">
            {#if participant.readiness === 'buffering' || participant.readiness === 'loading'}
              <LoaderCircle size={11} class="animate-spin" />
            {:else if participant.readiness === 'ready'}
              <CircleCheck size={11} />
            {:else}
              <Clock3 size={11} />
            {/if}
            {readinessLabel(participant.readiness, participant.paused)}
          </span>
          <span class="rounded-full bg-background px-2 py-1 text-[0.6rem] font-black uppercase text-muted-foreground">{participant.role}</span>
        </div>
      {/each}
    </div>
    <button onclick={leaveWatchParty} class="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-destructive/40 py-2.5 font-bold text-destructive"><LogOut size={17} /> Leave room</button>
  {/if}
</div>

{#if noticeOpen}
  <DebridRoomNotice
    onConfirm={() => { noticeOpen = false; run(createWatchParty) }}
    onCancel={() => (noticeOpen = false)} />
{/if}
