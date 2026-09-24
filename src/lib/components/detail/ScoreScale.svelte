<script lang="ts">
  // The viewer's own 1-10 rating. Shared by the series page's "Your rating" row and the list editor,
  // drawn in whichever style the viewer picked (Settings → Interface, or the editor's style switch):
  //   bar      — ten segments filling up to the score (default)
  //   stars    — 5 half-stars (the left half of a star is the odd step), compact and familiar
  //   numbers  — 1-10 chips, one tap per number
  //   dropdown — a menu of 1-10 with the descriptor greyed beside each number
  // One click commits (no Save step) and clicking the current score clears it. A mouse previews
  // the score + descriptor ("8/10 · Very Good") before committing; touch has no hover, so the
  // label follows the committed value.
  //
  // Keyboard / controller: Left/Right move the preview without committing (a d-pad sweep must not
  // write ten ratings); Enter/A commits; digits commit directly (0 = 10). Up/Down are left alone so
  // spatial navigation can leave the row.
  import { SCORE_LABELS } from '$lib/trackers/status'
  import { ratingStyle, type RatingStyle } from '$lib/settings/ui'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import * as h from '$lib/haptics'

  let {
    value, onpick, label = 'Your rating', compact = false, style, hint = '',
  }: {
    /** Committed score, 0-10 (0 = not rated). */
    value: number
    /** Commit a new score, 0-10 (0 clears). */
    onpick: (score10: number) => void
    label?: string
    /** Denser layout for the list editor popover. */
    compact?: boolean
    /** Override the viewer's chosen style (defaults to the setting). */
    style?: RatingStyle
    /** Where the rating went (e.g. "Saved to AniList"). Shown briefly after each pick, not always. */
    hint?: string
  } = $props()

  const kind = $derived(style ?? $ratingStyle)
  let preview = $state(0) // hover / focus preview, never committed
  let root = $state<HTMLElement>()
  let flash = $state(false) // the hint is a confirmation, not a permanent caption
  let flashTimer: ReturnType<typeof setTimeout> | undefined
  const shown = $derived(preview || value)

  const DROPDOWN_OPTIONS = SCORE_LABELS.map((descriptor, n) => n === 0
    ? { value: '0', label: '–', description: 'Not rated' }
    : { value: String(n), label: String(n), description: descriptor })

  function commit(n: number, toggle = true) {
    const next = toggle && n === value ? 0 : Math.max(0, Math.min(10, n))
    preview = 0
    onpick(next)
    if (next) h.success()
    else h.tap()
    if (hint) {
      flash = true
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => (flash = false), 2500)
    }
  }

  function focusStep(n: number) {
    root?.querySelector<HTMLElement>(`[data-score="${n}"]`)?.focus({ preventScroll: true })
  }

  /** Stars: which of the 10 steps the pointer is over (left half of star i = 2i+1). */
  function starStep(e: MouseEvent, i: number): number {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return i * 2 + (e.clientX - r.left < r.width / 2 ? 1 : 2)
  }

  function onKey(e: KeyboardEvent) {
    const steps = 10
    const at = preview || value || 0
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next = Math.max(1, Math.min(steps, at + (e.key === 'ArrowRight' ? 1 : -1)))
      // At the ends, let spatial navigation take the key so focus can leave the row.
      if (next === at) return
      e.preventDefault(); e.stopPropagation()
      preview = next
      focusStep(kind === 'stars' ? Math.ceil(next / 2) * 2 : next)
      return
    }
    if (e.key === 'Enter' && preview) {
      e.preventDefault(); e.stopPropagation()
      commit(preview, false)
      return
    }
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault(); e.stopPropagation()
      commit(e.key === '0' ? 10 : Number(e.key), false)
    }
  }

  const STAR = 'M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.6L12 17.4l-5.9 3.3 1.2-6.6-4.8-4.6 6.6-.9z'
</script>

{#snippet readout()}
  <span class="min-w-0 truncate text-sm {shown ? 'text-foreground' : 'text-muted-foreground'}">
    {#if shown}<span class="font-black tabular-nums">{shown}/10</span> <span class="text-muted-foreground">· {SCORE_LABELS[shown]}</span>{:else}Not rated{/if}
  </span>
{/snippet}

<div bind:this={root} class="score-scale min-w-0" role="group" aria-label={label}>
  {#if kind === 'dropdown'}
    <div class="flex items-center gap-3">
      <span class="shrink-0 text-sm font-bold">{label}</span>
      <div class="min-w-0 {compact ? 'flex-1' : 'w-56'}">
        <SelectMenu value={String(value)} options={DROPDOWN_OPTIONS} onChange={(v) => commit(Number(v) || 0, false)} ariaLabel={label} floating separator="" columns />
      </div>
    </div>
  {:else}
    <div class="flex items-center gap-x-3 gap-y-1.5 {kind === 'stars' && !compact ? 'flex-wrap' : 'flex-col items-stretch'}" aria-live="polite">
      <div class="flex items-baseline gap-2 {kind === 'stars' && !compact ? 'order-2' : ''}">
        {#if kind !== 'stars' || compact}<span class="shrink-0 text-sm font-bold">{label}</span>{/if}
        {@render readout()}
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div role="radiogroup" tabindex="-1" aria-label={label}
           class="flex {kind === 'stars' ? 'gap-0.5' : 'gap-1'} {kind === 'bar' && !compact ? 'max-w-sm' : ''} {kind === 'stars' && !compact ? 'order-1' : ''}"
           onpointerleave={() => (preview = 0)}
           onfocusout={(e) => { if (!root?.contains(e.relatedTarget as Node | null)) preview = 0 }}
           onkeydown={onKey}>
        {#if kind === 'stars'}
          {#each [0, 1, 2, 3, 4] as i (i)}
            {@const fill = Math.max(0, Math.min(2, shown - i * 2))}
            <button type="button" role="radio" data-focusable data-score={i * 2 + 2}
                    aria-checked={value === i * 2 + 1 || value === i * 2 + 2}
                    aria-label={`${i + 1} star${i ? 's' : ''} — left half ${i * 2 + 1}, right half ${i * 2 + 2}`}
                    class="star relative grid {compact ? 'size-8' : 'size-9'} place-items-center rounded-md"
                    onpointermove={(e) => { if (e.pointerType === 'mouse') preview = starStep(e, i) }}
                    onclick={(e) => commit(e.detail === 0 ? (preview || i * 2 + 2) : starStep(e, i))}>
              <svg viewBox="0 0 24 24" class="absolute {compact ? 'size-7' : 'size-8'}" aria-hidden="true"><path d={STAR} class="fill-foreground/15" /></svg>
              <svg viewBox="0 0 24 24" class="absolute {compact ? 'size-7' : 'size-8'} {preview && preview !== value ? 'opacity-70' : ''}" aria-hidden="true"
                   style="clip-path: inset(0 {100 - fill * 50}% 0 0)"><path d={STAR} class="fill-theme" /></svg>
            </button>
          {/each}
        {:else}
          {#each Array.from({ length: 10 }, (_, k) => k + 1) as n (n)}
            <button type="button" role="radio" data-focusable data-score={n}
                    aria-checked={value === n}
                    aria-label={`${n} · ${SCORE_LABELS[n]}${value === n ? ' (click to clear)' : ''}`}
                    title={value === n ? 'Clear rating' : `${n} · ${SCORE_LABELS[n]}`}
                    onpointerenter={(e) => { if (e.pointerType === 'mouse') preview = n }}
                    onclick={() => commit(n)}
                    class={kind === 'bar'
                      ? `seg min-w-0 flex-1 rounded-md bg-clip-content ${compact ? 'h-7 py-2.5' : 'h-8 py-2.5'} ${n <= shown ? (preview && preview !== value ? 'bg-theme/60' : 'bg-theme') : 'bg-foreground/10 hover:bg-foreground/20'}`
                      : `chip grid min-w-0 flex-1 place-items-center rounded-md text-sm font-black tabular-nums ${compact ? 'h-8' : 'h-9 max-w-10'} ${n === shown ? (preview && preview !== value ? 'bg-theme/60 text-white' : 'bg-theme text-white') : 'bg-foreground/5 text-muted-foreground hover:bg-foreground/15 hover:text-foreground'}`}
            >{kind === 'numbers' ? n : ''}</button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
  {#if hint && flash}<p class="mt-1.5 truncate text-xs text-muted-foreground">{hint}</p>{/if}
</div>

<style>
  .star, .seg, .chip { transition: background-color 120ms, transform 120ms, color 120ms; }
  .star:hover, .star:focus-visible, .chip:hover, .chip:focus-visible { transform: scale(1.08); }
  /* Thin visual bar, full-height hit area: the padding is transparent (bg-clip-content). */
  .seg:hover, .seg:focus-visible { padding-top: 0.5rem; padding-bottom: 0.5rem; }
  .star:focus-visible, .seg:focus-visible, .chip:focus-visible { outline: 2px solid hsl(var(--foreground)); outline-offset: 2px; }
</style>
