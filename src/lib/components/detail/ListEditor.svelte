<script lang="ts">
  // "Edit list" popover: status + episodes-watched + a 0-10 descriptive score, saved to every
  // connected tracker (AniList + MyAnimeList) via the shared tracker queue. Replaces the old
  // favourite heart + Planning-only bookmark + 5-star rating.
  import { onMount, untrack } from 'svelte'
  import type { Media } from '$lib/anilist/types'
  import { updateProgress, setScore, removeFromList, type AniStatus, type ProgressExtras } from '$lib/trackers'
  import { STATUS_ORDER, STATUS_LABEL, STATUS_COLOR, scoreLabel } from '$lib/trackers/status'
  import { listEditorOpen } from '$lib/player/session'
  import * as h from '$lib/haptics'
  import X from 'lucide-svelte/icons/x'
  import Trash2 from 'lucide-svelte/icons/trash-2'
  import Check from 'lucide-svelte/icons/check'
  import Minus from 'lucide-svelte/icons/minus'
  import Plus from 'lucide-svelte/icons/plus'

  let {
    media, initStatus, initProgress, initScore0to100, total, hasEntry, onclose, onsaved,
  }: {
    media: Media
    initStatus: AniStatus | undefined
    initProgress: number
    initScore0to100: number
    total: number // 0 = unknown
    hasEntry: boolean
    onclose: () => void
    onsaved: (patch: { status?: AniStatus; progress?: number; score?: number; removed?: boolean }) => void
  } = $props()

  // Seed the form ONCE from the props (untrack = intentional one-time capture; the editor remounts
  // on each open via `{#if showEditor}`, so these are always current, then independently editable).
  const initScore10 = untrack(() => Math.round(initScore0to100 / 10))
  let status = $state(untrack(() => initStatus ?? 'CURRENT'))
  let progress = $state(untrack(() => initProgress))
  let score10 = $state(initScore10) // 0-10
  let busy = $state(false)
  let dialog = $state<HTMLElement>()

  onMount(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    listEditorOpen.set(true)
    const close = () => onclose()
    window.addEventListener('list-editor-close', close)
    requestAnimationFrame(() => {
      dialog?.querySelector<HTMLElement>(`[data-status="${status}"]`)?.focus({ preventScroll: true })
    })
    return () => {
      listEditorOpen.set(false)
      window.removeEventListener('list-editor-close', close)
      if (previousFocus?.isConnected) requestAnimationFrame(() => previousFocus.focus({ preventScroll: true }))
    }
  })

  function changeProgress(delta: number) {
    progress = Math.max(0, total ? Math.min(total, progress + delta) : progress + delta)
    h.tap()
  }

  function changeScore(delta: number) {
    score10 = Math.max(0, Math.min(10, score10 + delta))
    h.tap()
  }

  // Date.now()/new Date() are allowed at app runtime (the ban is workflow-scripts only).
  const todayFuzzy = () => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() } }

  async function save() {
    if (busy) return
    busy = true
    // updateProgress/setScore are best-effort (they optimistically queue + retry, never throw), so
    // the patch applies regardless — the queue reconciles the trackers.
    let p = Math.max(0, total ? Math.min(progress, total) : progress)
    const extras: ProgressExtras = {}
    if (status === 'COMPLETED' && total) { p = total; extras.completedAt = todayFuzzy() } // fill + stamp finish
    const patch: { status?: AniStatus; progress?: number; score?: number; removed?: boolean } = {}
    if (status !== initStatus || p !== initProgress) {
      await updateProgress(media, p, status, extras)
      patch.status = status; patch.progress = p
    }
    // Compare the quantized 0-10 value, NOT the raw 0-100 init — otherwise an untouched AniList score
    // that isn't a multiple of 10 (e.g. 83) gets silently rounded (→80) on the first save.
    if (score10 !== initScore10) { await setScore(media, score10 * 10); patch.score = score10 * 10 }
    // Any write re-establishes the entry — clear a prior optimistic remove so the pill/badge show it.
    if (patch.status !== undefined || patch.score !== undefined) patch.removed = false
    h.success()
    onsaved(patch)
    onclose()
  }

  async function remove() {
    if (busy) return
    busy = true
    await removeFromList(media)
    h.success()
    onsaved({ removed: true })
    onclose()
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div
  bind:this={dialog}
  role="dialog" aria-modal="true" aria-label="Edit list entry" tabindex="-1"
  data-nav-trap
  class="fixed inset-0 z-50 grid h-[100dvh] place-items-end overflow-hidden bg-black/70 sm:place-items-center sm:p-4"
  onclick={(e) => { if (e.target === e.currentTarget) onclose() }}
  onkeydown={(e) => { if (e.key === 'Escape') onclose() }}
>
  <div class="flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl">
    <div class="flex shrink-0 items-center justify-between px-5 pb-3 pt-5">
      <h3 class="text-lg font-black">Edit list</h3>
      <button data-focusable aria-label="Close" onclick={onclose} class="grid size-8 place-items-center rounded-md hover:bg-accent"><X size={18} /></button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
    <fieldset class="mb-4">
      <legend class="mb-2 text-sm font-bold">Status</legend>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {#each STATUS_ORDER as s (s)}
          <button type="button" data-focusable data-status={s} aria-pressed={status === s}
            onclick={() => { status = s; h.tap() }}
            class="flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-bold transition-colors
              {status === s ? 'border-foreground/40 bg-secondary text-foreground' : 'border-border bg-background/40 text-muted-foreground hover:bg-secondary/60'}">
            <span class="size-2.5 shrink-0 rounded-full" style="background:{STATUS_COLOR[s]}"></span>
            <span class="truncate">{STATUS_LABEL[s]}</span>
          </button>
        {/each}
      </div>
    </fieldset>

    <div class="mb-3">
      <span class="mb-1.5 block text-sm font-bold">Episodes watched</span>
      <div class="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 rounded-lg bg-input p-1.5">
        <button type="button" data-focusable onclick={() => changeProgress(-1)} disabled={progress <= 0}
          aria-label="Decrease episodes watched"
          class="grid size-11 place-items-center rounded-md bg-background/70 transition-colors hover:bg-accent disabled:opacity-30"><Minus size={18} /></button>
        <label class="min-w-0 text-center">
          <span class="sr-only">Episodes watched</span>
          <input type="number" min="0" max={total || undefined} bind:value={progress}
            class="w-16 bg-transparent text-center text-lg font-black tabular-nums outline-none" />
          <span class="text-sm text-muted-foreground"> / {total || '?'}</span>
        </label>
        <button type="button" data-focusable onclick={() => changeProgress(1)} disabled={!!total && progress >= total}
          aria-label="Increase episodes watched"
          class="grid size-11 place-items-center rounded-md bg-background/70 transition-colors hover:bg-accent disabled:opacity-30"><Plus size={18} /></button>
      </div>
    </div>

    <div class="mb-5">
      <span class="mb-1.5 block text-sm font-bold">Score</span>
      <div class="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 rounded-lg bg-input p-1.5">
        <button type="button" data-focusable onclick={() => changeScore(-1)} disabled={score10 <= 0}
          aria-label="Decrease score"
          class="grid size-11 place-items-center rounded-md bg-background/70 transition-colors hover:bg-accent disabled:opacity-30"><Minus size={18} /></button>
        <div class="min-w-0 text-center">
          <div class="text-lg font-black tabular-nums">{score10 === 0 ? '—' : `${score10}/10`}</div>
          <div class="truncate text-xs text-muted-foreground">{scoreLabel(score10)}</div>
        </div>
        <button type="button" data-focusable onclick={() => changeScore(1)} disabled={score10 >= 10}
          aria-label="Increase score"
          class="grid size-11 place-items-center rounded-md bg-background/70 transition-colors hover:bg-accent disabled:opacity-30"><Plus size={18} /></button>
      </div>
    </div>
    </div>

    <div class="flex shrink-0 items-center gap-2 border-t border-border bg-card px-5 pt-3" style="padding-bottom: max(1rem, env(safe-area-inset-bottom));">
      {#if hasEntry}
        <button data-focusable onclick={remove} disabled={busy} aria-label="Remove from list"
                class="grid size-10 place-items-center rounded-md text-destructive hover:bg-accent disabled:opacity-40"><Trash2 size={18} /></button>
      {/if}
      <button data-focusable onclick={save} disabled={busy}
              class="ml-auto flex items-center gap-1.5 rounded-md bg-primary px-5 py-2 font-bold text-primary-foreground disabled:opacity-50">
        <Check size={16} /> {hasEntry ? 'Save' : 'Add to list'}
      </button>
    </div>
  </div>
</div>
