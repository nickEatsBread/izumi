<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { listenSafe } from '$lib/util/listen'
  import { trackMenuOpen, onlineSubCandidates, subtitleNotice } from '$lib/player/session'
  import { get } from 'svelte/store'
  import { searchOnlineSubtitles } from '$lib/stremio/play'
  import { subDlApiKey, openSubtitlesToken } from '$lib/settings/ui'
  import { OPEN_SUBS_API_KEY } from '$lib/stremio/subtitles/opensubtitles'
  import { providerBadge, candidateTitle, candidateKey, isCandidateLoaded, subtitleErrorNotice } from './online-subs'
  import type { SubtitleCandidate } from '$lib/stremio/subtitles/types'
  import { deckKeyboardWarning } from '$lib/deck/keyboard-warning'
  import ChevronRight from 'lucide-svelte/icons/chevron-right'
  import Check from 'lucide-svelte/icons/check'

  // Game-mode (Deck) audio/subtitle picker: a controller-navigable CASCADING column menu.
  // Opens on the ☰ (start) button; d-pad up/down moves within a column, →/A descends into the
  // track list, ←/B goes back a level (or closes at the root), ☰ closes. Items are also
  // clickable for touch. mpv is the source (player_tracks) + sink (`set aid`/`set sid`).
  let { cmd }: { cmd: (name: string, args?: string[]) => void } = $props()

  type Track = {
    id: number; type: string; title?: string; lang?: string; selected?: boolean
    codec?: string; channels?: number; default?: boolean; forced?: boolean
  }
  let tracks = $state<Track[]>([])
  const audios = $derived(tracks.filter((t) => t.type === 'audio'))
  const subs = $derived(tracks.filter((t) => t.type === 'sub'))

  // Online subtitle candidates (searched on play) + the titles of the currently-selected sub
  // tracks, so a candidate shows its Check once its downloaded track is live and selected.
  const onlineItems = $derived($onlineSubCandidates.items)
  const loadedSubTitles = $derived(subs.filter((s) => s.selected).map((s) => s.title ?? ''))
  const onlineLeafLabel = (c: SubtitleCandidate) => `${c.lang ?? 'und'} · ${c.release ?? providerBadge(c.provider)}`

  // Disambiguating label (matches the mouse track menu): title else UPPER lang else "Track N",
  // with codec/channels appended when two share a name, plus Forced/Default flags.
  const chLabel = (n?: number) =>
    !n ? '' : n >= 8 ? '7.1' : n >= 6 ? '5.1' : n === 2 ? '2.0' : n === 1 ? 'Mono' : `${n}ch`
  const baseOf = (t: Track) => t.title?.trim() || (t.lang ? t.lang.toUpperCase() : `Track ${t.id}`)
  function label(t: Track, group: Track[]): string {
    const base = baseOf(t)
    const collide = group.filter((o) => baseOf(o) === base).length > 1
    const bits: string[] = []
    if (collide && t.codec) bits.push(t.codec.toUpperCase())
    if (t.type === 'audio') { const c = chLabel(t.channels); if (c) bits.push(c) }
    if (t.forced) bits.push('Forced')
    if (t.default) bits.push('Default')
    return bits.length ? `${base} · ${bits.join(' ')}` : base
  }

  // A leaf is either an mpv track (audio/sub), an online-subtitle candidate to download, or the
  // "Search again" action. Distinguished by `kind` so `apply` knows what to do on A/click.
  type Leaf =
    | { kind: 'aid' | 'sid'; id: number; label: string; selected: boolean }
    | { kind: 'online'; label: string; selected: boolean; candidate: SubtitleCandidate }
    | { kind: 'search'; label: string; selected: false }
  // Only surface a category that has tracks; Online shows when candidates were found on play.
  const roots = $derived([
    ...(audios.length ? [{ key: 'audio' as const, label: 'Audio' }] : []),
    ...(subs.length ? [{ key: 'subs' as const, label: 'Subtitles' }] : []),
    ...(onlineItems.length ? [{ key: 'online' as const, label: 'Online subtitles' }] : []),
  ])
  // Track list for the highlighted category. Subtitles gets a leading "Off"; Online gets a trailing
  // "Search again". No free-text input in Game mode (needs the OSK) — result list + re-search only.
  function itemsFor(key: string | undefined): Leaf[] {
    if (key === 'audio') return audios.map((t) => ({ kind: 'aid' as const, id: t.id, label: label(t, audios), selected: !!t.selected }))
    if (key === 'subs') return [
      { kind: 'sid' as const, id: -1, label: 'Off', selected: !subs.some((s) => s.selected) },
      ...subs.map((t) => ({ kind: 'sid' as const, id: t.id, label: label(t, subs), selected: !!t.selected })),
    ]
    if (key === 'online') return [
      ...onlineItems.map((c) => ({ kind: 'online' as const, label: onlineLeafLabel(c), selected: isCandidateLoaded(c, loadedSubTitles), candidate: c })),
      { kind: 'search' as const, label: 'Search again', selected: false as const },
    ]
    return []
  }
  // Stable {#each} key across the union (online/search leaves have no track id).
  const leafKey = (it: Leaf) => it.kind === 'online' ? candidateKey(it.candidate) : it.kind === 'search' ? 'search' : `${it.kind}${it.id}`

  let open = $state(false)
  let level = $state(0) // 0 = category column, 1 = track column
  let rootIdx = $state(0) // highlighted category (level 0)
  // Category whose track list is OPEN — LOCKED on descend. Separate from rootIdx so a stray
  // hover/tap on the (still-visible) category column can't switch the open list out from under
  // you (the "click Audio, it flips to Subtitles" bug).
  let openIdx = $state(0)
  let subIdx = $state(0)
  const subItems = $derived(itemsFor(roots[openIdx]?.key))

  // Keep the highlighted track visible: with many tracks (e.g. 20 audio) the column overflows,
  // and d-pad nav only moves `subIdx` — the list doesn't follow. Scroll the active button into
  // view when it changes. `block:'nearest'` = instant (no smooth animation, which would crawl
  // under the Game-mode snapshot render path).
  let trackColEl = $state<HTMLElement>()
  $effect(() => {
    const i = subIdx
    if (level === 1 && trackColEl) trackColEl.querySelectorAll('button')[i]?.scrollIntoView({ block: 'nearest' })
  })

  async function openMenu() {
    try { tracks = JSON.parse(await invoke<string>('player_tracks')) as Track[] }
    catch { tracks = [] }
    level = 0; rootIdx = 0; subIdx = 0
    open = true; trackMenuOpen.set(true)
  }
  function closeMenu() {
    open = false
    // Keep the capture flag set until every listener for this controller event has run. Otherwise
    // PlayerOverlay can observe `false` later in the same B event and close the entire player.
    setTimeout(() => { if (!open) trackMenuOpen.set(false) }, 0)
  }
  function descend() {
    if (level !== 0 || !roots.length) return
    openIdx = rootIdx // lock the category we're entering
    const items = itemsFor(roots[openIdx]?.key)
    if (!items.length) return
    const sel = items.findIndex((i) => i.selected)
    subIdx = sel >= 0 ? sel : 0
    level = 1
  }
  function ascend() { if (level === 1) level = 0; else closeMenu() }
  function move(delta: number) {
    if (level === 0) { if (roots.length) rootIdx = (rootIdx + delta + roots.length) % roots.length }
    else if (subItems.length) subIdx = (subIdx + delta + subItems.length) % subItems.length
  }
  async function addOnlineSub(c: SubtitleCandidate) {
    try {
      await invoke('player_add_subtitle', {
        provider: c.provider,
        url: c.download?.zipUrl,
        fileId: c.download?.fileId,
        lang: c.lang ?? 'und',
        title: candidateTitle(c),
        apiKey: c.provider === 'subdl' ? get(subDlApiKey) : OPEN_SUBS_API_KEY,
        token: get(openSubtitlesToken),
      })
      tracks = JSON.parse(await invoke<string>('player_tracks')) as Track[]
      subtitleNotice.set('')
    }
    catch (e) {
      console.warn('add online subtitle failed', e)
      subtitleNotice.set(subtitleErrorNotice(c.provider, e))
    }
  }
  function apply(leaf: Leaf) {
    // "Search again" re-runs the aggregator; an online candidate downloads + live-loads. Both keep
    // the menu open so the updated list/Check stays visible (only track picks close the menu).
    if (leaf.kind === 'search') { void searchOnlineSubtitles(); return }
    if (leaf.kind === 'online') { void addOnlineSub(leaf.candidate); return }
    cmd('set', [leaf.kind, leaf.id === -1 ? 'no' : String(leaf.id)])
    // Reflect the new selection locally so the check mark is instant.
    const type = leaf.kind === 'aid' ? 'audio' : 'sub'
    tracks = tracks.map((t) => (t.type === type ? { ...t, selected: leaf.id !== -1 && t.id === leaf.id } : t))
    closeMenu()
  }
  function activate() { if (level === 0) descend(); else { const it = subItems[subIdx]; if (it) apply(it) } }

  // Controller: own the ☰ (start) toggle always; capture d-pad/A/B only while open.
  onMount(() => {
    // Defensive: clear any stale "open" flag from a previous player session. If the menu was left
    // open when the player closed, `trackMenuOpen` would stick true and permanently gate the
    // player's Back (B) button — the "B gets stuck" bug.
    open = false
    trackMenuOpen.set(false)
    const unGamepad = listenSafe<{ name: string; pressed: boolean }>('gamepad-input', (e) => {
      if (!e.payload.pressed) return
      if (get(deckKeyboardWarning)) return
      if (e.payload.name === 'start') { open ? closeMenu() : openMenu(); return }
      if (!open) return
      switch (e.payload.name) {
        case 'up': move(-1); break
        case 'down': move(1); break
        case 'right': descend(); break
        case 'left': ascend(); break
        case 'a': activate(); break
        case 'b': closeMenu(); break
      }
    })
    // Keyboard parity (Desktop testing / a physical keyboard on the Deck).
    const onKey = (e: KeyboardEvent) => {
      if (get(deckKeyboardWarning)) return
      if (e.key === 'm' && !open) { openMenu(); return }
      if (!open) return
      const k = e.key
      if (k === 'ArrowUp') move(-1)
      else if (k === 'ArrowDown') move(1)
      else if (k === 'ArrowRight' || k === 'Enter' || k === ' ') activate()
      else if (k === 'ArrowLeft' || k === 'Backspace') ascend()
      else if (k === 'Escape') closeMenu()
      else return
      e.preventDefault(); e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      unGamepad()
      window.removeEventListener('keydown', onKey, true)
      // Never leave the flag stuck true on unmount (player close) — else Back is gated next time.
      trackMenuOpen.set(false)
    }
  })
</script>

{#if open}
  <!-- Full-screen capture layer. Backdrop tap closes; z above the controls. NO fade/opacity
       transition: the Game-mode player renders the webview via a software SNAPSHOT (accel off,
       to avoid gamescope pixelation), so any per-frame opacity animation re-snapshots the whole
       view each frame → the menu crawled in. Instant show/hide instead. -->
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/50"
    onclick={closeMenu}
    role="presentation"
  >
    <!-- The column strip. Two panels fit centered on the Deck screen; the category column dims
         while a track column is open (parent-dims-child cascade). stopPropagation so clicks
         inside don't hit the backdrop. Sized big for the Deck's handheld screen. -->
    <div class="flex items-start gap-4" onclick={(e) => e.stopPropagation()} role="presentation">
      <!-- Category column. OPAQUE bg + NO opacity animation: the menu is snapshotted into mpv, and
           a translucent/opacity-animated element gets promoted to its own compositing layer, which
           WebKit captures as pixelated text. The active column reads from the highlight, not a dim. -->
      <div class="w-[26rem] rounded-2xl border border-white/10 bg-black p-2 shadow-2xl">
        {#each roots as r, i (r.key)}
          <button
            data-focusable
            class="my-1 flex w-full select-none items-center rounded-lg py-5 pl-7 pr-5 text-left text-3xl font-bold outline-none"
            class:bg-white={level === 0 && rootIdx === i}
            class:text-black={level === 0 && rootIdx === i}
            onpointerenter={() => { if (level === 0) rootIdx = i }}
            onclick={() => { if (level === 0) { rootIdx = i; descend() } }}
          >
            <span>{r.label}</span>
            <ChevronRight size={36} class="ml-auto" />
          </button>
        {/each}
      </div>

      <!-- Track column (appears when descended). -->
      {#if level === 1}
        <div bind:this={trackColEl} class="max-h-[85vh] w-[26rem] overflow-y-auto rounded-2xl border border-white/10 bg-black p-2 shadow-2xl">
          <p class="px-5 py-3 text-xl font-bold uppercase tracking-wide text-white/40">{roots[openIdx]?.label}</p>
          {#each subItems as it, i (leafKey(it))}
            <button
              data-focusable
              class="my-1 flex w-full select-none items-center gap-3 rounded-lg py-5 pl-7 pr-5 text-left text-3xl font-bold outline-none"
              class:bg-white={subIdx === i}
              class:text-black={subIdx === i}
              onpointerenter={() => (subIdx = i)}
              onclick={() => apply(it)}
            >
              <span class="grid w-8 shrink-0 place-items-center">{#if it.selected}<Check size={32} />{/if}</span>
              <span class="line-clamp-2">{it.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
