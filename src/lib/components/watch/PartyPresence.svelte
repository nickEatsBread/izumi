<script lang="ts">
  import {
    PARTY_REACTION_EMOJIS,
    partyReactions,
    sendPartyReaction,
    watchParty,
    partyParticipants,
    type PartyParticipant,
    type PartyReactionEmoji,
  } from '$lib/watch-together/client'
  import Users from '@lucide/svelte/icons/users'
  import Crown from '@lucide/svelte/icons/crown'
  import SmilePlus from '@lucide/svelte/icons/smile-plus'
  import * as h from '$lib/haptics'

  let { floating = false }: { floating?: boolean } = $props()
  let pickerOpen = $state(false)
  let reactionError = $state('')
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
  const horizontalOffset = (id: string) => {
    let hash = 0
    for (let i = 0; i < id.length; i += 1) hash = Math.imul(hash ^ id.charCodeAt(i), 31)
    return (Math.abs(hash) % 181) - 90
  }
  function react(emoji: PartyReactionEmoji) {
    pickerOpen = false
    reactionError = ''
    h.tap()
    void sendPartyReaction(emoji).catch((error) => {
      reactionError = error instanceof Error ? error.message : String(error)
      setTimeout(() => (reactionError = ''), 2_500)
    })
  }
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
          {#if participant.role === 'host'}<Crown size={11} class="shrink-0 text-amber-300" />{/if}
          <span class="min-w-0 flex-1 truncate text-xs font-bold">{participant.name}</span>
          <span class="shrink-0 text-[0.62rem] text-white/60">{text(participant)}</span>
        </div>
      {/each}
    </div>
  </div>
{/if}

{#if floating && $watchParty}
  <div class="pointer-events-none fixed inset-x-0 bottom-[30%] z-[72] flex justify-center" aria-live="polite" aria-atomic="false">
    {#each $partyReactions as reaction (reaction.id)}
      <div
        class="party-reaction absolute flex flex-col items-center"
        style={`--reaction-x:${horizontalOffset(reaction.id)}px`}
        aria-label={`${reaction.own ? 'You' : reaction.name} reacted ${reaction.emoji}`}
      >
        <span class="text-5xl drop-shadow-[0_5px_12px_rgba(0,0,0,.8)]">{reaction.emoji}</span>
        <span class="mt-1 max-w-28 truncate rounded-full bg-black/70 px-2 py-0.5 text-[0.62rem] font-black text-white/80 backdrop-blur">{reaction.own ? 'You' : reaction.name}</span>
      </div>
    {/each}
  </div>

  <div class="pointer-events-auto fixed bottom-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))] left-4 z-[74]" onpointerdown={(event) => event.stopPropagation()} onclick={(event) => event.stopPropagation()} role="presentation">
    {#if pickerOpen}
      <div class="mb-2 flex gap-1 rounded-full border border-white/15 bg-black/80 p-1.5 shadow-2xl backdrop-blur">
        {#each PARTY_REACTION_EMOJIS as emoji (emoji)}
          <button type="button" data-focusable aria-label={`React ${emoji}`} onclick={() => react(emoji)}
            class="grid size-10 place-items-center rounded-full text-xl transition hover:bg-white/15 active:scale-90">
            {emoji}
          </button>
        {/each}
      </div>
    {/if}
    <button type="button" data-focusable aria-label="Send a reaction" aria-expanded={pickerOpen}
      onclick={() => { pickerOpen = !pickerOpen; h.tap() }}
      class="grid size-11 place-items-center rounded-full border border-white/15 bg-black/75 text-white shadow-xl backdrop-blur transition hover:bg-black/90">
      <SmilePlus size={21} />
    </button>
    {#if reactionError}<p class="mt-2 max-w-52 rounded-lg bg-black/80 px-2 py-1 text-xs font-bold text-amber-300">{reactionError}</p>{/if}
  </div>
{/if}

<style>
  .party-reaction {
    animation: party-reaction-rise 4.1s cubic-bezier(.2,.75,.2,1) both;
  }
  @keyframes party-reaction-rise {
    0% { opacity: 0; transform: translate(var(--reaction-x), 28px) scale(.55); }
    12% { opacity: 1; transform: translate(var(--reaction-x), 0) scale(1.12); }
    22% { transform: translate(var(--reaction-x), -10px) scale(1); }
    78% { opacity: 1; }
    100% { opacity: 0; transform: translate(var(--reaction-x), -150px) scale(.85); }
  }
</style>
