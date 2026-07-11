import { get } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { RepeatTimer } from '$lib/player/repeat'
import { playing, exitPrompt, trackMenuOpen, streamPicker, oskOpen, debridCaching } from '$lib/player/session'
import { seekDuration } from '$lib/settings/ui'

// App-wide controller translator (Steam Deck Game mode). The Rust backend reads the pad and
// emits `gamepad-input` = { name, pressed }; here we route each button to izumi's existing
// keyboard nav. Directions repeat (accelerating) while held; in the player they seek. The
// player itself owns A/B/L1/R1 (context-aware skip/pause/back — see PlayerOverlay) and L2/R2
// (the seek scrub — see player/gamepad.ts), so we only act on those when the player is closed.

type Dir = 'up' | 'down' | 'left' | 'right'
const DIRS: Dir[] = ['up', 'down', 'left', 'right']
const ARROW: Record<Dir, string> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }

function keydown(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}
function playerCmd(name: string, args: string[] = []) {
  invoke('player_command', { name, args }).catch(() => {})
}

/// Start the translator. Returns a stop function. Runs for the whole app while in Game mode.
export function startGamepadNav(): () => void {
  const held: Record<Dir, boolean> = { up: false, down: false, left: false, right: false }
  const cfg = { initialDelay: 300, startInterval: 300, minInterval: 80, ramp: 1200 }
  const timers: Record<Dir, RepeatTimer> = {
    up: new RepeatTimer(cfg), down: new RepeatTimer(cfg), left: new RepeatTimer(cfg), right: new RepeatTimer(cfg),
  }
  let raf = 0
  let unlisten: (() => void) | null = null

  const inPlayer = () => get(playing)

  // A direction fires once on press, then repeats while held. In the player, left/right seek
  // (up/down are unused); everywhere else it drives focus nav via izumi's window keydown handler.
  function fireDir(dir: Dir) {
    if (get(trackMenuOpen)) return // the track menu owns the pad while open
    if (get(debridCaching)) return // the caching screen owns the pad
    if (inPlayer()) {
      if (dir === 'left') playerCmd('seek', [String(-get(seekDuration)), 'relative+exact'])
      else if (dir === 'right') playerCmd('seek', [String(get(seekDuration)), 'relative+exact'])
    } else {
      keydown(ARROW[dir])
    }
  }

  function onPress(name: string) {
    // Track menu open (Game mode ☰): it captures ALL buttons — d-pad, A, B, ☰ — so nothing
    // here should drive focus nav / seek / back while it's up.
    if (get(trackMenuOpen)) return
    // The debrid caching screen captures the pad: B cancels, everything else is ignored.
    if (get(debridCaching)) {
      if (name === 'b') get(debridCaching)?.cancel()
      return
    }
    if (DIRS.includes(name as Dir)) {
      const dir = name as Dir
      held[dir] = true
      timers[dir].press(performance.now())
      fireDir(dir)
      return
    }
    // The on-screen keyboard (if up) owns A/B: A types the focused key; B closes it. D-pad nav
    // already ran above (trapped to the keyboard via data-nav-trap).
    if (get(oskOpen)) {
      if (name === 'a') (document.activeElement as HTMLElement | null)?.click()
      else if (name === 'b') window.dispatchEvent(new Event('osk-close'))
      return
    }
    // The exit prompt (if open) captures A/B: A activates the focused button (Exit/Cancel);
    // B cancels it. Handled before the player check so it works from anywhere.
    if (get(exitPrompt)) {
      if (name === 'a') (document.activeElement as HTMLElement | null)?.click()
      else if (name === 'b') exitPrompt.set(false)
      return
    }
    // The source picker (opened by Play) captures A/B: A picks the focused source; B closes the
    // picker instead of navigating the page back (which would leave the series entirely).
    if (get(streamPicker)) {
      if (name === 'a') (document.activeElement as HTMLElement | null)?.click()
      else if (name === 'b') streamPicker.set(null)
      return
    }
    // A/B only act in browse; the player owns them (and L1/R1, L2/R2) itself.
    if (inPlayer()) return
    switch (name) {
      case 'a': (document.activeElement as HTMLElement | null)?.click(); break
      // Back: go up the history, UNLESS we're on the home screen (nothing further back) —
      // there, open the exit-confirm prompt instead of silently going nowhere.
      case 'b':
        if (location.pathname.replace(/\/$/, '') === '/app/home') exitPrompt.set(true)
        else history.back()
        break
      // L1/R1 on the home screen step through the featured hero banners (prev/next). The Hero
      // listens for `hero-nav`. Elsewhere in browse they stay reserved; the player owns them.
      case 'l1':
      case 'r1':
        if (location.pathname.replace(/\/$/, '') === '/app/home')
          window.dispatchEvent(new CustomEvent('hero-nav', { detail: name === 'l1' ? -1 : 1 }))
        break
      // l2/r2/start/select: player-only or reserved.
    }
  }

  function onRelease(name: string) {
    if (DIRS.includes(name as Dir)) {
      const dir = name as Dir
      held[dir] = false
      timers[dir].release()
    }
  }

  listen<{ name: string; pressed: boolean }>('gamepad-input', (e) => {
    if (e.payload.pressed) onPress(e.payload.name)
    else onRelease(e.payload.name)
  }).then((u) => { unlisten = u })

  const loop = () => {
    const now = performance.now()
    for (const dir of DIRS) if (held[dir] && timers[dir].tick(now)) fireDir(dir)
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  return () => { cancelAnimationFrame(raf); unlisten?.() }
}
