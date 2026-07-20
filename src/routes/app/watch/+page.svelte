<script lang="ts">
  import { heroMedia } from '$lib/stores/hero'
  import {
    watchParty, partyParticipants, partyError, partySyncing,
    createWatchParty, joinWatchParty, leaveWatchParty, refreshWatchParty,
  } from '$lib/watch-together/client'
  import Copy from 'lucide-svelte/icons/copy'
  import Users from 'lucide-svelte/icons/users'
  import LogOut from 'lucide-svelte/icons/log-out'
  import RefreshCw from 'lucide-svelte/icons/refresh-cw'
  import { copyToClipboard } from '$lib/util/clipboard'

  heroMedia.set(null)
  let code = $state('')
  let busy = $state(false)
  let localError = $state('')

  async function run(action: () => Promise<void>) {
    busy = true; localError = ''
    try { await action() } catch (error) { localError = error instanceof Error ? error.message : String(error) }
    finally { busy = false }
  }

  function copyCode() {
    if (!$watchParty) return
    copyToClipboard($watchParty.roomCode)
  }
</script>

<div class="mx-auto max-w-3xl p-4 pb-24 sm:p-8">
  <div class="mb-6"><h1 class="text-2xl font-black">Watch Together</h1><p class="mt-1 text-sm text-muted-foreground">Keep playback synchronized across paired Izumi devices using the host's exact torrent or direct HTTP source. Debrid credentials stay on each device.</p></div>
  {#if localError || $partyError}<div class="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{localError || $partyError}</div>{/if}
  {#if !$watchParty}
    <div class="grid gap-4 sm:grid-cols-2">
      <section class="rounded-2xl border border-border bg-secondary/30 p-5"><Users size={28} class="mb-3 text-theme" /><h2 class="text-lg font-black">Host a room</h2><p class="mb-5 mt-1 text-sm text-muted-foreground">Create a code, start an episode normally, and your controls become the room controls.</p><button disabled={busy} onclick={() => run(createWatchParty)} class="w-full rounded-lg bg-theme py-2.5 font-black text-white">Create room</button></section>
      <section class="rounded-2xl border border-border bg-secondary/30 p-5"><h2 class="text-lg font-black">Join a room</h2><p class="mb-4 mt-1 text-sm text-muted-foreground">Enter the code shown on the host device. Izumi verifies the room before joining.</p><input bind:value={code} maxlength="6" placeholder="ABC234" class="mb-3 w-full rounded-lg bg-input px-4 py-3 text-center font-mono text-xl font-black uppercase tracking-[0.3em]" /><button disabled={busy} onclick={() => run(() => joinWatchParty(code))} class="w-full rounded-lg bg-secondary py-2.5 font-black hover:bg-accent">{busy ? 'Checking room…' : 'Join room'}</button></section>
    </div>
    <p class="mt-5 rounded-lg bg-secondary/30 p-3 text-xs text-muted-foreground">Watch Together currently uses Izumi’s encrypted device-sync group. Pair devices first in Settings → Device sync. A later public-room transport can remove that prerequisite without changing the playback protocol.</p>
  {:else}
    <section class="rounded-2xl border border-theme/30 bg-theme/5 p-6 text-center">
      <div class="text-xs font-black uppercase tracking-widest text-theme">{$watchParty.role === 'host' ? 'Hosting' : 'Joined'} room</div>
      <button onclick={copyCode} class="mx-auto mt-2 flex items-center gap-3 rounded-xl px-4 py-2 font-mono text-4xl font-black tracking-[0.2em] hover:bg-secondary"><span>{$watchParty.roomCode}</span><Copy size={19} /></button>
      <p class="mt-3 text-sm text-muted-foreground">{$watchParty.role === 'host' ? 'Start any episode. Its source and your play, pause and seek controls will be sent to the room.' : 'The host’s exact source will open using your own local debrid account when needed.'}</p>
      {#if $partySyncing}<div class="mt-3 text-sm font-bold text-theme">Resolving the host’s episode…</div>{/if}
    </section>
    <div class="mt-5 flex items-center justify-between"><h2 class="font-black">Participants ({$partyParticipants.length})</h2><button onclick={refreshWatchParty} class="grid size-9 place-items-center rounded-lg bg-secondary"><RefreshCw size={16} /></button></div>
    <div class="mt-2 space-y-2">{#each $partyParticipants as participant (participant.deviceId)}<div class="flex items-center gap-3 rounded-lg bg-secondary/40 px-4 py-3"><span class="grid size-8 place-items-center rounded-full bg-theme/15 font-black text-theme">{participant.name.slice(0, 1).toUpperCase()}</span><span class="flex-1 font-bold">{participant.name}</span><span class="rounded-full bg-background px-2 py-1 text-[0.65rem] font-black uppercase text-muted-foreground">{participant.role}</span></div>{/each}</div>
    <button onclick={leaveWatchParty} class="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-destructive/40 py-2.5 font-bold text-destructive"><LogOut size={17} /> Leave room</button>
  {/if}
</div>
