<script lang="ts">
  // "Edit list" popover: status + episodes-watched + a 0-10 descriptive score, saved to every
  // connected tracker (AniList + MyAnimeList) via the shared tracker queue. Replaces the old
  // favourite heart + Planning-only bookmark + 5-star rating.
  import { untrack } from 'svelte'
  import type { Media } from '$lib/anilist/types'
  import { updateProgress, setScore, removeFromList, type AniStatus, type ProgressExtras } from '$lib/trackers'
  import { STATUS_ORDER, STATUS_LABEL, scoreLabel } from '$lib/trackers/status'
  import * as h from '$lib/haptics'
  import X from 'lucide-svelte/icons/x'
  import Trash2 from 'lucide-svelte/icons/trash-2'
  import Check from 'lucide-svelte/icons/check'

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
  let status = $state(untrack(() => initStatus ?? 'CURRENT'))
  let progress = $state(untrack(() => initProgress))
  let score10 = $state(untrack(() => Math.round(initScore0to100 / 10))) // 0-10
  let busy = $state(false)

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
    const patch: { status?: AniStatus; progress?: number; score?: number } = {}
    if (status !== initStatus || p !== initProgress) {
      await updateProgress(media, p, status, extras)
      patch.status = status; patch.progress = p
    }
    const score100 = score10 * 10
    if (score100 !== initScore0to100) { await setScore(media, score100); patch.score = score100 }
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
  role="dialog" aria-modal="true" aria-label="Edit list entry" tabindex="-1"
  class="fixed inset-0 z-50 grid place-items-end bg-black/70 sm:place-items-center sm:p-4"
  onclick={(e) => { if (e.target === e.currentTarget) onclose() }}
  onkeydown={(e) => { if (e.key === 'Escape') onclose() }}
>
  <div class="w-full max-w-sm rounded-t-2xl border border-border bg-card p-5 shadow-2xl sm:rounded-2xl">
    <div class="mb-4 flex items-center justify-between">
      <h3 class="text-lg font-black">Edit list</h3>
      <button data-focusable aria-label="Close" onclick={onclose} class="grid size-8 place-items-center rounded-md hover:bg-accent"><X size={18} /></button>
    </div>

    <label class="mb-3 block">
      <span class="mb-1 block text-sm font-bold">Status</span>
      <select bind:value={status} data-focusable class="w-full rounded-md bg-input px-3 py-2 text-sm">
        {#each STATUS_ORDER as s (s)}<option value={s}>{STATUS_LABEL[s]}</option>{/each}
      </select>
    </label>

    <label class="mb-3 block">
      <span class="mb-1 block text-sm font-bold">Episodes watched</span>
      <span class="flex items-center gap-2">
        <input type="number" min="0" max={total || undefined} bind:value={progress} data-focusable class="w-24 rounded-md bg-input px-3 py-2 text-sm" />
        <span class="text-sm text-muted-foreground">/ {total || '?'}</span>
      </span>
    </label>

    <label class="mb-4 block">
      <span class="mb-1 block text-sm font-bold">Score</span>
      <select bind:value={score10} data-focusable class="w-full rounded-md bg-input px-3 py-2 text-sm">
        {#each Array.from({ length: 11 }, (_, i) => 10 - i) as n (n)}
          <option value={n}>{n === 0 ? scoreLabel(0) : `${n} — ${scoreLabel(n)}`}</option>
        {/each}
      </select>
    </label>

    <div class="flex items-center gap-2">
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
