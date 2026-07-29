<script lang="ts">
  import { watchParty, partyParticipants, type PartyParticipant } from '$lib/watch-together/client'
  import Users from 'lucide-svelte/icons/users'

  let { floating = false }: { floating?: boolean } = $props()
  const text = (participant: PartyParticipant) => {
    if (participant.readiness === 'buffering') return 'Buffering'
    if (participant.readiness === 'loading') return 'Loading'
    if (participant.readiness === 'waiting') return 'Waiting'
    return participant.paused ? 'Ready · paused' : 'Ready'
  }
  const color = (participant: PartyParticipant) =>
    participant.readiness === 'buffering' ? 'bg-amber-400'
    : participant.readiness === 'loading' ? 'bg-sky-400 animate-pulse'
    : participant.readiness === 'ready' ? 'bg-emerald-400'
    : 'bg-white/35'
</script>

{#if $watchParty && $partyParticipants.length}
  <div class="{floating ? 'pointer-events-none fixed right-4 top-12 z-[65]' : ''} max-w-64 rounded-xl border border-white/10 bg-black/70 p-2 text-white shadow-xl backdrop-blur">
    <div class="mb-1.5 flex items-center gap-1.5 px-1 text-[0.65rem] font-black uppercase tracking-wide text-white/55">
      <Users size={12} /> Room {$watchParty.roomCode}
    </div>
    <div class="space-y-1">
      {#each $partyParticipants.slice(0, 5) as participant (participant.deviceId)}
        <div class="flex items-center gap-2 rounded-md bg-white/5 px-2 py-1.5">
          <span class="size-2 shrink-0 rounded-full {color(participant)}"></span>
          <span class="min-w-0 flex-1 truncate text-xs font-bold">{participant.name}</span>
          <span class="shrink-0 text-[0.62rem] text-white/60">{text(participant)}</span>
        </div>
      {/each}
    </div>
  </div>
{/if}
