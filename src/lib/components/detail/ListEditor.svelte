<script lang="ts">
  // "Edit list": status + episodes watched + a 0-10 descriptive score, always saved on this device
  // and mirrored to every connected tracker via the shared tracker queue.
  //
  // Presentation: on desktop an anchored popover beside the button that opened it — the page stays
  // visible, a click outside or Escape closes it — and on phones a bottom sheet. Both animate in and
  // out (the old dialog just appeared). The score is the same ten-segment scale as the series page's
  // "Your rating" row: one click per choice with the whole scale in view. (It was a floating dropdown,
  // which the popover's transform turned into a mispositioned, clipped menu.)
  import { onMount, tick, untrack } from 'svelte'
  import { fade, fly, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import type { Media } from '$lib/anilist/types'
  import { updateProgress, setScore, removeFromList, type AniStatus, type ProgressExtras } from '$lib/trackers'
  import { STATUS_ORDER, STATUS_LABEL, STATUS_COLOR } from '$lib/trackers/status'
  import { listEditorOpen } from '$lib/player/session'
  import { WATCHLIST_ID, saveLocalTracking, setMediaInLocalList } from '$lib/library/local-lists'
  import { incognito } from '$lib/stores/incognito'
  import { isMobile } from '$lib/platform'
  import { rootZoom } from '$lib/components/cards/preview-pos'
  import ScoreScale from '$lib/components/detail/ScoreScale.svelte'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import { ratingStyle, ratingOnPage, ratingDisplayTipDone, type RatingStyle, type RatingOnPage } from '$lib/settings/ui'
  import * as h from '$lib/haptics'
  import X from '@lucide/svelte/icons/x'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import Check from '@lucide/svelte/icons/check'
  import Minus from '@lucide/svelte/icons/minus'
  import Plus from '@lucide/svelte/icons/plus'

  let {
    media, initStatus, initProgress, initScore0to100, total, hasEntry, canRemove = hasEntry, anchor, onclose, onsaved,
  }: {
    media: Media
    initStatus: AniStatus | undefined
    initProgress: number
    initScore0to100: number
    total: number // 0 = unknown
    hasEntry: boolean
    canRemove?: boolean
    /** The button that opened the editor. With one, desktop renders the anchored popover. */
    anchor?: HTMLElement
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
  let panel = $state<HTMLElement>()

  // Anchored popover only where there is something to anchor to and a pointer to click outside
  // with. Phones always get the sheet, whatever opened it.
  const popover = $derived(!!anchor && !$isMobile)
  const PANEL_WIDTH = 352
  const GAP = 8
  const EDGE = 8
  let place = $state({ left: 0, top: 0, width: PANEL_WIDTH, origin: 'top left', maxHeight: 0 })

  /** Sit under the anchor when it fits, else above it; never off the viewport. Local px (see the
   *  zoom caveat in menu-placement.ts): fixed-position coordinates live inside the root zoom. */
  function measure() {
    if (!anchor || !popover) return
    const zoom = rootZoom()
    const r = anchor.getBoundingClientRect()
    const vw = window.innerWidth / zoom
    const vh = window.innerHeight / zoom
    const a = { left: r.left / zoom, top: r.top / zoom, bottom: r.bottom / zoom }
    const width = Math.min(PANEL_WIDTH, vw - EDGE * 2)
    const height = panel?.offsetHeight ?? 440
    const below = vh - a.bottom - GAP - EDGE
    const above = a.top - GAP - EDGE
    const down = below >= height || below >= above
    const left = Math.max(EDGE, Math.min(a.left, vw - width - EDGE))
    const top = down ? a.bottom + GAP : Math.max(EDGE, a.top - GAP - Math.min(height, above))
    place = {
      left, top, width,
      origin: down ? 'top left' : 'bottom left',
      maxHeight: Math.max(240, down ? below : above),
    }
  }

  onMount(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    listEditorOpen.set(true)
    const close = () => onclose()
    window.addEventListener('list-editor-close', close)
    measure()
    void tick().then(() => {
      measure()
      dialog?.querySelector<HTMLElement>(`[data-status="${status}"]`)?.focus({ preventScroll: true })
    })
    // Popover: the page underneath stays live, so a click anywhere else is the dismissal — except
    // on the anchor itself, whose own handler re-opens (and would otherwise flash the editor).
    const outside = (event: PointerEvent) => {
      if (!popover) return
      const target = event.target as Node | null
      if (!target || panel?.contains(target) || anchor?.contains(target)) return
      onclose()
    }
    const remeasure = () => measure()
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', remeasure)
    window.addEventListener('scroll', remeasure, true)
    return () => {
      listEditorOpen.set(false)
      window.removeEventListener('list-editor-close', close)
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', remeasure)
      window.removeEventListener('scroll', remeasure, true)
      if (previousFocus?.isConnected) requestAnimationFrame(() => previousFocus.focus({ preventScroll: true }))
    }
  })

  function changeProgress(delta: number) {
    progress = Math.max(0, total ? Math.min(total, progress + delta) : progress + delta)
    h.tap()
  }

  // The rating's look is the viewer's choice, adjustable right where they rate (and in Settings).
  const STYLE_CHOICES: { value: RatingStyle; label: string }[] = [
    { value: 'bar', label: 'Bar' },
    { value: 'stars', label: 'Stars' },
    { value: 'numbers', label: '1–10' },
    { value: 'dropdown', label: 'Menu' },
  ]
  const ON_PAGE_CHOICES: { value: RatingOnPage; label: string }[] = [
    { value: 'always', label: 'Always' },
    { value: 'rated', label: 'Once rated' },
    { value: 'never', label: 'Hidden' },
  ]

  // The display panel is a one-time discovery aid. Captured at open so it stays put while the viewer
  // is mid-adjustment; their first change marks it done and swaps in a pointer to Settings.
  let displayPanel = $state(untrack(() => !$ratingDisplayTipDone))
  let customized = $state(false)
  function customize(apply: () => void) {
    apply()
    h.tap()
    customized = true
    $ratingDisplayTipDone = true
  }
  function dismissDisplayPanel() {
    $ratingDisplayTipDone = true
    displayPanel = false
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
    if (!$incognito) {
      saveLocalTracking(media, { status, progress: p, score: score10 * 10, ...extras })
      setMediaInLocalList(media, WATCHLIST_ID, status === 'CURRENT' || status === 'REPEATING')
    }
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

{#snippet fields(compact: boolean)}
  <fieldset class="mb-4">
    <legend class="mb-2 text-sm font-bold">Status</legend>
    <div class="grid gap-2 {compact ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3'}">
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
          class="progress-input w-16 bg-transparent text-center text-lg font-black tabular-nums outline-none" />
        <span class="text-sm text-muted-foreground"> / {total || '?'}</span>
      </label>
      <button type="button" data-focusable onclick={() => changeProgress(1)} disabled={!!total && progress >= total}
        aria-label="Increase episodes watched"
        class="grid size-11 place-items-center rounded-md bg-background/70 transition-colors hover:bg-accent disabled:opacity-30"><Plus size={18} /></button>
    </div>
  </div>

  <div class="mb-5">
    <ScoreScale value={score10} onpick={(n) => (score10 = n)} label="Score" compact />
    {#if displayPanel}
    <div class="mt-3 space-y-2 rounded-lg bg-background/40 p-2.5">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-bold">Customise how ratings look</span>
        {#if !customized}
          <button type="button" data-focusable aria-label="Dismiss" onclick={dismissDisplayPanel}
                  class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"><X size={14} /></button>
        {/if}
      </div>
      <div class="flex items-center justify-between gap-3">
        <span class="text-xs font-semibold text-muted-foreground">Style</span>
        <div class="flex gap-0.5 rounded-md bg-input p-0.5" role="radiogroup" aria-label="Rating style">
          {#each STYLE_CHOICES as c (c.value)}
            <button type="button" role="radio" data-focusable aria-checked={$ratingStyle === c.value}
                    onclick={() => customize(() => ($ratingStyle = c.value))}
                    class="h-7 rounded px-2 text-xs font-bold transition-colors {$ratingStyle === c.value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}">{c.label}</button>
          {/each}
        </div>
      </div>
      <div class="flex items-center justify-between gap-3">
        <span class="text-xs font-semibold text-muted-foreground">On series page</span>
        <div class="w-36">
          <SelectMenu value={$ratingOnPage} options={ON_PAGE_CHOICES} onChange={(v) => customize(() => ($ratingOnPage = v as RatingOnPage))} ariaLabel="Show rating on series page" floating />
        </div>
      </div>
      {#if customized}
        <p class="text-xs text-muted-foreground">
          Saved. You can change this anytime in
          <a href="/app/settings/interface?setting=rating-style" onclick={onclose} class="font-bold text-foreground underline underline-offset-2">Settings → Interface</a>.
        </p>
      {/if}
    </div>
    {/if}
  </div>
{/snippet}

{#snippet footer()}
  {#if canRemove}
    <button data-focusable onclick={remove} disabled={busy} aria-label="Remove from list"
            class="grid size-10 place-items-center rounded-md text-destructive hover:bg-accent disabled:opacity-40"><Trash2 size={18} /></button>
  {/if}
  <button data-focusable onclick={save} disabled={busy}
          class="ml-auto flex items-center gap-1.5 rounded-md bg-primary px-5 py-2 font-bold text-primary-foreground disabled:opacity-50">
    <Check size={16} /> {hasEntry ? 'Save' : 'Add to list'}
  </button>
{/snippet}

{#if popover}
  <!-- Desktop: an anchored, non-modal popover. No scrim — the series page stays readable and a
       click anywhere else dismisses. Scales in from the anchor's corner like a menu, not a modal. -->
  <div
    bind:this={dialog}
    role="dialog" aria-label="Edit list entry" tabindex="-1"
    data-nav-trap
    class="fixed inset-0 z-50 pointer-events-none"
    onkeydown={(e) => { if (e.key === 'Escape') onclose() }}
  >
    <div
      bind:this={panel}
      in:scale={{ start: 0.96, duration: 160, easing: cubicOut }}
      out:scale={{ start: 0.98, duration: 120, easing: cubicOut }}
      class="list-editor-popover pointer-events-auto absolute flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      style="left:{place.left}px;top:{place.top}px;width:{place.width}px;max-height:{place.maxHeight}px;transform-origin:{place.origin}"
    >
      <div class="flex shrink-0 items-center justify-between px-5 pb-2 pt-4">
        <h3 class="text-base font-black">Edit list</h3>
        <button data-focusable aria-label="Close" onclick={onclose} class="grid size-8 place-items-center rounded-md hover:bg-accent"><X size={18} /></button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
        {@render fields(true)}
      </div>
      <div class="flex shrink-0 items-center gap-2 border-t border-border bg-card px-5 py-3">
        {@render footer()}
      </div>
    </div>
  </div>
{:else}
  <!-- Phones (and anchor-less openers): a modal bottom sheet, sliding up over a fading scrim. -->
  <div
    bind:this={dialog}
    role="dialog" aria-modal="true" aria-label="Edit list entry" tabindex="-1"
    data-nav-trap
    class="fixed inset-0 z-50 grid h-[100dvh] place-items-end overflow-hidden sm:place-items-center sm:p-4"
    onclick={(e) => { if (e.target === e.currentTarget) onclose() }}
    onkeydown={(e) => { if (e.key === 'Escape') onclose() }}
  >
    <div transition:fade={{ duration: 180 }} class="pointer-events-none absolute inset-0 bg-black/70"></div>
    <div
      bind:this={panel}
      in:fly={{ y: 48, duration: 260, easing: cubicOut }}
      out:fly={{ y: 48, duration: 180, easing: cubicOut }}
      class="relative flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl">
      <div class="flex shrink-0 items-center justify-between px-5 pb-3 pt-5">
        <h3 class="text-lg font-black">Edit list</h3>
        <button data-focusable aria-label="Close" onclick={onclose} class="grid size-8 place-items-center rounded-md hover:bg-accent"><X size={18} /></button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
        {@render fields(false)}
      </div>

      <div class="flex shrink-0 items-center gap-2 border-t border-border bg-card px-5 pt-3" style="padding-bottom: max(1rem, env(safe-area-inset-bottom));">
        {@render footer()}
      </div>
    </div>
  </div>
{/if}

<style>
  /* WebKitGTK exposes the native number stepper even though this editor already has large Deck-
     friendly minus/plus buttons. Keeping both creates a tiny accidental touch target under 0/12. */
  .progress-input { appearance: textfield; -moz-appearance: textfield; }
  .progress-input::-webkit-inner-spin-button,
  .progress-input::-webkit-outer-spin-button { -webkit-appearance: none; appearance: none; margin: 0; }
  /* No `will-change: transform` here: it makes the popover the containing block for every
     position:fixed descendant, which is how the old score dropdown ended up clipped and offset. */
</style>
