<script lang="ts">
  import { debridCaching } from '$lib/player/session'
  import { formatBytes, formatSpeed } from '$lib/util/format'
  import Loader from 'lucide-svelte/icons/loader-circle'
  import Users from 'lucide-svelte/icons/users'
  import Gauge from 'lucide-svelte/icons/gauge'

  const c = $derived($debridCaching)
  // Show the EXACT percent the provider reports — no rounding — so a torrent at 99.x% never
  // reads as a finished "100%". Only clamped to the 0–100 range.
  const pct = $derived(c?.info.progress != null ? Math.max(0, Math.min(100, c.info.progress)) : null)
  const stageLabel = $derived(
    c?.info.stage === 'queued' ? 'Queued at the source…'
    : c?.info.stage === 'downloading' ? 'Caching to the debrid cloud…'
    : c?.info.stage === 'ready' ? 'Ready — starting…'
    : 'Preparing…',
  )
</script>

{#if c}
  <!-- Full-screen over everything, FULLY OPAQUE so the source picker underneath doesn't bleed
       through. NO backdrop-blur (Deck WebKit). -->
  <div class="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-black px-6 text-white">
    {#if c.cover}
      <!-- static darkened cover as the backdrop (no blur filter) -->
      <img src={c.cover} alt="" class="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-15" />
    {/if}

    <!-- Ambient downloading glow: rises from the bottom, fades in, then breathes slowly.
         Sits above the darkened cover, below the (relative) text column. -->
    <div class="glow pointer-events-none absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-sky-500/25 via-pink-500/10 to-transparent"></div>

    <div class="relative flex w-full max-w-md flex-col items-center gap-5 text-center">
      <div class="flex items-center gap-2 text-sm uppercase tracking-wide text-white/60">
        <Loader size={16} class="animate-spin" /> Caching via {c.provider}
      </div>

      <h2 class="text-xl font-bold">{c.title}{c.episode != null ? ` · Ep ${c.episode}` : ''}</h2>

      {#if pct != null}
        <div class="text-6xl font-black tabular-nums">{pct}<span class="text-2xl">%</span></div>
        <div class="h-2 w-full overflow-hidden rounded-full bg-primary/20">
          <div class="h-full rounded-full bg-primary transition-[width] duration-500" style="width:{pct}%"></div>
        </div>
        <p class="text-sm text-white/70">{stageLabel}</p>
      {:else}
        <div class="text-lg text-white/70">{stageLabel}</div>
      {/if}

      <div class="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm text-white/80">
        {#if c.info.seeders != null}
          <span class="flex items-center gap-1"><Users size={14} /> {c.info.seeders} seeders</span>
        {/if}
        {#if c.info.speed}
          <span class="flex items-center gap-1"><Gauge size={14} /> {formatSpeed(c.info.speed)}</span>
        {/if}
        {#if c.info.total}
          <span class="tabular-nums">{formatBytes(c.info.downloaded)}{c.info.downloaded != null ? ' / ' : ''}{formatBytes(c.info.total)}</span>
        {/if}
      </div>

      {#if c.info.filename}
        <p class="max-w-full truncate text-xs text-white/40">{c.info.filename}</p>
      {/if}

      <button data-focusable onclick={() => c.cancel()}
              class="mt-2 rounded-lg bg-white/10 px-5 py-2 text-sm font-semibold transition hover:bg-white/20">
        Cancel
      </button>
      <p class="text-xs text-white/40">Cancelling keeps it caching in the background — it'll be instant next time.</p>
    </div>
  </div>
{/if}

<style>
  @keyframes glowIn { from { opacity: 0 } to { opacity: 1 } }
  @keyframes breathe { 0%, 100% { opacity: .6 } 50% { opacity: 1 } }
  .glow { animation: glowIn 1.2s ease-out, breathe 4s ease-in-out 1.2s infinite; }
</style>
