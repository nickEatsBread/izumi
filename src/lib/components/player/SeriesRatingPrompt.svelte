<script lang="ts">
  // "You finished <title> — how was it?" Raised by series-rating.ts when the last episode of a
  // finished title completes and a tracker is connected. App-level like UpNextOverlay, so it works
  // over either player and survives the player closing: a finale reached by backing out after the
  // watch threshold shows it over the series page instead.
  //
  // The score control is a ten-segment scale rather than a dropdown: at the end of a series the
  // question is the whole screen and ONE tap answers it — clicking a segment saves, no separate
  // Save step. The descriptor under the scale ("Very Good") tells a mouse user what the number
  // they are hovering means before they commit; the confirmation offers "Change" for a mis-tap.
  import { onMount, tick } from 'svelte'
  import { fade, fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import Check from '@lucide/svelte/icons/check'
  import {
    seriesRatingPrompt, dismissSeriesRating, saveSeriesRating, connectedTrackerLabels,
  } from '$lib/player/series-rating'
  import { seriesRatingPrompt as seriesRatingPromptEnabled } from '$lib/settings/ui'
  import { banner, cover, title } from '$lib/anilist/media'
  import { SCORE_LABELS } from '$lib/trackers/status'
  import * as h from '$lib/haptics'
  import { m } from '$lib/paraglide/messages.js'

  let value = $state(0) // chosen 1-10; 0 = nothing yet
  let hover = $state(0) // mouse preview, never committed
  let saved = $state(false)
  let root = $state<HTMLElement>()
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const shown = $derived(hover || value)
  const prompt = $derived($seriesRatingPrompt)
  const trackers = $derived(prompt ? connectedTrackerLabels() : [])
  const isMovie = $derived((prompt?.media.episodes ?? 0) <= 1)

  // Fresh form per request. Focus lands on the scale so arrows/d-pad go straight to choosing.
  $effect(() => {
    if (!prompt) return
    value = 0; hover = 0; saved = false
    void tick().then(() => root?.querySelector<HTMLElement>('[data-score="7"]')?.focus({ preventScroll: true }))
  })

  function pick(n: number) {
    value = Math.max(1, Math.min(10, n))
    h.tap()
  }

  function focusSegment(n: number) {
    root?.querySelector<HTMLElement>(`[data-score="${n}"]`)?.focus({ preventScroll: true })
  }

  async function save() {
    if (!prompt || !value || saved) return
    saved = true
    h.success()
    // Best-effort by contract (the tracker queue retries); the confirmation lingers long enough to
    // read — and to hit "Change" after a mis-tap — before the card leaves.
    void saveSeriesRating(prompt, value)
    clearTimeout(saveTimer)
    saveTimer = setTimeout(dismissSeriesRating, 2200)
    // The focused segment just unmounted; keep controller focus inside the card.
    void tick().then(() => root?.querySelector<HTMLElement>('[data-rating-change]')?.focus({ preventScroll: true }))
  }

  /** Back to the scale from the confirmation; the next pick overwrites the saved score. */
  function change() {
    clearTimeout(saveTimer)
    saved = false
    hover = 0
    void tick().then(() => focusSegment(value || 7))
  }

  function dontAsk() {
    seriesRatingPromptEnabled.set(false)
    dismissSeriesRating()
  }

  // Arrow keys move the score, not the player: this dialog sits over a player whose own hotkeys
  // would otherwise seek. Digits pick directly (0 = 10). Enter on a segment picks AND saves.
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismissSeriesRating(); return }
    if (saved) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation()
      pick((value || 0) + 1); focusSegment(value)
      return
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation()
      pick((value || 2) - 1); focusSegment(value)
      return
    }
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault(); e.stopPropagation()
      pick(e.key === '0' ? 10 : Number(e.key)); focusSegment(value)
      return
    }
    if (e.key === 'Enter' && e.target instanceof HTMLElement && e.target.dataset.score) {
      e.preventDefault(); e.stopPropagation()
      pick(Number(e.target.dataset.score))
      void save()
      return
    }
    // Space/letters are player hotkeys (pause, fullscreen…) that must not fire under the dialog.
    if (e.key.length === 1 || e.key === ' ') e.stopPropagation()
  }

  onMount(() => {
    const close = () => dismissSeriesRating()
    window.addEventListener('series-rating-close', close)
    return () => {
      window.removeEventListener('series-rating-close', close)
      clearTimeout(saveTimer)
    }
  })
</script>

{#if prompt}
  <div
    bind:this={root}
    role="dialog"
    aria-modal="true"
    aria-label={m.series_rating_eyebrow()}
    data-nav-trap
    tabindex="-1"
    class="series-rating fixed inset-0 z-[90] flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center"
    onkeydown={onKey}
  >
    <div in:fade={{ duration: 200 }} class="absolute inset-0 bg-black/60"></div>
    <div
      in:fly={{ y: 28, duration: 260, easing: cubicOut }}
      class="series-rating-card relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-neutral-950 text-white shadow-2xl"
    >
      {#if banner(prompt.media) || cover(prompt.media)}
        <div class="relative aspect-[16/7] overflow-hidden">
          <img src={banner(prompt.media) || cover(prompt.media)} alt="" decoding="async" class="h-full w-full object-cover" />
          <div class="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/40 to-black/10"></div>
        </div>
      {/if}
      <div class="p-5 sm:p-6 {banner(prompt.media) || cover(prompt.media) ? '-mt-8 relative' : ''}">
        <p class="text-xs font-black uppercase tracking-[0.18em] text-theme">{m.series_rating_eyebrow()}</p>
        <h2 class="mt-1 text-xl font-black leading-tight">{title(prompt.media)}</h2>
        <p class="mt-1.5 text-sm text-white/65">
          {isMovie ? m.series_rating_question_movie() : m.series_rating_question_series({ total: prompt.media.episodes ?? 0 })}
        </p>

        {#if saved}
          <div in:fly={{ y: 10, duration: 200, easing: cubicOut }} class="mt-6 flex items-center gap-3 rounded-2xl bg-theme/15 px-4 py-3.5 text-theme">
            <span class="grid size-9 shrink-0 place-items-center rounded-full bg-theme text-white"><Check size={18} strokeWidth={3} /></span>
            <span class="min-w-0">
              <span class="block text-sm font-black">{m.series_rating_saved({ score: value })} · {SCORE_LABELS[value]}</span>
              <span class="block truncate text-xs text-theme/80">{trackers.length ? m.series_rating_saves_to({ trackers: trackers.join(' · ') }) : m.series_rating_saves_local()}</span>
            </span>
            <button type="button" data-focusable data-rating-change onclick={change} class="ml-auto h-9 shrink-0 rounded-lg px-3 text-sm font-bold text-white/80 hover:bg-white/10">
              {m.series_rating_change()}
            </button>
          </div>
        {:else}
          <!-- The scale: ten segments fill up to the hovered/chosen point. Pure compositor work
               (opacity + transform) so it stays smooth over a video surface. -->
          <!-- Programmatically focusable only; the segments themselves are the tab stops. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <div class="mt-5 flex gap-1" role="radiogroup" tabindex="-1" aria-label={m.series_rating_pick()} onpointerleave={() => (hover = 0)}>
            {#each Array.from({ length: 10 }, (_, i) => i + 1) as n (n)}
              <button
                type="button"
                role="radio"
                aria-checked={value === n}
                aria-label={`${n} · ${SCORE_LABELS[n]}`}
                data-focusable
                data-score={n}
                class="score-seg h-11 min-w-0 flex-1 rounded-md transition-colors duration-150 {n <= shown ? 'bg-theme' : 'bg-white/10 hover:bg-white/20'} {n === value ? 'ring-2 ring-white/70 ring-offset-2 ring-offset-neutral-950' : ''}"
                style="animation-delay:{(n - 1) * 26}ms"
                onpointerenter={(e) => { if (e.pointerType === 'mouse') hover = n }}
                onclick={() => { pick(n); void save() }}
              ></button>
            {/each}
          </div>
          <div class="mt-3 flex h-9 items-baseline gap-2" aria-live="polite">
            {#key shown}
              <span in:fade={{ duration: 120 }} class="text-2xl font-black tabular-nums leading-none">{shown ? `${shown}/10` : '—'}</span>
              <span in:fade={{ duration: 120 }} class="truncate text-sm font-semibold text-white/65">{shown ? SCORE_LABELS[shown] : m.series_rating_pick()}</span>
            {/key}
          </div>
          <p class="mt-1 truncate text-xs text-white/45">{trackers.length ? m.series_rating_saves_to({ trackers: trackers.join(' · ') }) : m.series_rating_saves_local()}</p>

          <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" data-focusable onclick={dontAsk} class="h-9 rounded-lg px-2 text-xs font-semibold text-white/45 hover:text-white/80 sm:self-center">
              {m.series_rating_dont_ask()}
            </button>
            <button type="button" data-focusable onclick={dismissSeriesRating} class="h-11 rounded-xl px-4 text-sm font-bold text-white/70 hover:bg-white/10">
              {m.series_rating_not_now()}
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* Segments rise in one after another as the card lands; the stagger is the only "entrance" the
     scale needs. Transform-only, so it costs no layout over the video. */
  .score-seg {
    transform-origin: bottom;
    animation: score-seg-in 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    transition-property: background-color, transform, box-shadow;
  }
  .score-seg:hover, .score-seg:focus-visible { transform: scaleY(1.12); outline: none; }
  @keyframes score-seg-in {
    from { opacity: 0; transform: scaleY(0.35); }
    to { opacity: 1; transform: none; }
  }
  .series-rating-card { will-change: transform, opacity; }
</style>
