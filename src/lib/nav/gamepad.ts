import { derived, get } from 'svelte/store'
import { seriesRatingPrompt } from '$lib/player/series-rating'
import { listen } from '@tauri-apps/api/event'
import { RepeatTimer } from '$lib/player/repeat'
import { playing, exitPrompt, trackMenuOpen, streamPicker, streamPickerDismissedAt, oskOpen, debridCaching, advancedFiltersOpen, listEditorOpen, commentsOpen, playerMenuOpen, onboardingNav } from '$lib/player/session'
import { inputType } from './input'
import { acknowledgeDeckKeyboardWarning, deckKeyboardWarning, dismissDeckKeyboardWarning } from '$lib/deck/keyboard-warning'
import { closeGlobalSearch, globalSearchOpen } from '$lib/search/global-search'
import { ActiveFrameLoop } from '$lib/util/active-frame-loop'
import { BROWSER_GAMEPAD_EVENT, type GamepadInputName } from './browser-gamepad'
import { handleLayeredBack, isDuplicateBackPress } from './back'
import { markBackPending } from './nav-state'
import { closeOsk, oskBackspace, oskInsert } from './osk'
import { oskDismissedAt } from '$lib/player/session'
import { closeAllNavLayers, closeTopNavLayer, topNavLayer } from './layers'
import { padActivate } from './pad-controls'
import { dispatchPadKey } from './pad-controls'

// App-wide controller translator (Steam Deck Game mode). The Rust backend reads the pad and
// emits `gamepad-input` = { name, pressed }; here we route each button to izumi's existing
// keyboard nav. Directions repeat (accelerating) while held. The player owns A/B/L1/R1
// (skip/pause/back), L2/R2 and d-pad left/right (skim), and L4/R4 (screenshot / GIF).
// Browse only acts on those when the player is closed.

type Dir = 'up' | 'down' | 'left' | 'right'
const DIRS: Dir[] = ['up', 'down', 'left', 'right']
const ARROW: Record<Dir, string> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }

// Every synthetic controller key goes through dispatchPadKey: a window-targeted, cancelable keydown
// marked as a pad key, so the player and shell hotkeys and a focused field's claim on the arrows can
// tell it from a real keyboard. The name stays: continue-dismiss.test.ts pins `keydown('d')`.
function keydown(key: string, repeat = false) {
  dispatchPadKey(key, { repeat })
}

/// Start the translator. Returns a stop function. Runs for the whole app while in Game mode.
export function startGamepadNav(): () => void {
  const held: Record<Dir, boolean> = { up: false, down: false, left: false, right: false }
  const cfg = { initialDelay: 300, startInterval: 300, minInterval: 80, ramp: 1200 }
  const timers: Record<Dir, RepeatTimer> = {
    up: new RepeatTimer(cfg), down: new RepeatTimer(cfg), left: new RepeatTimer(cfg), right: new RepeatTimer(cfg),
  }
  let unlisten: (() => void) | null = null
  let stopped = false

  const repeatLoop = new ActiveFrameLoop(() => {
    const now = performance.now()
    for (const dir of DIRS) if (held[dir] && timers[dir].tick(now)) fireDir(dir, true)
    return DIRS.some((dir) => held[dir])
  })

  const inPlayer = () => get(playing)

  // Track when the player last CLOSED. A single B press can race the player's own close (which
  // flips `playing` false) into the browse B handler below — which on the home screen would open
  // the exit prompt. Ignore B for a beat after a close so "back out of the episode" can't quit
  // the app (the continue-watching → play → B bug).
  let playerClosedAt = -1e9
  let wasPlaying = get(playing)
  const unsubPlaying = playing.subscribe((p) => {
    if (wasPlaying && !p) playerClosedAt = performance.now()
    wasPlaying = p
  })

  // A layer never coexists with the pad owners that outrank it (spec §3.2): the Deck keyboard
  // warning, the track menu, the caching screen, the rating prompt and the exit prompt close every
  // open layer as they appear, so their stacking order against a dropdown never matters.
  const unsubOwners = derived(
    [deckKeyboardWarning, trackMenuOpen, debridCaching, seriesRatingPrompt, exitPrompt],
    (owners) => owners.some(Boolean),
  ).subscribe((owned) => { if (owned) closeAllNavLayers('preempted') })

  // A direction fires once on press, then repeats while held. In the player, left/right are
  // owned by the overlay's TriggerScrubber (same skim path as L2/R2) so a paused seek still
  // moves the bar and the frame; up/down are unused. Everywhere else this drives focus nav.
  function fireDir(dir: Dir, repeat = false) {
    if (get(deckKeyboardWarning)) return // the keyboard shortcut warning owns the pad
    if (get(oskOpen)) { keydown(ARROW[dir], repeat); return } // the on-screen keyboard sits above everything else
    if (get(seriesRatingPrompt)) { keydown(ARROW[dir], repeat); return } // rating prompt owns the pad
    if (get(trackMenuOpen)) return // the track menu owns the pad while open
    if (get(debridCaching)) return // the caching screen owns the pad
    // An open dropdown, sheet or chooser (a nav layer) takes the arrows before the picker and the
    // player routes below; its trap confines them (nav/traps.ts activeNavTrap).
    if (topNavLayer()) { keydown(ARROW[dir], repeat); return }
    // Change source can open the app-wide picker while `playing` remains true. Its data-nav-trap
    // owns directions; otherwise the blanket player branch below swallows them and focus remains
    // on the settings button behind the picker.
    const picker = get(streamPicker)
    if (picker && !picker.hidden) {
      // WebKitGTK occasionally leaves activeElement on the settings button behind the snapshotted
      // picker. Its local vertical navigator starts from the source rows directly, so Down remains
      // deterministic even when generic geometry cannot see the modal through mpv's overlay.
      if (dir === 'up' || dir === 'down') {
        window.dispatchEvent(new CustomEvent('stream-picker-nav', { detail: dir }))
      } else {
        keydown(ARROW[dir], repeat)
      }
      return
    }
    if (inPlayer()) {
      if (get(commentsOpen)) {
        // Route held/repeating d-pad + stick directions into the discussion panel. This keeps
        // player seeking disabled while allowing controller scrolling and source selection.
        window.dispatchEvent(new CustomEvent('comments-nav', { detail: dir }))
      } else if (get(playerMenuOpen)) {
        window.dispatchEvent(new CustomEvent('player-menu-nav', { detail: dir }))
      }
      return
    }
    keydown(ARROW[dir], repeat)
  }

  // One press of a direction: fire now, then repeat (accelerating) while it is held.
  function pressDir(dir: Dir) {
    held[dir] = true
    timers[dir].press(performance.now())
    fireDir(dir)
    repeatLoop.start()
  }

  function onPress(name: string) {
    // Any controller press = 'dpad' modality (so e.g. focusing the sidebar via ☰ expands it, and
    // a touch tap stays 'touch' and doesn't).
    inputType.set('dpad')
    // One physical B can arrive twice on Android (this pad edge and the system Back it also raises).
    // Whichever comes second within BACK_DEBOUNCE_MS is dropped here, before any owner below sees it.
    if (name === 'b' && isDuplicateBackPress('gamepad')) return
    // Keep every controller action inside the warning. A continues, B cancels, and every other
    // button is swallowed so it cannot affect the page or player underneath.
    if (get(deckKeyboardWarning)) {
      if (name === 'a') acknowledgeDeckKeyboardWarning()
      else if (name === 'b') dismissDeckKeyboardWarning()
      return
    }
    // The on-screen keyboard sits above every dialog and layer, so it owns the pad next: the d-pad
    // walks its keys (the player's left/right skim is skipped, as over comments), A types the
    // focused key, B closes it, and every other button is swallowed.
    if (get(oskOpen)) {
      if (DIRS.includes(name as Dir)) pressDir(name as Dir)
      else if (name === 'a') padActivate()
      else if (name === 'b') {
        // PlayerOverlay hears this same raw B edge: stamp first, so it cannot also close the player.
        oskDismissedAt.set(performance.now())
        closeOsk()
      } else if (name === 'x') oskBackspace() // X deletes and Y types a space, as on the Steam keyboard
      else if (name === 'y') oskInsert(' ')
      return
    }
    // Track menu open (Game mode ☰): it captures ALL buttons — d-pad, A, B, ☰ — so nothing
    // here should drive focus nav / seek / back while it's up.
    if (get(trackMenuOpen)) return
    // The debrid caching screen captures the pad: B cancels, everything else is ignored.
    if (get(debridCaching)) {
      if (name === 'b') get(debridCaching)?.cancel()
      return
    }
    // The end-of-series rating prompt owns the pad while up: directions move focus inside its
    // data-nav-trap (never the player's seek), A activates the focused control, B dismisses it
    // instead of closing the player it sits over.
    if (get(seriesRatingPrompt)) {
      if (DIRS.includes(name as Dir)) keydown(ARROW[name as Dir])
      else if (name === 'a') padActivate()
      else if (name === 'b') window.dispatchEvent(new Event('series-rating-close'))
      return
    }
    if (DIRS.includes(name as Dir)) {
      const dir = name as Dir
      // Player overlay owns left/right skim (paused-frame + native bar). Do not also
      // relative-seek here — that left the HTML snapshot and time-pos stuck while paused.
      // A visible Change source picker owns every direction instead: fireDir hands Left/Right to its
      // trap, and PlayerOverlay's seek scrubber is blocked() while it shows, so nothing seeks behind it.
      const picker = get(streamPicker)
      const pickerUp = !!picker && !picker.hidden
      if (inPlayer() && !get(commentsOpen) && !get(playerMenuOpen) && !pickerUp && !topNavLayer() && (dir === 'left' || dir === 'right')) return
      pressDir(dir)
      return
    }
    // An open nav layer (a dropdown, a sheet, the select chooser) owns the pad below the keyboard and
    // above the modal owners: A activates its focused control, B closes only that layer (a dropdown
    // inside the list editor, advanced filters or the wizard no longer closes its parent), and every
    // other button is swallowed (X would otherwise remove a Continue card behind a chooser).
    if (topNavLayer()) {
      if (name === 'a') padActivate()
      else if (name === 'b') closeTopNavLayer('back')
      return
    }
    // Global search is a browse-level modal: A activates its focused result/control and B
    // dismisses it without navigating away from the page beneath it.
    if (get(globalSearchOpen)) {
      if (name === 'a') padActivate()
      else if (name === 'b') closeGlobalSearch()
      return
    }
    // The exit prompt (if open) captures A/B: A activates the focused button (Exit/Cancel);
    // B cancels it. Handled before the player check so it works from anywhere.
    if (get(exitPrompt)) {
      if (name === 'a') padActivate()
      else if (name === 'b') exitPrompt.set(false)
      return
    }
    // The first-run wizard covers the home route it is mounted over, so the generic Back below
    // would either walk history into the page it is replacing or open an exit prompt underneath an
    // opaque full-screen surface — which is how B came to do nothing at all on a Deck's very first
    // launch. Own A/B here: back a screen while there is one, otherwise offer the exit prompt, the
    // same rule home itself follows.
    const onboarding = get(onboardingNav)
    if (onboarding) {
      // The ident owns the screen while it plays. Any button ends it, exactly as any key or tap
      // does, rather than reaching the wizard behind it.
      if (onboarding.introRunning) {
        window.dispatchEvent(new Event('intro-dismiss'))
        return
      }
      if (name === 'a') padActivate()
      else if (name === 'b') {
        if (onboarding.canGoBack) onboarding.back()
        else exitPrompt.set(true)
      }
      return
    }
    // The source picker (opened by Play) captures A/B: A picks the focused source; B closes the
    // picker instead of navigating the page back (which would leave the series entirely).
    if (get(streamPicker)) {
      if (name === 'a') padActivate()
      else if (name === 'b') {
        // PlayerOverlay receives this same raw edge. Publish ownership before clearing the picker,
        // so listener registration order cannot turn one B press into picker-close + player-close.
        streamPickerDismissedAt.set(performance.now())
        streamPicker.set(null)
      }
      return
    }
    // The series list editor owns A/B while open. Directional input is already confined to its
    // `data-nav-trap`, and the custom status/counter controls avoid native select popups that do
    // not reliably open from a synthetic controller click under gamescope/WebKitGTK.
    if (get(listEditorOpen)) {
      if (name === 'a') padActivate()
      else if (name === 'b') window.dispatchEvent(new Event('list-editor-close'))
      return
    }
    // The advanced-filters modal captures A/B: A activates the focused control; B closes it
    // (via a window event the modal listens for) rather than navigating the search page back.
    if (get(advancedFiltersOpen)) {
      if (name === 'a') padActivate()
      else if (name === 'b') window.dispatchEvent(new Event('advanced-close'))
      return
    }
    // A/B only act in browse; the player owns them (and L1/R1, L2/R2) itself.
    if (inPlayer()) return
    switch (name) {
      case 'a': padActivate(); break
      // X removes the focused Continue Watching card. That row already owns the keyboard D action,
      // so synthesize the same key instead of duplicating its tracker/local-state semantics here.
      case 'x': keydown('d'); break
      // ☰ (start) in browse opens the side menu: focus the current page's item (else the first),
      // which expands the labelled rail via its focus-driven expand. In the player, ☰ is the
      // track menu (handled by TrackMenu before this) — inPlayer() above already returned.
      case 'start': {
        const items = [...document.querySelectorAll<HTMLElement>('[data-nav-sidebar] [data-focusable]')]
        const path = location.pathname.replace(/\/$/, '')
        const cur = items.find((el) => {
          const href = el.getAttribute('href')?.replace(/\/$/, '')
          return href && href !== '/app/home' && path.startsWith(href)
        })
        ;(cur ?? items[1] ?? items[0])?.focus()
        break
      }
      // Back: the layered Back (nav/back.ts) closes what is open (a dialog, or a legacy trap such as
      // a Store sheet, which gets the window Escape it closes on), cancels an armed control, steps
      // out of an in-page view or up the Settings hierarchy. With nothing for it there, go up the
      // history, UNLESS we're on the home screen (nothing further back): there, open the
      // exit-confirm prompt instead of silently going nowhere. The history step marks Back pending
      // (spec §3.8 step 0), so a quick second B is consumed until that step lands instead of
      // stepping back a second entry from a page that is about to be replaced.
      case 'b':
        // Swallow B briefly after the player closed (the close-vs-exit race, above).
        if (performance.now() - playerClosedAt < 500) break
        if (handleLayeredBack('gamepad')) break
        if (location.pathname.replace(/\/$/, '') === '/app/home') exitPrompt.set(true)
        else {
          markBackPending()
          history.back()
        }
        break
      // L1/R1 on the home screen step through the featured hero banners (prev/next). The Hero
      // listens for `hero-nav`. Elsewhere in browse they stay reserved; the player owns them.
      case 'l1':
      case 'r1':
        if (location.pathname.replace(/\/$/, '') === '/app/home')
          window.dispatchEvent(new CustomEvent('hero-nav', { detail: name === 'l1' ? -1 : 1 }))
        break
      // l2/r2/select: player-only or reserved.
    }
  }

  function onRelease(name: string) {
    if (DIRS.includes(name as Dir)) {
      const dir = name as Dir
      held[dir] = false
      timers[dir].release()
      if (!DIRS.some((heldDir) => held[heldDir])) repeatLoop.stop()
    }
  }

  const routeInput = (input: { name: string; pressed: boolean }) => {
    if (input.pressed) onPress(input.name)
    else onRelease(input.name)
  }
  const onBrowserInput = (event: Event) => {
    routeInput((event as CustomEvent<{ name: GamepadInputName; pressed: boolean }>).detail)
  }
  window.addEventListener(BROWSER_GAMEPAD_EVENT, onBrowserInput)

  // Browser previews have their own input bridge and no native event runtime.
  if ('__TAURI_INTERNALS__' in window) {
    void listen<{ name: string; pressed: boolean }>('gamepad-input', (e) => {
      routeInput(e.payload)
    }).then((u) => { if (stopped) u(); else unlisten = u }).catch(() => {})
  }

  return () => {
    stopped = true
    repeatLoop.stop()
    unlisten?.()
    unsubPlaying()
    unsubOwners()
    window.removeEventListener(BROWSER_GAMEPAD_EVENT, onBrowserInput)
  }
}
