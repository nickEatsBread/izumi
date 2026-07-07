import { get } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { RepeatTimer } from '$lib/player/repeat'
import { playing } from '$lib/player/session'
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
    if (inPlayer()) {
      if (dir === 'left') playerCmd('seek', [String(-get(seekDuration)), 'relative+exact'])
      else if (dir === 'right') playerCmd('seek', [String(get(seekDuration)), 'relative+exact'])
    } else {
      keydown(ARROW[dir])
    }
  }

  function onPress(name: string) {
    if (DIRS.includes(name as Dir)) {
      const dir = name as Dir
      held[dir] = true
      timers[dir].press(performance.now())
      fireDir(dir)
      return
    }
    // A/B only act in browse; the player owns them (and L1/R1, L2/R2) itself.
    if (inPlayer()) return
    switch (name) {
      case 'a': (document.activeElement as HTMLElement | null)?.click(); break
      case 'b': history.back(); break
      // l1/r1/l2/r2/start/select: player-only or reserved.
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
