<script lang="ts">
  // Shown once (until dismissed for good) before a Watch Together room is created, and ONLY when
  // the host is actually on debrid mode with a key set.
  //
  // Izumi shares the host's resolved source as-is, which on debrid means the account-bound CDN
  // link. That is what lets guests watch without a debrid account of their own — but it also means
  // the host's link is fetched from every guest's IP address. The wording below follows what the
  // providers' own terms say, so the host can make an informed call.
  import { fade } from 'svelte/transition'
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert'
  import { debridRoomNoticeAck } from '$lib/settings/ui'

  let { onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void } = $props()

  let dontShowAgain = $state(false)
  let dialogEl = $state<HTMLElement>()

  function confirm() {
    if (dontShowAgain) debridRoomNoticeAck.set(true)
    onConfirm()
  }

  // Focus the dialog on open so screen readers land inside it and Escape reaches the handler.
  $effect(() => { dialogEl?.focus() })
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onCancel() }} />

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
     transition:fade={{ duration: 120 }}
     role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
  <div bind:this={dialogEl} tabindex="-1"
       class="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-background p-6 outline-none"
       role="dialog" aria-modal="true" aria-labelledby="debrid-room-notice-title">
    <div class="mb-4 flex items-center gap-3">
      <TriangleAlert size={22} class="shrink-0 text-yellow-500" />
      <h2 id="debrid-room-notice-title" class="text-lg font-black">Before you host on debrid</h2>
    </div>

    <div class="space-y-3 text-sm text-muted-foreground">
      <p>
        Guests play <strong class="text-foreground">your</strong> resolved debrid link. Izumi sends it to the
        room as-is so nobody else needs their own account — which means your link gets streamed from
        every guest's IP address, at the same time as yours.
      </p>
      <p>
        Debrid providers log the IP addresses that connect to an account specifically to detect
        sharing. Their terms treat both account sharing and passing on generated links as
        violations: Real-Debrid says sharing "will lead to a suspension", AllDebrid and Debrid-Link
        restrict accounts to their owner alone, and Debrid-Link states a breach means the account is
        "permanently blocked without notice".
      </p>
      <p>
        This applies even when the guests are people you know and the room is small. A handful of
        simultaneous streams from scattered IPs looks the same from the provider's side as a
        resold account.
      </p>
      <p class="text-foreground">
        Lower-risk options: have each guest add their own debrid key, or switch Torrent playback to
        <strong>Direct</strong> in Settings → Extensions so the room shares an infohash instead of
        your link.
      </p>
      <p class="text-xs">
        Provider policies change — check your provider's current terms before hosting. Your
        subscription is your own responsibility.
      </p>
    </div>

    <label class="mt-5 flex cursor-pointer items-center gap-2.5 text-sm">
      <input type="checkbox" bind:checked={dontShowAgain} class="h-4 w-4 accent-theme" />
      <span>Don't show this again</span>
    </label>

    <div class="mt-5 flex gap-2">
      <button onclick={confirm} data-focusable
              class="flex-1 rounded-lg bg-theme py-2.5 font-black text-white">I understand — create room</button>
      <button onclick={onCancel} data-focusable
              class="rounded-lg bg-secondary px-4 py-2.5 font-bold hover:bg-accent">Cancel</button>
    </div>
  </div>
</div>
