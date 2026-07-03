<script lang="ts">
  // izumi-style source picker shown after Play resolves the cached streams. Lists
  // each source (quality • provider • seeders • size) and starts the chosen one.
  import { streamPicker } from '$lib/player/session'
  import { describe, qualityLabel, type StreamInfo } from '$lib/stremio/addon'
  import { playStream, type PlayState } from '$lib/stremio/play'

  const pick = $derived($streamPicker)
  const infos = $derived(pick ? pick.streams.map(describe) : ([] as StreamInfo[]))
  let busy = $state(false)
  let error = $state('')

  async function choose(info: StreamInfo) {
    if (busy || !pick) return
    busy = true
    error = ''
    await playStream(pick.media, pick.episode, info.stream, (s: PlayState) => {
      if (s.status === 'playing') streamPicker.set(null)
      else if (s.status === 'error') { error = s.message ?? 'Playback failed.'; busy = false }
    })
  }
  function close() { if (!busy) streamPicker.set(null) }
</script>

{#if pick}
  <div
    class="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
    onclick={close}
    onkeydown={(e) => e.key === 'Escape' && close()}
    role="presentation"
  >
    <div class="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl" onclick={(e) => e.stopPropagation()} role="presentation">
      <div class="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 class="text-base font-black">Select a source</h2>
          <p class="text-xs text-muted-foreground">{infos.length} cached {infos.length === 1 ? 'source' : 'sources'} available</p>
        </div>
        <button data-focusable onclick={close} disabled={busy} class="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40" aria-label="Close">✕</button>
      </div>

      {#if error}
        <p class="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>
      {/if}

      <div class="max-h-[60vh] space-y-1 overflow-y-auto p-2">
        {#each infos as info (info.stream.url ?? info.label)}
          <button
            data-focusable
            disabled={busy}
            onclick={() => choose(info)}
            class="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span class="grid w-12 shrink-0 place-items-center rounded bg-secondary py-1 text-xs font-black tabular-nums">{qualityLabel(info.quality)}</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold">{info.label}</span>
              <span class="mt-0.5 flex flex-wrap items-center gap-x-3 text-[0.7rem] text-muted-foreground">
                {#if info.provider}<span class="font-bold text-theme">{info.provider}</span>{/if}
                {#if info.seeders != null}<span>👤 {info.seeders}</span>{/if}
                {#if info.size}<span>💾 {info.size}</span>{/if}
              </span>
            </span>
            <span class="shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" aria-hidden="true">▶</span>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}
